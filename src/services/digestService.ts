import * as FileSystem from 'expo-file-system/legacy';
import { Episode } from '../types';
import {
  dispatchDigest,
  getLatestDigest,
  downloadAudio,
  getUserPreferences,
} from './api';
import {
  loadEpisodes,
  saveEpisode,
  permanentDeleteEpisode,
  RSS_FOLDER_ID,
} from './storage';
import { generateId } from '../utils/format';
import { episodeEvents } from '../utils/episodeEvents';
import { loadOnboardingPrefs, DEFAULT_TOPICS } from './onboarding';
import { getTopicFeedUrls } from './rssService';
import { getDebugTodayUtc, getDebugDateOffset } from '../utils/debugDate';

// Fixed digest size targeting ~5–7 min of audio
const DEFAULT_TOP_N = 9;

export type DigestBootResult =
  | { type: 'ready'; episode: Episode }
  | { type: 'preparing' };

export type DigestPollResult =
  | { type: 'ready'; episode: Episode }
  | { type: 'in_progress'; status: string };

function storiesNeedRefresh(
  existingStories: import('../types').DigestStory[] | undefined,
  incomingStories: import('../types').DigestStory[],
): boolean {
  if (incomingStories.length === 0) return false;
  if (!existingStories || existingStories.length === 0) return true;
  if (existingStories.length !== incomingStories.length) return true;

  for (let i = 0; i < incomingStories.length; i++) {
    const existing = existingStories[i];
    const incoming = incomingStories[i];
    if (!existing || !incoming) return true;
    if (existing.title !== incoming.title) return true;
    if (existing.spokenText !== incoming.spokenText) return true;
  }
  return false;
}

function todayUtcDate(): string {
  return getDebugTodayUtc();
}

/**
 * Returns true when the server's digestId is for the current (debug-aware) date.
 * In __DEV__ with a non-zero offset we skip the check so the forced-regenerated
 * digest is always accepted, regardless of the server's real date.
 */
function isDigestForToday(digestId: string): boolean {
  if (__DEV__ && getDebugDateOffset() !== 0) return true;
  return digestId?.endsWith(`/${todayUtcDate()}`);
}

async function findTodaysDigestEpisode(): Promise<Episode | null> {
  const today = todayUtcDate();
  const episodes = await loadEpisodes();
  const match = episodes.find(
    (ep) =>
      ep.sourceType === 'digest' &&
      // digestId format is "{userId}/{date}" — ends with today's date
      ep.sourceUrl.endsWith(`/${today}`),
  );
  return match ?? null;
}

async function resolvePrefs() {
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
    (typeof localPrefs?.voice === 'string' && localPrefs.voice
      ? localPrefs.voice
      : undefined) ??
    (typeof serverPrefs?.voice === 'string' && serverPrefs.voice
      ? serverPrefs.voice
      : undefined);

  const topicFeedUrls = getTopicFeedUrls(selectedTopics);
  const effectiveTopicFeedUrls =
    serverPrefs?.topicFeedUrls &&
    Object.keys(serverPrefs.topicFeedUrls).length > 0
      ? serverPrefs.topicFeedUrls
      : topicFeedUrls;

  return { voice, effectiveTopicFeedUrls };
}

async function downloadAndSaveDigest(
  digestId: string,
  audioUrl: string,
  title: string,
  durationSeconds: number,
  stories: import('../types').DigestStory[],
): Promise<Episode> {
  // Re-check local storage in case another call already downloaded it
  const alreadyDownloaded = await findTodaysDigestEpisode();
  if (alreadyDownloaded) {
    if (storiesNeedRefresh(alreadyDownloaded.stories, stories)) {
      const updated: Episode = {
        ...alreadyDownloaded,
        title,
        sourceUrl: digestId,
        durationSeconds,
        stories,
      };
      await saveEpisode(updated);
      return updated;
    }
    return alreadyDownloaded;
  }

  const episodeId = generateId();
  const safeTitle =
    title
      .replace(/[^a-z0-9 _-]+/gi, ' ')
      .trim()
      .slice(0, 80) || 'Daily Briefing';
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
  return episode;
}

/**
 * Fast boot: dispatches generation if needed but never waits for it.
 * Returns immediately with either the ready episode or a 'preparing' token.
 * The caller is responsible for polling via pollTodayDigestStatus.
 */
export async function bootTodayDigest(): Promise<DigestBootResult> {
  const { voice, effectiveTopicFeedUrls } = await resolvePrefs();
  const existing = await findTodaysDigestEpisode();

  let serverStatus: Awaited<ReturnType<typeof getLatestDigest>> | null = null;
  try {
    serverStatus = await getLatestDigest();
  } catch {
    // Offline — serve local copy if available, otherwise show preparing
    if (existing) return { type: 'ready', episode: existing };
    return { type: 'preparing' };
  }

  if (serverStatus.status === 'done') {
    if (isDigestForToday(serverStatus.digestId)) {
      // Today's digest is ready — download and return it
      if (existing) await permanentDeleteEpisode(existing.id);
      episodeEvents.emit();
      const episode = await downloadAndSaveDigest(
        serverStatus.digestId,
        serverStatus.audioUrl,
        serverStatus.title,
        serverStatus.durationSeconds,
        serverStatus.stories,
      );
      return { type: 'ready', episode };
    }

    // Done digest is from a previous day — treat as stale and regenerate.
    // In __DEV__ with an offset we force-regenerate so the server overwrites
    // the cached done status; in production the new date key is always fresh.
    if (existing) {
      await permanentDeleteEpisode(existing.id);
      episodeEvents.emit();
    }
    const forceRegen = __DEV__ && getDebugDateOffset() !== 0;
    try {
      await dispatchDigest(effectiveTopicFeedUrls, forceRegen, voice, DEFAULT_TOP_N);
    } catch {
      // Dispatch failed (network) — show preparing; will retry on next poll
    }
    return { type: 'preparing' };
  }

  // Already generating — nothing extra to dispatch
  const inProgressStatuses = new Set([
    'queued',
    'fetching_feeds',
    'ranking',
    'summarizing',
    'scripting',
    'generating_audio',
  ]);
  if (inProgressStatuses.has(serverStatus.status)) {
    return { type: 'preparing' };
  }

  // not_started or error — kick off generation and return immediately
  if (existing) {
    await permanentDeleteEpisode(existing.id);
    episodeEvents.emit();
  }
  try {
    await dispatchDigest(effectiveTopicFeedUrls, false, voice, DEFAULT_TOP_N);
  } catch {
    // Dispatch failed (network) — show preparing anyway; will retry on next poll
  }

  return { type: 'preparing' };
}

/**
 * Single non-blocking poll for background status checks.
 * Returns 'ready' + episode once done, or 'in_progress' + current server
 * status string so the caller can drive step-by-step progress UI.
 */
export async function pollTodayDigestStatus(): Promise<DigestPollResult> {
  try {
    const status = await getLatestDigest();

    if (status.status === 'done' && isDigestForToday(status.digestId)) {
      const existing = await findTodaysDigestEpisode();
      if (existing) await permanentDeleteEpisode(existing.id);
      episodeEvents.emit();
      const episode = await downloadAndSaveDigest(
        status.digestId,
        status.audioUrl,
        status.title,
        status.durationSeconds,
        status.stories,
      );
      return { type: 'ready', episode };
    }

    return { type: 'in_progress', status: status.status };
  } catch {
    // Network unavailable — check local storage as a last resort
    const local = await findTodaysDigestEpisode();
    if (local) return { type: 'ready', episode: local };
    return { type: 'in_progress', status: '' };
  }
}
