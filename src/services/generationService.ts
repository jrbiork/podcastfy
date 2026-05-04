import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { GenerationInput, JobStatus } from '../types';
import { dispatchJob, pollJob, downloadAudio } from './api';
import { saveEpisode, RSS_FOLDER_ID } from './storage';
import { addGeneratedSeconds } from './subscription';
import { generateId } from '../utils/format';
import { episodeEvents } from '../utils/episodeEvents';
import { generationStore } from '../utils/generationStore';
import {
  appendPersistedGenerationJob,
  loadPersistedGenerationJobs,
  removePersistedGenerationJob,
  type PersistedGenerationJob,
} from './generationPersistence';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_FILE_TITLE_LENGTH = 80;

type DoneJobStatus = Extract<JobStatus, { status: 'done' }>;

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
  pdf_upload_failed: "Couldn't upload the PDF. Check your connection and try again.",
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntilDone(jobId: string, deadlineMs: number): Promise<DoneJobStatus> {
  while (Date.now() < deadlineMs) {
    await sleep(POLL_INTERVAL_MS);
    const status = await pollJob(jobId);

    if (status.status === 'error') {
      throw Object.assign(new Error(status.error), { code: status.error });
    }

    if (status.status === 'done') {
      return status;
    }
  }

  throw Object.assign(new Error('timeout'), { code: 'timeout' });
}

async function persistAndFinalizeEpisode(
  genId: string,
  input: GenerationInput | undefined,
  finalStatus: DoneJobStatus,
  folderId?: string,
): Promise<void> {
  const episodeId = generateId();
  const resolvedTitle =
    finalStatus.title ||
    (input?.type === 'url'
      ? input.url
      : input?.type === 'pdf'
        ? input.title ?? 'Untitled Episode'
        : input?.title ?? 'Untitled Episode');
  const safeFileTitle = sanitizeTitleForFilename(resolvedTitle);
  const destUri = `${FileSystem.documentDirectory}${episodeId}-${safeFileTitle}.mp3`;

  await downloadAudio(finalStatus.audioUrl, destUri);
  await addGeneratedSeconds(finalStatus.durationSeconds);

  await saveEpisode({
    id: episodeId,
    title: resolvedTitle,
    sourceUrl: input?.type === 'url' ? input.url : '',
    sourceType: input?.type,
    uri: destUri,
    durationSeconds: finalStatus.durationSeconds,
    createdAt: Date.now(),
    played: false,
    mode: finalStatus.mode,
    thumbnailUrl: finalStatus.thumbnailUrl ?? undefined,
    folderId,
  });

  await removePersistedGenerationJob(genId);
  generationStore.remove(genId);
  episodeEvents.emit();
}

const inflightResume = new Set<string>();

async function resumeGenerationJob(record: PersistedGenerationJob): Promise<void> {
  if (inflightResume.has(record.genId)) return;
  inflightResume.add(record.genId);

  generationStore.add({
    id: record.genId,
    mode: record.mode,
    startedAt: record.startedAt,
  });

  try {
    const deadlineMs = record.startedAt + POLL_TIMEOUT_MS;
    if (Date.now() >= deadlineMs) {
      throw Object.assign(new Error('timeout'), { code: 'timeout' });
    }
    const finalStatus = await pollUntilDone(record.jobId, deadlineMs);
    await persistAndFinalizeEpisode(record.genId, undefined, finalStatus);
  } catch (e: unknown) {
    await removePersistedGenerationJob(record.genId);
    generationStore.remove(record.genId);
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
  } finally {
    inflightResume.delete(record.genId);
  }
}

/** Reload pending jobs after app restart (poll + download using persisted server job IDs). */
export async function resumePersistedGenerations(): Promise<void> {
  const jobs = await loadPersistedGenerationJobs();
  for (const job of jobs) {
    void resumeGenerationJob(job);
  }
}

export async function startGeneration(
  input: GenerationInput,
  mode: 'podcast' | 'tts',
): Promise<void> {
  const genId = generateId();
  const startedAt = Date.now();
  generationStore.add({ id: genId, mode, startedAt });

  try {
    const jobId = await dispatchJob(input, mode);
    await appendPersistedGenerationJob({ genId, jobId, mode, startedAt });

    const finalStatus = await pollUntilDone(jobId, startedAt + POLL_TIMEOUT_MS);
    await persistAndFinalizeEpisode(genId, input, finalStatus);
  } catch (e: unknown) {
    await removePersistedGenerationJob(genId);
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

/** Background generation for RSS feed items. Shows in the generating banner; saves to RSS folder.
 *
 * When `description` is provided and substantial (≥150 chars), the job is dispatched as
 * `type: 'text'` so the Lambda worker uses it directly — bypassing the URL scraper and
 * avoiding `scrape_protected` errors on sites like TechCrunch that block automated access.
 */
export async function startRssGeneration(url: string, title: string, description?: string): Promise<void> {
  const genId = generateId();
  const startedAt = Date.now();

  // Add to the store so LibraryScreen's banner reflects this job
  generationStore.add({ id: genId, mode: 'tts', startedAt });

  // Use RSS description text directly when available — avoids scraper blocks
  const input: GenerationInput =
    description && description.length >= 150
      ? { type: 'text', text: description, title }
      : { type: 'url', url };

  try {
    const jobId = await dispatchJob(input, 'tts');
    await appendPersistedGenerationJob({ genId, jobId, mode: 'tts', startedAt });

    const finalStatus = await pollUntilDone(jobId, startedAt + POLL_TIMEOUT_MS);
    // persistAndFinalizeEpisode calls generationStore.remove + episodeEvents.emit internally
    await persistAndFinalizeEpisode(genId, input, finalStatus, RSS_FOLDER_ID);
  } catch (e: unknown) {
    generationStore.remove(genId);
    await removePersistedGenerationJob(genId);
    console.warn('[rss] background generation failed', { url, title, error: (e as Error).message });
  }
}
