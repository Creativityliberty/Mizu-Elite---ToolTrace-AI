import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { AnalysisStep, ExtractionResult, ViewState, ChatMessage, ToolMention } from './types';
import { ICONS } from './constants';
import { fetchTranscript } from './services/supadataService';
import { extractToolsWithAI, generateToolVisual, chatWithStack } from './services/geminiService';
import { ToolCard } from './components/ToolCard';

const ARCHIVE_STORAGE_KEY = 'mizu_archive_v2';
const MAX_ARCHIVE_ITEMS = 30; // Maximum number of sessions to keep
const KEEP_THUMBNAILS_COUNT = 5; // Only keep base64 thumbnails for the 5 most recent sessions

/**
 * Prunes base64 images from older archive entries to save localStorage space.
 */
const pruneArchiveData = (items: ExtractionResult[]): ExtractionResult[] => {
  return items.slice(0, MAX_ARCHIVE_ITEMS).map((item, index) => {
    if (index >= KEEP_THUMBNAILS_COUNT) {
      // Remove heavy base64 strings for older entries
      return {
        ...item,
        tools: item.tools.map(tool => ({ ...tool, aiThumbnail: undefined }))
      };
    }
    return item;
  });
};

const toGitMcpUrl = (url: string): string | null => {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname === 'github.com') {
      return `https://gitmcp.io${urlObj.pathname}`;
    }
    if (urlObj.hostname.endsWith('.github.io')) {
      const sub = urlObj.hostname.replace('.github.io', '');
      return `https://${sub}.gitmcp.io${urlObj.pathname}`;
    }
    return null;
  } catch {
    return null;
  }
};

