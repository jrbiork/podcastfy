import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { GenerationInput, JobStatus } from '../types';
import { dispatchJob, pollJob, downloadAudio } from './api';
import { saveEpisode } from './storage';
import { addGeneratedSeconds } from './subscription';
import { generateId } from '../utils/format';
import { episodeEvents } from '../utils/episodeEvents';
import { generationStore } from '../utils/generationStore';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_FILE_TITLE_LENGTH = 80;

const ERROR_LABELS: Record<string, string> = {
  scrape_protected: 'That site blocks automated access. Try pasting the article text instead.',
  cloudflare_blocked: 'That site blocks automated access. Try pasting the article text instead.',
  scrape_failed: "Couldn't read that page. Check the URL or paste the text directly.",
  article_too_short: 'Not enough content to generate audio.',
  scrape_timeout: 'That page took too long to load. Try again.',
  script_failed: "Couldn't write the script. Try again.",
  tts_failed: "Couldn't generate audio. Try again.",
  timeout: 'Generation timed out. Try again.',
  download_failed: 'Download failed. Try again.',
  not_enough_storage: 'Not enough storage on your device.',
  auth_expired: 'Session expired. Please sign in again.',
  not_signed_in: "You're not signed in.",
  network_error: "Can't reach the server. Check your connection.",
  unknown_error: 'Something went wrong. Try again.',
};

function errorLabel(code: string): string {
  return ERROR_LABELS[code] ?? ERROR_LABELS.unknown_error;
}

function sanitizeTitleForFilename(title: string): string {
  const normalized = title
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[^a-z0-9 _-]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized.slice(0, MAX_FILE_TITLE_LENGTH) || 'Untitled Episode';
}

export async function startGeneration(
  input: GenerationInput,
  mode: 'podcast' | 'tts',
): Promise<void> {
  const genId = generateId();
  generationStore.add({ id: genId, mode, startedAt: Date.now() });

  try {
    const jobId = await dispatchJob(input, mode);

    const episodeId = generateId();

    const startTime = Date.now();
    let finalStatus: Extract<JobStatus, { status: 'done' }> | null = null;

    while (Date.now() - startTime < POLL_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const status = await pollJob(jobId);

      if (status.status === 'error') {
        throw Object.assign(new Error(status.error), { code: status.error });
      }

      if (status.status === 'done') {
        finalStatus = status;
        break;
      }
    }

    if (!finalStatus) throw new Error('timeout');

    const resolvedTitle =
      finalStatus.title ||
      (input.type === 'url'
        ? input.url
        : input.type === 'pdf'
          ? input.title ?? 'Untitled Episode'
          : input.title ?? 'Untitled Episode');
    const safeFileTitle = sanitizeTitleForFilename(resolvedTitle);
    const destUri = `${FileSystem.documentDirectory}${episodeId}-${safeFileTitle}.mp3`;

    await downloadAudio(finalStatus.audioUrl, destUri);
    await addGeneratedSeconds(finalStatus.durationSeconds);

    await saveEpisode({
      id: episodeId,
      title: resolvedTitle,
      sourceUrl: input.type === 'url' ? input.url : '',
      sourceType: input.type,
      uri: destUri,
      durationSeconds: finalStatus.durationSeconds,
      createdAt: Date.now(),
      played: false,
      mode: finalStatus.mode,
      thumbnailUrl: finalStatus.thumbnailUrl ?? undefined,
    });

    // Remove from pending BEFORE emitting so Library reloads with the episode already saved
    generationStore.remove(genId);
    episodeEvents.emit();
  } catch (e: unknown) {
    generationStore.remove(genId);
    const code =
      (e as { code?: string }).code ??
      (e as { message?: string }).message ??
      'unknown_error';

    if (code === 'auth_expired' || code === 'not_signed_in') {
      Alert.alert(
        'Session expired',
        'Your session has expired. Please go to Profile → Sign Out, then sign back in.',
        [{ text: 'OK' }]
      );
      return;
    }

    Alert.alert('Generation failed', errorLabel(code));
  }
}
