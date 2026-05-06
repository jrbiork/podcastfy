import { useState, useRef, useCallback } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { Episode, GenerationInput, JobStatus } from '../types';
import { dispatchJob, pollJob, downloadAudio } from '../services/api';
import { generateId } from '../utils/format';

export type GenerateStep =
  | 'queued'
  | 'processing'
  | 'scripting'
  | 'generating_audio'
  | 'downloading'
  | 'done'
  | 'error';

export type GenerateState = {
  step: GenerateStep;
  error: string | null;
};

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000; // align with long PDF / worker runs

export function useGenerate() {
  const [state, setState] = useState<GenerateState>({ step: 'queued', error: null });
  const [isGenerating, setIsGenerating] = useState(false);
  const abortRef = useRef(false);

  const generate = useCallback(
    async (
      input: GenerationInput,
      mode: 'podcast' | 'tts',
      onComplete: (episode: Episode) => void
    ) => {
      abortRef.current = false;
      setIsGenerating(true);
      setState({ step: 'queued', error: null });

      try {
        const jobId = await dispatchJob(input, mode);
        if (abortRef.current) return;

        const episodeId = generateId();
        const destUri = `${FileSystem.documentDirectory}${episodeId}.mp3`;

        const startTime = Date.now();
        let finalStatus: Extract<JobStatus, { status: 'done' }> | null = null;

        while (Date.now() - startTime < POLL_TIMEOUT_MS) {
          if (abortRef.current) return;

          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
          if (abortRef.current) return;

          const status = await pollJob(jobId);

          if (status.status === 'error') {
            throw Object.assign(new Error(status.error), { code: status.error });
          }

          const step: GenerateStep =
            status.status === 'awaiting_pdf_upload' ? 'queued' : (status.status as GenerateStep);
          setState({ step, error: null });

          if (status.status === 'done') {
            finalStatus = status;
            break;
          }
        }

        if (!finalStatus) throw new Error('timeout');

        setState({ step: 'downloading', error: null });
        await downloadAudio(finalStatus.audioUrl, destUri);

        const episode: Episode = {
          id: episodeId,
          title: finalStatus.title || (input.type === 'url' ? input.url : 'Untitled Episode'),
          sourceUrl: input.type === 'url' ? input.url : '',
          uri: destUri,
          durationSeconds: finalStatus.durationSeconds,
          createdAt: Date.now(),
          played: false,
          mode: finalStatus.mode,
          thumbnailUrl: finalStatus.thumbnailUrl ?? undefined,
        };

        setState({ step: 'done', error: null });
        onComplete(episode);
      } catch (e: unknown) {
        const code =
          (e as { code?: string }).code ??
          (e as { message?: string }).message ??
          'unknown_error';
        console.error('[generate] failed', {
          code,
          message: (e as { message?: string }).message ?? null,
          inputType: input.type,
          mode,
        });
        setState({ step: 'error', error: code });
      } finally {
        setIsGenerating(false);
      }
    },
    []
  );

  const cancel = useCallback(() => {
    abortRef.current = true;
    setIsGenerating(false);
    setState({ step: 'queued', error: null });
  }, []);

  return { state, isGenerating, generate, cancel };
}
