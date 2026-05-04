export interface DigestStory {
  title: string;
  feedName: string;
  feedId: string;
  link: string;
  estimatedDurationSeconds: number;
  summary?: string;
  topicLabel?: string;
}

export interface Folder {
  id: string;
  name: string;
  color: string;
  iconName?: string;
  createdAt: number;
}

export interface Episode {
  id: string;
  title: string;
  sourceUrl: string;
  sourceType?: 'url' | 'text' | 'pdf' | 'digest';
  uri: string;
  durationSeconds: number;
  createdAt: number;
  played: boolean;
  mode: 'podcast' | 'tts';
  thumbnailUrl?: string;
  positionMs?: number;
  folderId?: string;
  deletedAt?: number;
  deletedFromFolderId?: string;
  stories?: DigestStory[];
}

export type JobStatus =
  | { status: 'awaiting_pdf_upload' }
  | { status: 'queued' }
  | { status: 'processing' }
  | { status: 'scripting' }
  | { status: 'generating_audio' }
  | {
      status: 'done';
      title: string;
      thumbnailUrl: string | null;
      durationSeconds: number;
      mode: 'podcast' | 'tts';
      audioUrl: string;
    }
  | { status: 'error'; error: string };

export type DigestJobStatus =
  | { status: 'not_started' }
  | { status: 'queued' }
  | { status: 'fetching_feeds' }
  | { status: 'ranking' }
  | { status: 'summarizing' }
  | { status: 'scripting' }
  | { status: 'generating_audio' }
  | { status: 'done'; digestId: string; title: string; durationSeconds: number; audioUrl: string; stories: DigestStory[] }
  | { status: 'error'; error: string };

export type GenerationInput =
  | { type: 'url'; url: string; voice?: string; language?: string; summarize?: boolean }
  | { type: 'text'; text: string; title?: string; voice?: string; language?: string; summarize?: boolean }
  | { type: 'pdf'; uri: string; title?: string; voice?: string; language?: string; summarize?: boolean };