export default function App() {
  const [activeView, setActiveView] = useState<ViewState>('SCAN');
  const [url, setUrl] = useState('');
  const [step, setStep] = useState<AnalysisStep>(AnalysisStep.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [currentExtraction, setCurrentExtraction] = useState<ExtractionResult | null>(null);
  const [archive, setArchive] = useState<ExtractionResult[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  
  // MCP State
  const [mcpFormat, setMcpFormat] = useState<'markdown' | 'json'>('markdown');
  const [generatingMcp, setGeneratingMcp] = useState(false);
  const [mcpResult, setMcpResult] = useState<string | null>(null);

  // Chat State
  const [chatOpen, setChatOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Initial Load with migration support
  useEffect(() => {
    try {
      let saved = localStorage.getItem(ARCHIVE_STORAGE_KEY);
      // Try legacy key if new key doesn't exist
      if (!saved) {
        saved = localStorage.getItem('mizu_archive');
      }

      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setArchive(parsed.filter(i => i && i.id && Array.isArray(i.tools)));
        }
      }
    } catch (e) { 
      console.error("Échec du chargement de l'archive:", e); 
      setArchive([]);
    }
  }, []);

  // Save with Quota Error Management
  useEffect(() => {
    if (archive.length === 0) return;

    const saveToStorage = (data: ExtractionResult[]) => {
      try {
        localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(data));
      } catch (e) {
        if (e instanceof DOMException && e.name === 'QuotaExceededError') {
          console.warn("Espace de stockage saturé. Nettoyage des données anciennes...");
          // If quota reached, keep fewer thumbnails and items
          const tighterPrune = data.slice(0, Math.floor(data.length * 0.7)).map(item => ({
             ...item,
             tools: item.tools.map(t => ({ ...t, aiThumbnail: undefined }))
          }));
          if (tighterPrune.length > 0) {
            localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(tighterPrune));
          }
        } else {
          console.error("Échec de la sauvegarde de l'archive:", e);
        }
      }
    };

    const pruned = pruneArchiveData(archive);
    saveToStorage(pruned);
  }, [archive]);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, isTyping]);

  const handleAnalyze = useCallback(async () => {
    if (!url || step !== AnalysisStep.IDLE) return;
    const vidMatch = url.match(/(?:youtu\.be\/|youtube\.com(?:\/embed\/|\/v\/|\/watch\?v=|\/user\/\S+|\/ytscreeningroom\?v=|\/sanday\?v=))([\w\-]{11})/);
    const vid = vidMatch?.[1];
    if (!vid) { setError("URL YouTube non valide."); return; }

    setError(null);
    setCurrentExtraction(null);
    setStep(AnalysisStep.FETCHING_TRANSCRIPT);

    try {
      const startTime = Date.now();
      const transcriptData = await fetchTranscript(url);
      if (!transcriptData) throw new Error("Réponse vide du serveur de transcript.");
      
      const transcriptContent = Array.isArray(transcriptData.content) ? transcriptData.content : (transcriptData.transcript || []);
      if (transcriptContent.length === 0) throw new Error("Aucun transcript détecté.");

      setStep(AnalysisStep.AI_EXTRACTION);
      const extractionRes = await extractToolsWithAI(transcriptContent);
      
      if (!extractionRes) throw new Error("L'extraction IA a échoué.");

      setStep(AnalysisStep.AI_VISUAL_GEN);
      const videoMeta = transcriptData.metadata || { title: "Session Trace" };
      
      const toolsWithVisuals = await Promise.all((extractionRes.tools || []).map(async (tool) => {
        try {
          if (!tool || !tool.name) return tool;
          const visual = await generateToolVisual(tool.name, tool.category || 'tech');
          return { ...tool, aiThumbnail: visual };
        } catch { return tool; }
      }));
      
      const completeResult: ExtractionResult = { 
        ...extractionRes, 
        id: vid,
        tools: toolsWithVisuals,
        timestamp: Date.now(),
        video: {
          title: videoMeta.title || "Untitled Session",
          author: videoMeta.author || "Creator",
          thumbnailUrl: `https://img.youtube.com/vi/${vid}/maxresdefault.jpg`
        },
        stats: { totalTools: toolsWithVisuals.length, processingTimeMs: Date.now() - startTime }
      };

      setCurrentExtraction(completeResult);
      setArchive(prev => [completeResult, ...prev.filter(a => a && a.id !== vid)].slice(0, MAX_ARCHIVE_ITEMS));
      setStep(AnalysisStep.COMPLETED);
      setChatHistory([{ role: 'model', text: `Neural Engine Initialisé. Je connais maintenant ${toolsWithVisuals.length} outils de cette vidéo. Que souhaites-tu savoir ?` }]);
    } catch (err: any) {
      console.error("Erreur d'analyse:", err);
      setError(err.message || "Une erreur neurale est survenue.");
      setStep(AnalysisStep.FAILED);
    }
  }, [url, step]);

  const sendMessage = async () => {
    if (!chatInput.trim() || !currentExtraction) return;
    const newUserMsg: ChatMessage = { role: 'user', text: chatInput };
    setChatHistory(prev => [...prev, newUserMsg]);
    setChatInput('');
    setIsTyping(true);

    try {
      const response = await chatWithStack([...chatHistory, newUserMsg], currentExtraction);
      setChatHistory(prev => [...prev, { role: 'model', text: response }]);
    } catch (err) {
      console.error("Erreur Chat:", err);
      setChatHistory(prev => [...prev, { role: 'model', text: "Erreur de connexion neurale. Veuillez réessayer." }]);
    } finally {
      setIsTyping(false);
    }
  };

  const copyMarkdown = () => {
    if (!currentExtraction) return;
    const md = `### Stack de: ${currentExtraction.video?.title || 'Session Sans Titre'}\n\n` + 
      currentExtraction.tools.map(t => `- **[${t.name}](${t.officialUrl || t.githubUrl || '#'})** (${t.category}): ${t.notes?.[0] || ''}`).join('\n');
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(md).then(() => {
        alert("Stack copiée en Markdown !");
      }).catch(err => {
        console.error("Presse-papier inaccessible:", err);
        alert("Erreur lors de la copie.");
      });
    } else {
      alert("Votre navigateur ne supporte pas la copie automatique.");
    }
  };

  const handleGenerateMcp = () => {
    if (!currentExtraction) return;
    setGeneratingMcp(true);
    setMcpResult(null);

    // Simulate Agent processing time
    setTimeout(() => {
        const relevantTools = currentExtraction.tools.filter(t => t.githubUrl);
        
        if (mcpFormat === 'markdown') {
            const lines = relevantTools.map(t => {
                const mcpUrl = toGitMcpUrl(t.githubUrl!);
                return `## ${t.name}\n- **Original**: ${t.githubUrl}\n- **MCP Server**: \`${mcpUrl}\`\n`;
            });
            const content = `# GitMCP Configuration\n\nGenerated for: ${currentExtraction.video?.title}\n\n${lines.join('\n')}`;
            setMcpResult(content);
        } else {
            const configObj = {
                "mcpServers": relevantTools.reduce((acc, t) => {
                    const mcpUrl = toGitMcpUrl(t.githubUrl!);
                    if (mcpUrl) {
                        acc[t.normalized || t.name.toLowerCase().replace(/\s+/g, '-')] = {
                            "command": "npx",
                            "args": ["-y", "@modelcontextprotocol/server-gitmcp", mcpUrl]
                        };
                    }
                    return acc;
                }, {} as Record<string, any>)
            };
            setMcpResult(JSON.stringify(configObj, null, 2));
        }
        setGeneratingMcp(false);
    }, 1500);
  };

  const stats = useMemo(() => {
    if (!archive || !archive.length) return { totalUniqueTools: 0, categories: {}, mostMentioned: [] };
    const allTools = archive.filter(Boolean).flatMap(a => (Array.isArray(a.tools) ? a.tools : []));
    const catMap: Record<string, number> = {};
    const uniqueMap = new Map<string, ToolMention>();
    
    allTools.forEach(t => {
      if (!t) return;
      const cat = t.category || 'Autre';
      catMap[cat] = (catMap[cat] || 0) + 1;
      const norm = t.normalized || (t.name ? t.name.toLowerCase() : 'inconnu');
      if (!uniqueMap.has(norm) || (uniqueMap.get(norm)?.mentionsCount || 0) < (t.mentionsCount || 0)) {
        uniqueMap.set(norm, t);
      }
    });

    return { 
      totalUniqueTools: uniqueMap.size, 
      categories: catMap, 
      mostMentioned: Array.from(uniqueMap.values()).sort((a,b) => (b.mentionsCount || 0) - (a.mentionsCount || 0)).slice(0, 5)
    };
  }, [archive]);

  const filteredArchive = useMemo(() => {
    if (!archive) return [];
    if (!selectedTag) return archive.filter(Boolean);
    return archive.filter(a => a && a.tools && a.tools.some(t => t && t.category === selectedTag));
  }, [archive, selectedTag]);

  return (
    <div className="min-h-screen bg-[#f5f5f3] selection:bg-[#0a0f1d] selection:text-white pb-10">
      <nav className="mizu-glass px-6 md:px-12 py-6 flex flex-col md:flex-row gap-6 justify-between items-center fixed top-0 w-full z-50">
        <div className="flex items-center gap-3 cursor-pointer group" onClick={() => { setActiveView('SCAN'); setCurrentExtraction(null); setStep(AnalysisStep.IDLE); }}>
          <div className="w-10 h-10 rounded-2xl bg-[#0a0f1d] flex items-center justify-center shadow-xl group-hover:rotate-12 transition-transform">
            <div className="w-2 h-2 bg-white rounded-full"></div>
          </div>
          <span className="text-2xl font-black text-[#0a0f1d] outfit tracking-tighter">mizu.elite</span>
        </div>
        <div className="flex items-center gap-2 bg-white/50 backdrop-blur-md p-1.5 rounded-3xl border border-white/50 shadow-sm overflow-x-auto no-scrollbar">
          {(['SCAN', 'LIBRARY', 'DASHBOARD', 'MCP'] as ViewState[]).map(v => (
            <button key={v} onClick={() => setActiveView(v)} className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-3 transition-all ${activeView === v ? 'bg-[#0a0f1d] text-white shadow-lg' : 'text-slate-400 hover:text-[#0a0f1d]'}`}>
              {v === 'SCAN' && <ICONS.Search />}
              {v === 'LIBRARY' && <ICONS.FileJson />}
              {v === 'DASHBOARD' && <div className="w-2 h-2 bg-blue-500 rounded-full" />}
              {v === 'MCP' && <ICONS.Server />}
              {v}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 md:px-12 pt-56">
        {activeView === 'SCAN' && (
          <div className="animate-reveal">
            {!currentExtraction && step === AnalysisStep.IDLE && (
              <div className="flex flex-col lg:flex-row items-center gap-20">
                <div className="lg:w-3/5">
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 border border-blue-100 mb-8">
                    <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></div>
                    <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Neural Engine Ready</span>
                  </div>
                  <h1 className="text-7xl md:text-[9rem] font-black text-[#0a0f1d] leading-[0.8] mb-12 tracking-tighter outfit">Trace <br/><span className="text-slate-200">Neural.</span></h1>
                  <p className="text-xl text-slate-400 max-w-xl font-medium mb-16">Analysez n'importe quel tutoriel ou démo tech. Récupérez la stack précise avec des visuels générés par IA et des timestamps directs.</p>
                  <div className="relative group max-w-2xl">
                    <input type="text" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAnalyze()} placeholder="Collez une URL YouTube..." className="w-full py-8 px-10 text-xl font-bold rounded-[3rem] border border-slate-200 bg-white shadow-2xl focus:border-[#0a0f1d] transition-all outline-none" />
                    <button onClick={handleAnalyze} disabled={!url || step !== AnalysisStep.IDLE} className="absolute right-4 top-4 bottom-4 bg-[#0a0f1d] text-white px-10 rounded-[2.2rem] font-black text-sm hover:scale-105 transition-all shadow-xl disabled:opacity-50">INITIALIZE</button>
                  </div>
                  {error && <p className="mt-8 text-red-500 text-sm font-bold uppercase tracking-widest bg-red-50 p-4 rounded-2xl inline-block">{error}</p>}
                </div>
                <div className="hidden lg:block lg:w-2/5 aspect-[4/5] bg-[#0a0f1d] rounded-[5rem] relative overflow-hidden p-14 flex flex-col justify-end text-white shadow-2xl">
                  <div className="absolute top-0 right-0 w-full h-full opacity-10 pointer-events-none">
                    <div className="absolute top-20 left-10 w-40 h-40 bg-blue-500 rounded-full blur-[100px]"></div>
                    <div className="absolute bottom-20 right-10 w-40 h-40 bg-purple-500 rounded-full blur-[100px]"></div>
                  </div>
                  <span className="text-[11px] font-black uppercase tracking-[0.5em] text-blue-400 mb-6">Vault Stats</span>
                  <div className="text-9xl font-black outfit leading-none mb-4">{archive?.length || 0}</div>
                  <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Traces archivées localement.</p>
                </div>
              </div>
            )}

            {step !== AnalysisStep.IDLE && step !== AnalysisStep.COMPLETED && step !== AnalysisStep.FAILED && (
              <div className="flex flex-col items-center justify-center py-40 text-center animate-reveal">
                <div className="w-40 h-40 rounded-[3.5rem] bg-white shadow-2xl flex items-center justify-center mb-10"><ICONS.Loader /></div>
                <h2 className="text-5xl font-black outfit tracking-tighter mb-4">Traitement du Signal...</h2>
                <p className="text-slate-400 uppercase text-[10px] tracking-[0.4em] font-black">{step.replace(/_/g, ' ')}</p>
              </div>
            )}

            {currentExtraction && (
              <div className="animate-reveal">
                <div className="mb-20 flex flex-col md:flex-row justify-between items-end gap-10">
                  <div className="flex items-center gap-10">
                    <img src={currentExtraction.video?.thumbnailUrl} className="w-56 h-32 rounded-3xl object-cover shadow-2xl border-4 border-white" alt="Video" />
                    <div>
                      <h2 className="text-4xl md:text-5xl font-black text-[#0a0f1d] tracking-tighter outfit leading-tight max-w-2xl">{currentExtraction.video?.title}</h2>
                      <div className="flex items-center gap-4 mt-4">
                        <span className="text-[10px] font-black uppercase tracking-widest text-blue-500">{currentExtraction.tools?.length || 0} PROJETS</span>
                        <div className="w-1.5 h-1.5 rounded-full bg-slate-200"></div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{currentExtraction.video?.author}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <button onClick={copyMarkdown} className="px-8 py-4 bg-white rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-xl hover:translate-y-[-2px] transition-all border border-slate-50">Elite Export</button>
                    <button onClick={() => setChatOpen(true)} className="px-8 py-4 bg-[#0a0f1d] text-white rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-xl hover:translate-y-[-2px] transition-all flex items-center gap-3">
                      <ICONS.Chat /> Neural Chat
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
                  {currentExtraction.tools?.map((tool, idx) => (
                    <ToolCard key={idx} tool={tool} index={idx} videoId={currentExtraction.id} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeView === 'LIBRARY' && (
          <div className="animate-reveal">
             <div className="flex flex-col md:flex-row justify-between items-end mb-24 gap-10">
              <h2 className="text-8xl font-black text-[#0a0f1d] tracking-tighter outfit leading-none">Vault <br/><span className="text-slate-200">Archives.</span></h2>
              <div className="flex gap-2">
                {Object.keys(stats?.categories || {}).map(cat => (
                  <button key={cat} onClick={() => setSelectedTag(selectedTag === cat ? null : cat)} className={`px-6 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all ${selectedTag === cat ? 'bg-[#0a0f1d] text-white border-[#0a0f1d]' : 'bg-white border-slate-100 text-slate-400'}`}>{cat}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {filteredArchive.map((res) => (
                <div key={res.id} onClick={() => { setCurrentExtraction(res); setActiveView('SCAN'); }} className="bg-white rounded-[3rem] p-8 flex items-center gap-8 cursor-pointer hover:shadow-2xl hover:translate-y-[-5px] transition-all border border-transparent hover:border-slate-100 group">
                  <img src={res.video?.thumbnailUrl} className="w-40 h-24 rounded-2xl object-cover grayscale opacity-40 group-hover:grayscale-0 group-hover:opacity-100 transition-all" alt="Vid" />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl font-black text-[#0a0f1d] outfit truncate mb-2">{res.video?.title}</h3>
                    <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">{res.tools?.length || 0} Nodes</p>
                  </div>
                  <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-300 group-hover:bg-[#0a0f1d] group-hover:text-white transition-all"><ICONS.ExternalLink /></div>
                </div>
              ))}
              {filteredArchive.length === 0 && (
                <div className="col-span-full py-20 text-center">
                  <p className="text-slate-400 font-bold uppercase tracking-widest">Aucune trace trouvée.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeView === 'DASHBOARD' && (
          <div className="animate-reveal">
             <h2 className="text-8xl font-black text-[#0a0f1d] tracking-tighter outfit leading-none mb-24">Neural <br/><span className="text-slate-200">Intelligence.</span></h2>
             <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                <div className="bg-white p-12 rounded-[4rem] shadow-sm relative overflow-hidden">
                   <span className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-300 mb-8 block">Unique Nodes</span>
                   <div className="text-9xl font-black outfit leading-none">{stats?.totalUniqueTools || 0}</div>
                   <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-blue-500/5 rounded-full blur-3xl"></div>
                </div>
                <div className="bg-white p-12 rounded-[4rem] shadow-sm md:col-span-2">
                   <span className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-300 mb-10 block">Distribution par Catégorie</span>
                   <div className="flex items-end gap-6 h-48">
                      {Object.entries(stats?.categories || {}).map(([cat, count]) => (
                        <div key={cat} className="flex-1 flex flex-col items-center gap-4 group">
                           <div className="w-full bg-slate-50 rounded-xl group-hover:bg-[#0a0f1d] transition-all relative" style={{ height: `${(Number(count) / Math.max(1, stats.totalUniqueTools)) * 100}%` }}>
                              <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-[10px] font-black opacity-0 group-hover:opacity-100 transition-opacity">{count}</div>
                           </div>
                           <span className="text-[8px] font-black uppercase text-slate-300 truncate w-full text-center">{cat}</span>
                        </div>
                      ))}
                      {Object.keys(stats?.categories || {}).length === 0 && (
                        <div className="w-full flex items-center justify-center h-full text-slate-200 font-black uppercase text-[10px] tracking-widest">Aucune donnée</div>
                      )}
                   </div>
                </div>
             </div>
          </div>
        )}

        {activeView === 'MCP' && (
          <div className="animate-reveal pb-20">
             <div className="flex flex-col lg:flex-row gap-20">
                <div className="lg:w-1/3">
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900 border border-slate-800 mb-8">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                    </span>
                    <span className="text-[10px] font-black text-white uppercase tracking-widest">MCP Agent Online</span>
                  </div>
                  <h2 className="text-6xl font-black text-[#0a0f1d] tracking-tighter outfit leading-none mb-8">MCP <br/><span className="text-slate-300">Linker.</span></h2>
                  <p className="text-lg text-slate-500 font-medium leading-relaxed mb-12">
                    Transformez instantanément n'importe quel dépôt GitHub en serveur <strong>Model Context Protocol (MCP)</strong>.
                    Compatible avec Claude, Cursor et Windsurf.
                  </p>
                  
                  <div className="bg-white rounded-[2.5rem] p-8 border border-slate-100 shadow-xl mb-8">
                     <h3 className="text-sm font-black uppercase tracking-widest mb-6">Format de Sortie</h3>
                     <div className="flex p-1 bg-slate-100 rounded-xl mb-6">
                        <button onClick={() => setMcpFormat('markdown')} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${mcpFormat === 'markdown' ? 'bg-white shadow-sm text-[#0a0f1d]' : 'text-slate-400'}`}>Markdown</button>
                        <button onClick={() => setMcpFormat('json')} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${mcpFormat === 'json' ? 'bg-white shadow-sm text-[#0a0f1d]' : 'text-slate-400'}`}>JSON Config</button>
                     </div>
                     <button 
                        onClick={handleGenerateMcp}
                        disabled={generatingMcp || !currentExtraction}
                        className="w-full py-4 bg-[#0a0f1d] text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-3"
                     >
                        {generatingMcp ? <ICONS.Loader /> : <ICONS.Server />}
                        {generatingMcp ? 'Transformation...' : 'Demander à l\'Agent'}
                     </button>
                  </div>
                  
                  <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest pl-4 border-l-2 border-slate-200">
                    <p className="mb-2">github.com → gitmcp.io</p>
                    <p>github.io → gitmcp.io</p>
                  </div>
                </div>

                <div className="lg:w-2/3">
                   <div className="bg-[#1e1e1e] rounded-[3rem] p-10 min-h-[600px] shadow-2xl relative overflow-hidden flex flex-col">
                      <div className="flex items-center justify-between mb-8 pb-8 border-b border-white/10">
                         <div className="flex gap-2">
                            <div className="w-3 h-3 rounded-full bg-red-500"></div>
                            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                            <div className="w-3 h-3 rounded-full bg-green-500"></div>
                         </div>
                         <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest">generated_config.{mcpFormat === 'json' ? 'json' : 'md'}</div>
                      </div>
                      
                      <div className="flex-1 font-mono text-sm text-slate-300 overflow-auto whitespace-pre-wrap leading-relaxed no-scrollbar">
                         {mcpResult ? (
                            mcpResult
                         ) : (
                            <div className="h-full flex flex-col items-center justify-center text-white/10">
                               <div className="scale-150 mb-6 opacity-20"><ICONS.Server /></div>
                               <p className="uppercase tracking-[0.2em] font-black text-[10px]">En attente de l'agent...</p>
                            </div>
                         )}
                      </div>

                      {mcpResult && (
                          <div className="pt-6 mt-6 border-t border-white/10 flex justify-end">
                             <button 
                                onClick={() => { navigator.clipboard.writeText(mcpResult); alert('Config copiée !'); }}
                                className="px-6 py-3 bg-white text-black rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-blue-500 hover:text-white transition-colors"
                             >
                                Copier la Config
                             </button>
                          </div>
                      )}
                   </div>
                </div>
             </div>
          </div>
        )}
      </main>

      {/* NEURAL CHAT MODAL */}
      {chatOpen && (
        <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-end p-6 md:p-12 pointer-events-none">
          <div className="w-full max-w-lg h-[600px] bg-white rounded-[3rem] shadow-[0_50px_100px_-20px_rgba(10,15,29,0.3)] border border-slate-100 pointer-events-auto flex flex-col overflow-hidden animate-reveal">
            <div className="p-8 border-b border-slate-50 flex justify-between items-center bg-[#0a0f1d] text-white">
               <div className="flex items-center gap-4">
                  <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
                  <span className="text-[11px] font-black uppercase tracking-[0.3em]">Neural Assistant</span>
               </div>
               <button onClick={() => setChatOpen(false)} className="text-white/50 hover:text-white transition-colors"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
            </div>
            <div className="flex-1 overflow-y-auto p-8 space-y-6 no-scrollbar">
              {chatHistory.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                   <div className={`max-w-[85%] p-5 rounded-3xl text-sm font-medium leading-relaxed ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-slate-50 text-slate-700 rounded-tl-none border border-slate-100'}`}>
                      {msg.text}
                   </div>
                </div>
              ))}
              {isTyping && <div className="text-[10px] font-black text-slate-300 uppercase animate-pulse">Assistant réfléchit...</div>}
              <div ref={chatEndRef} />
            </div>
            <div className="p-6 bg-slate-50">
              <div className="relative">
                <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendMessage()} placeholder="Demandez n'importe quoi sur la stack..." className="w-full py-5 px-8 rounded-2xl border border-slate-200 focus:border-[#0a0f1d] outline-none text-sm font-bold shadow-inner pr-20" />
                <button onClick={sendMessage} className="absolute right-3 top-3 bottom-3 bg-[#0a0f1d] text-white px-5 rounded-xl font-black text-[10px] uppercase hover:bg-blue-600 transition-colors">Envoi</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="max-w-7xl mx-auto px-12 py-20 border-t border-slate-100 flex flex-col md:flex-row justify-between items-center text-slate-300 text-[10px] font-black uppercase tracking-widest gap-10">
         <div className="flex items-center gap-3"><div className="w-8 h-8 rounded-xl bg-slate-100"></div> MIZU.ELITE v3.0 // Neural Workstation</div>
         <div>&copy; {new Date().getFullYear()} // Deep Tech Extraction</div>
      </footer>
    </div>
  );
}