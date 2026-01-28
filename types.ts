export interface VideoMetadata {
  title?: string;
  author?: string;
  description?: string;
  thumbnailUrl?: string;
}

export interface TranscriptChunk {
  text: string;
  offset: number;
  duration: number;
  lang: string;
}

export interface ToolMention {
  name: string;
  normalized: string;
  category: string;
  mentionsCount: number;
  confidence: number;
  officialUrl?: string;
  githubUrl?: string;
  aiThumbnail?: string;
  timestampLabel?: string; // e.g., "04:22"
  timestampOffset?: number; // seconds
  notes: string[];
}

export interface ExtractionResult {
  id: string;
  video?: VideoMetadata;
  tools: ToolMention[];
  groundingUrls?: string[];
  timestamp: number;
  stats: {
    totalTools: number;
    processingTimeMs: number;
  };
}

export enum AnalysisStep {
  IDLE = 'IDLE',
  FETCHING_TRANSCRIPT = 'FETCHING_TRANSCRIPT',
  TRANSCRIPT_PROCESSING = 'TRANSCRIPT_PROCESSING',
  AI_EXTRACTION = 'AI_EXTRACTION',
  AI_VISUAL_GEN = 'AI_VISUAL_GEN',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

export type ViewState = 'SCAN' | 'LIBRARY' | 'DASHBOARD' | 'MCP';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}