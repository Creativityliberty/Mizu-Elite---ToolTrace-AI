import { GoogleGenAI } from "@google/genai";
import { SYSTEM_PROMPT } from "../constants";
import { TranscriptChunk, ExtractionResult, ChatMessage } from "../types";

export const extractToolsWithAI = async (chunks: TranscriptChunk[]): Promise<ExtractionResult> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("Clé API manquante dans l'environnement. Configurez GEMINI_API_KEY.");

  const ai = new GoogleGenAI({ apiKey });
  
  // Prepare transcript context (limit to ~10k chars for efficiency, though 1.5/2.0 can handle more)
  const transcriptWithTime = Array.isArray(chunks) 
    ? chunks.slice(0, 500).map((c, i) => `[${Math.floor(c.offset || 0)}s] ${c.text || ''}`).join(' ')
    : '';

  const promptText = `Analysez ce transcript. Extrayez les outils techniques avec leurs timestamps. Vérifiez les URLs via l'outil Google Search. Transcript: ${transcriptWithTime}`;

  const attemptGeneration = async (retryCount = 0): Promise<any> => {
    try {
      // Disable tools on the last retry (attempt 2) to maximize chance of success if search is causing 500s
      const useTools = retryCount < 2; 
      
      const config: any = {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        temperature: 0.15,
        safetySettings: [
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      };

      if (useTools) {
        config.tools = [{ googleSearch: {} }];
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [{ parts: [{ text: promptText }] }],
        config
      });

      return response;
    } catch (e: any) {
      // Check for 500 or 503 errors (Internal or Service Unavailable)
      const isServerSideError = 
        e.message?.includes('500') || 
        e.message?.includes('503') || 
        e.message?.includes('Internal error') ||
        e.status === 500 || 
        e.status === 503;

      if (retryCount < 2 && isServerSideError) {
        console.warn(`Gemini Server Error (${e.status || '500'}), retrying (attempt ${retryCount + 1})...`);
        // Exponential backoff: 2s, 4s
        await new Promise(resolve => setTimeout(resolve, 2000 * Math.pow(2, retryCount)));
        return attemptGeneration(retryCount + 1);
      }
      throw e;
    }
  };

  try {
    const response = await attemptGeneration();

    const rawText = response.text;
    if (!rawText) {
        console.warn("Gemini response missing text. Candidate info:", response.candidates?.[0]);
        throw new Error("Le moteur neural n'a retourné aucun texte (blocage sécurité ou erreur modèle).");
    }
    
    // Sometimes the model adds markdown code blocks despite MimeType, handle cleanup
    const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    
    let parsed;
    try {
        parsed = JSON.parse(cleanJson);
    } catch (e) {
        // Fallback: try to find JSON object if there is conversational text
        const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                parsed = JSON.parse(jsonMatch[0]);
            } catch (innerE) {
                throw new Error("Format JSON invalide reçu de l'IA.");
            }
        } else {
            throw new Error("Format JSON invalide reçu de l'IA.");
        }
    }
    
    if (!parsed.tools) parsed.tools = [];
    
    // Extract grounding data if available
    const candidate = response.candidates?.[0];
    const groundingChunks = candidate?.groundingMetadata?.groundingChunks;
    let groundingUrls: string[] = [];
    
    if (Array.isArray(groundingChunks)) {
      groundingUrls = groundingChunks
        .map((chunk: any) => chunk.web?.uri)
        .filter((uri: any): uri is string => typeof uri === 'string');
    }

    return {
      ...parsed,
      id: "pending",
      timestamp: Date.now(),
      groundingUrls,
      stats: parsed.stats || { totalTools: parsed.tools.length, processingTimeMs: 0 }
    };
  } catch (e: any) {
    console.error("Erreur Gemini (Extraction):", e);
    // Return a more user-friendly error message for the UI
    if (e.message?.includes('500') || e.message?.includes('Internal error')) {
        throw new Error("Le service d'IA est temporairement surchargé (Erreur 500). Veuillez réessayer dans quelques instants.");
    }
    throw e;
  }
};

export const chatWithStack = async (history: ChatMessage[], stack: ExtractionResult): Promise<string> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("Clé API manquante.");
  
  const ai = new GoogleGenAI({ apiKey });
  const stackSummary = (stack.tools || []).map(t => `- ${t.name} (${t.category}): ${t.notes?.[0] || ''}`).join('\n');
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [
      { role: 'user', parts: [{ text: `Vous êtes un assistant neural pour la stack technique suivante extraite d'une vidéo :\n${stackSummary}\n\nHistorique:\n${history.map(h => `${h.role}: ${h.text}`).join('\n')}\n\nRépondez à la dernière question de l'utilisateur.` }] }
    ],
    config: {
      systemInstruction: "Soyez concis, professionnel et utile. Concentrez-vous uniquement sur les outils fournis dans la stack, sauf demande contraire.",
      temperature: 0.7
    }
  });

  return response.text || "Je suis désolé, mes circuits neuraux sont un peu flous pour le moment.";
};

export const generateToolVisual = async (toolName: string, category: string): Promise<string | undefined> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return undefined;
  
  const ai = new GoogleGenAI({ apiKey });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: `Professional 3D isometric icon for "${toolName}" in category "${category}". Aesthetic: sleek, silver, glass, soft blue glow, white background. Minimalist.` }]
      },
      config: { imageConfig: { aspectRatio: "1:1" } }
    });
    
    const candidates = response.candidates || [];
    for (const cand of candidates) {
      if (!cand.content || !cand.content.parts) continue;
      const parts = cand.content.parts;
      for (const part of parts) {
        if (part.inlineData && part.inlineData.data) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
    }
  } catch (e) { 
    console.warn("Échec génération visuel pour:", toolName, e); 
  }
  return undefined;
};