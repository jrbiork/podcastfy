import * as FileSystem from 'expo-file-system/legacy';
import { Episode } from '../types';
import { dispatchDigest, getLatestDigest, downloadAudio, getUserPreferences } from './api';
import { loadEpisodes, saveEpisode, permanentDeleteEpisode, RSS_FOLDER_ID } from './storage';
import { generateId } from '../utils/format';
import { episodeEvents } from '../utils/episodeEvents';
import { loadOnboardingPrefs, DEFAULT_TOPICS } from './onboarding';
import { getTopicFeedUrls } from './rssService';

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 15 * 60 * 1_000;

export type DigestProgress = {
  status: string;
  label: string;
};

export const DIGEST_STATUS_LABELS: Record<string, string> = {
  queued: 'Getting started…',
  fetching_feeds: "Fetching today's news…",
  ranking: 'Selecting top stories…',
  summarizing: 'Reading articles…',
  scripting: 'Writing your briefing…',
  generating_audio: 'Recording audio…',
  done: 'Ready',
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fixed digest size targeting ~5–8 min of audio
const DEFAULT_TOP_N = 9;

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function findTodaysDigestEpisode(): Promise<Episode | null> {
  const today = todayUtcDate();
  const episodes = await loadEpisodes();
  const match = episodes.find(
    (ep) =>
      ep.sourceType === 'digest' &&
      // digestId format is "{userId}/{date}" — ends with today's date
      ep.sourceUrl.endsWith(`/${today}`)
  );
  return match ?? null;
}

/**
 * Returns the episode with stories backfilled from the server, or null when the
 * server is also "done" but has no stories (caller should force-regenerate).
 */
async function backfillStories(episode: Episode): Promise<Episode | null> {
  try {
    const serverStatus = await getLatestDigest();
    if (serverStatus.status === 'done') {
      const stories = Array.isArray((serverStatus as Record<string, unknown>).stories)
        ? (serverStatus as { stories: import('../types').DigestStory[] }).stories
        : [];
      if (stories.length > 0) {
        const updated: Episode = { ...episode, stories };
        await saveEpisode(updated);
        return updated;
      }
      // Server is done but also missing stories — signal caller to force-regenerate
      return null;
    }
  } catch {
    // Server unreachable — return episode as-is
  }
  return episode;
}

export async function getOrCreateTodayDigest(
  onProgress: (p: DigestProgress) => void,
): Promise<Episode> {
  // Local prefs are cleared after onboarding; server (Dynamo) is source of truth for topics, voice, length, feed URLs.
  const [localPrefs, serverPrefs] = await Promise.all([
    loadOnboardingPrefs(),
    getUserPreferences().catch(() => null),
  ]);

  const selectedTopics =
    (localPrefs?.selectedTopics?.length ? localPrefs.selectedTopics : null) ??
    (serverPrefs?.selectedTopics && serverPrefs.selectedTopics.length > 0
      ? [...serverPrefs.selectedTopics]
      : null) ??
    DEFAULT_TOPICS;

  const voice =
    (typeof localPrefs?.voice === 'string' && localPrefs.voice ? localPrefs.voice : undefined) ??
    (typeof serverPrefs?.voice === 'string' && serverPrefs.voice ? serverPrefs.voice : undefined);

  const topicFeedUrls = getTopicFeedUrls(selectedTopics);
  const flatFeedUrls =
    serverPrefs?.feedUrls && serverPrefs.feedUrls.length > 0
      ? serverPrefs.feedUrls.slice(0, 50)
      : undefined;

  const topN = DEFAULT_TOP_N;

  // 1. Check local storage first (handles re-mounts and app restarts)
  const existing = await findTodaysDigestEpisode();
  if (existing) {
    onProgress({ status: 'done', label: DIGEST_STATUS_LABELS.done });
    // Backfill stories if the episode was saved before the stories field existed
    if (!existing.stories || existing.stories.length === 0) {
      const backfilled = await backfillStories(existing);
      if (backfilled !== null) return backfilled;
      // Server is also done with no stories: permanently delete stale local copy
      // and force-regenerate so the worker re-runs from scratch.
      await permanentDeleteEpisode(existing.id);
      await dispatchDigest(
        flatFeedUrls?.length ? undefined : topicFeedUrls,
        true,
        voice,
        topN,
        flatFeedUrls?.length ? flatFeedUrls : undefined,
      );
      onProgress({ status: 'queued', label: DIGEST_STATUS_LABELS.queued });
      return pollUntilDone(onProgress);
    }
    return existing;
  }

  // 2. Check server state
  const serverStatus = await getLatestDigest();

  if (serverStatus.status === 'done') {
    return downloadAndSaveDigest(serverStatus.digestId, serverStatus.audioUrl, serverStatus.title, serverStatus.durationSeconds, serverStatus.stories, onProgress);
  }

  // 3. Dispatch (idempotent — server returns existing status if already in-progress)
  if (serverStatus.status === 'not_started' || serverStatus.status === 'error') {
    await dispatchDigest(
      flatFeedUrls?.length ? undefined : topicFeedUrls,
      false,
      voice,
      topN,
      flatFeedUrls?.length ? flatFeedUrls : undefined,
    );
  }

  onProgress({ status: 'queued', label: DIGEST_STATUS_LABELS.queued });

  return pollUntilDone(onProgress);
}

async function pollUntilDone(onProgress: (p: DigestProgress) => void): Promise<Episode> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const status = await getLatestDigest();

    if (status.status === 'error') {
      throw Object.assign(new Error(status.error), { code: status.error });
    }

    if (status.status === 'done') {
      return downloadAndSaveDigest(status.digestId, status.audioUrl, status.title, status.durationSeconds, status.stories, onProgress);
    }

    onProgress({
      status: status.status,
      label: DIGEST_STATUS_LABELS[status.status] ?? status.status,
    });
  }

  throw Object.assign(new Error('timeout'), { code: 'timeout' });
}

async function downloadAndSaveDigest(
  digestId: string,
  audioUrl: string,
  title: string,
  durationSeconds: number,
  stories: import('../types').DigestStory[],
  onProgress: (p: DigestProgress) => void
): Promise<Episode> {
  // Re-check local storage in case another call already downloaded it
  const alreadyDownloaded = await findTodaysDigestEpisode();
  if (alreadyDownloaded) {
    onProgress({ status: 'done', label: DIGEST_STATUS_LABELS.done });
    if (stories.length > 0 && (!alreadyDownloaded.stories || alreadyDownloaded.stories.length === 0)) {
      const updated: Episode = { ...alreadyDownloaded, stories };
      await saveEpisode(updated);
      return updated;
    }
    return alreadyDownloaded;
  }

  const episodeId = generateId();
  const safeTitle = title.replace(/[^a-z0-9 _-]+/gi, ' ').trim().slice(0, 80) || 'Daily Briefing';
  const destUri = `${FileSystem.documentDirectory}${episodeId}-${safeTitle}.mp3`;

  await downloadAudio(audioUrl, destUri);

  const episode: Episode = {
    id: episodeId,
    title,
    sourceUrl: digestId,
    sourceType: 'digest',
    uri: destUri,
    durationSeconds,
    createdAt: Date.now(),
    played: false,
    mode: 'tts',
    stories,
    folderId: RSS_FOLDER_ID,
  };

  await saveEpisode(episode);
  episodeEvents.emit();

  onProgress({ status: 'done', label: DIGEST_STATUS_LABELS.done });
  return episode;
}
