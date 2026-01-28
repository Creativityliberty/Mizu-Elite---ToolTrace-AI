import { SUPADATA_API_KEY } from '../constants';

export const fetchTranscript = async (url: string): Promise<any> => {
  const response = await fetch(`https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(url)}&text=false`, {
    headers: { 'x-api-key': SUPADATA_API_KEY }
  });
  
  let data;
  try {
    data = await response.json();
  } catch (e) {
    throw new Error('Impossible de lire la réponse du serveur (JSON invalide)');
  }
  
  if (!response.ok) {
    throw new Error(data.message || 'Échec de la récupération du transcript');
  }
  
  return data;
};

export const pollJobStatus = async (jobId: string): Promise<any> => {
  const response = await fetch(`https://api.supadata.ai/v1/transcript/${jobId}`, {
    headers: { 'x-api-key': SUPADATA_API_KEY }
  });
  
  if (!response.ok) {
    throw new Error('Échec de la vérification du statut du travail');
  }
  
  return response.json();
};