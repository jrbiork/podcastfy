export interface Folder {
  id: string;
  name: string;
  color: string;
  createdAt: number;
}

export interface Episode {
  id: string;
  title: string;
  sourceUrl: string;
  uri: string;
  durationSeconds: number;
  createdAt: number;
  played: boolean;
  mode: 'podcast' | 'tts';
  thumbnailUrl?: string;
  positionMs?: number;
  folderId?: string;
}

export type JobStatus =
  | { status: 'queued' }
  | { status: 'processing' }
  | { status: 'scripting' }
  | { status: 'generating_audio' }
  | { status: 'done'; title: string; thumbnailUrl: string | null; durationSeconds: number; mode: 'podcast' | 'tts' }
  | { status: 'error'; error: string };

export type GenerationInput =
  | { type: 'url'; url: string }
  | { type: 'text'; text: string; title?: string };
