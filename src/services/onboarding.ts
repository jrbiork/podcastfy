import AsyncStorage from '@react-native-async-storage/async-storage';
import { TOPIC_FEED_URLS_BY_ID } from '../data/topicFeedMap';

const KEY = 'onboarding_completed';
const PREFS_KEY = 'onboarding_prefs_v1';

/** Maps legacy `selectedTopics` values to current topic IDs. */
const LEGACY_TOPIC_ID_MAP: Record<string, string> = {
  'ai-tech': 'technology',
  world: 'news',
  finance: 'business-finance',
  climate: 'environment',
  culture: 'entertainment-news',
  health: 'fitness',
  'health-wellness': 'fitness',
  sports: 'fitness',
  crypto: 'crypto',
  'crypto-web3': 'crypto',
};

export const ONBOARDING_TOPIC_ORDER: string[] = [
  'news',
  'technology',
  'economy',
  'business-finance',
  'politics',
  'science',
  'productivity',
  'fitness',
  'mental-health',
  'food',
  'travel',
  'parenting',
  'entertainment-news',
  'movies-tv',
  'music',
  'gaming',
  'startups',
  'crypto',
  'environment',
];

export function normalizeTopicId(id: string): string {
  return LEGACY_TOPIC_ID_MAP[id] ?? id;
}

export async function hasCompletedOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === 'true';
  } catch {
    return false;
  }
}

export async function setOnboardingComplete(): Promise<void> {
  await AsyncStorage.setItem(KEY, 'true');
}

export async function clearOnboardingProgress(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

// ── Onboarding preferences ────────────────────────────────────────────────────

export interface OnboardingPrefs {
  selectedTopics: string[];
  /** @deprecated Duration is now fixed at ~5–8 min. Field kept for backward compat with stored prefs. */
  durationMinutes?: 3 | 5 | 10;
  deliveryHour: number; // 0-23
  deliveryLabel: string; // e.g. "Before work", "Morning routine"
  voice?: string; // TTS voice for daily digest (alloy, echo, fable, nova, onyx, shimmer)
}

function normalizePrefsTopics(prefs: OnboardingPrefs): OnboardingPrefs {
  const valid = new Set(ONBOARDING_TOPIC_ORDER);
  const next: string[] = [];
  const seen = new Set<string>();
  for (const raw of prefs.selectedTopics) {
    const id = normalizeTopicId(raw);
    if (!valid.has(id) || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return { ...prefs, selectedTopics: next };
}

export async function saveOnboardingPrefs(prefs: OnboardingPrefs): Promise<void> {
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(normalizePrefsTopics(prefs)));
}

export async function loadOnboardingPrefs(): Promise<OnboardingPrefs | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OnboardingPrefs;
    return normalizePrefsTopics(parsed);
  } catch {
    return null;
  }
}

export async function clearOnboardingPrefs(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PREFS_KEY);
  } catch {
    /* ignore */
  }
}

// ── Topics ────────────────────────────────────────────────────────────────────

export type TopicGroupId = 'daily' | 'lifestyle' | 'entertainment' | 'niche';

export interface TopicDef {
  id: string;
  label: string;
  icon: string;
  feedUrls: string[];
  group: TopicGroupId;
}

export const TOPIC_GROUPS: Array<{ id: TopicGroupId; label: string }> = [
  { id: 'daily', label: 'Core daily habits' },
  { id: 'lifestyle', label: 'Lifestyle & wellbeing' },
  { id: 'entertainment', label: 'Entertainment & culture' },
  { id: 'niche', label: 'Niche & specialist' },
];

function feedUrlsForTopic(id: string): string[] {
  return [...(TOPIC_FEED_URLS_BY_ID[id] ?? [])];
}

export const ONBOARDING_TOPICS: TopicDef[] = [
  {
    id: 'news',
    label: 'News (General / World)',
    icon: 'globe-outline',
    group: 'daily',
    feedUrls: feedUrlsForTopic('news'),
  },
  {
    id: 'technology',
    label: 'Technology',
    icon: 'hardware-chip-outline',
    group: 'daily',
    feedUrls: feedUrlsForTopic('technology'),
  },
  {
    id: 'economy',
    label: 'Economy',
    icon: 'cash-outline',
    group: 'daily',
    feedUrls: feedUrlsForTopic('economy'),
  },
  {
    id: 'business-finance',
    label: 'Business & Finance',
    icon: 'trending-up-outline',
    group: 'daily',
    feedUrls: feedUrlsForTopic('business-finance'),
  },
  {
    id: 'politics',
    label: 'Politics',
    icon: 'megaphone-outline',
    group: 'daily',
    feedUrls: feedUrlsForTopic('politics'),
  },
  {
    id: 'science',
    label: 'Science',
    icon: 'flask-outline',
    group: 'daily',
    feedUrls: feedUrlsForTopic('science'),
  },
  {
    id: 'productivity',
    label: 'Productivity & Self-improvement',
    icon: 'rocket-outline',
    group: 'lifestyle',
    feedUrls: feedUrlsForTopic('productivity'),
  },
  {
    id: 'fitness',
    label: 'Fitness',
    icon: 'barbell-outline',
    group: 'lifestyle',
    feedUrls: feedUrlsForTopic('fitness'),
  },
  {
    id: 'mental-health',
    label: 'Mental Health',
    icon: 'happy-outline',
    group: 'lifestyle',
    feedUrls: feedUrlsForTopic('mental-health'),
  },
  {
    id: 'food',
    label: 'Food & Cooking',
    icon: 'restaurant-outline',
    group: 'lifestyle',
    feedUrls: feedUrlsForTopic('food'),
  },
  {
    id: 'travel',
    label: 'Travel',
    icon: 'airplane-outline',
    group: 'lifestyle',
    feedUrls: feedUrlsForTopic('travel'),
  },
  {
    id: 'parenting',
    label: 'Parenting & Family',
    icon: 'people-outline',
    group: 'lifestyle',
    feedUrls: feedUrlsForTopic('parenting'),
  },
  {
    id: 'entertainment-news',
    label: 'Entertainment News',
    icon: 'star-outline',
    group: 'entertainment',
    feedUrls: feedUrlsForTopic('entertainment-news'),
  },
  {
    id: 'movies-tv',
    label: 'Movies & TV Shows',
    icon: 'film-outline',
    group: 'entertainment',
    feedUrls: feedUrlsForTopic('movies-tv'),
  },
  {
    id: 'music',
    label: 'Music',
    icon: 'musical-notes-outline',
    group: 'entertainment',
    feedUrls: feedUrlsForTopic('music'),
  },
  {
    id: 'gaming',
    label: 'Gaming',
    icon: 'game-controller-outline',
    group: 'entertainment',
    feedUrls: feedUrlsForTopic('gaming'),
  },
  {
    id: 'startups',
    label: 'Startups & Entrepreneurship',
    icon: 'bulb-outline',
    group: 'niche',
    feedUrls: feedUrlsForTopic('startups'),
  },
  {
    id: 'crypto',
    label: 'Crypto',
    icon: 'logo-bitcoin',
    group: 'niche',
    feedUrls: feedUrlsForTopic('crypto'),
  },
  {
    id: 'environment',
    label: 'Environment & Sustainability',
    icon: 'leaf-outline',
    group: 'niche',
    feedUrls: feedUrlsForTopic('environment'),
  },
];

export const DEFAULT_TOPICS: string[] = ['news', 'technology', 'business-finance', 'science'];

export function topicsToFeedUrls(topicIds: string[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of topicIds) {
    const id = normalizeTopicId(raw);
    const topic = ONBOARDING_TOPICS.find((t) => t.id === id);
    for (const url of topic?.feedUrls ?? []) {
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
  }
  return urls;
}

export function formatDeliveryHour(hour: number): string {
  const period = hour < 12 ? 'AM' : 'PM';
  const h = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h}:00 ${period}`;
}

// ── Preview sample headlines ──────────────────────────────────────────────────

const TOPIC_SAMPLE_HEADLINES: Record<string, string> = {
  news: 'G7 leaders gather for annual economic summit amid ongoing trade tensions',
  technology: 'OpenAI unveils next-generation reasoning model with improved accuracy',
  economy: 'US payroll growth slows while wage gains stay resilient, lifting soft-landing hopes',
  'business-finance': 'Federal Reserve holds rates steady as core inflation cools to 2.3 percent',
  politics: 'Senate advances bipartisan infrastructure bill in rare late-night vote',
  science: 'Scientists confirm first detection of water ice beneath the Martian surface',
  productivity: 'New study links short morning routines to sharper focus through the workday',
  fitness: 'Strength training twice weekly tied to lower all-cause mortality in large cohort',
  'mental-health': 'Digital mindfulness programs show modest gains in anxiety symptoms, meta-analysis finds',
  food: 'Plant-forward diets linked to slower cognitive decline in decade-long nutrition study',
  travel: 'European capitals see record spring bookings as long-haul fares dip from 2025 peaks',
  parenting: 'New research highlights long-term benefits of unstructured play in early childhood',
  'entertainment-news': 'Major streamer renews flagship drama for two additional seasons',
  'movies-tv': 'Award-season favorite adds surprise midnight screenings ahead of global release',
  music: 'Festival organizers announce carbon-neutral stages for flagship summer events',
  gaming: 'Indie breakout hits two million players after word-of-mouth surge on social platforms',
  startups: 'Startup funding rebounds sharply in early 2026, led by AI infrastructure companies',
  crypto: 'Bitcoin stabilizes above key level as institutional custody products expand',
  environment: 'Record ocean temperatures accelerate push toward renewable energy transition',
};

export function getPreviewHeadlines(topicIds: string[]): string[] {
  const headlines: string[] = [];
  for (const raw of topicIds) {
    const id = normalizeTopicId(raw);
    const h = TOPIC_SAMPLE_HEADLINES[id];
    if (h) {
      headlines.push(h);
      if (headlines.length >= 3) break;
    }
  }
  if (headlines.length < 3) {
    for (const id of Object.keys(TOPIC_SAMPLE_HEADLINES)) {
      if (headlines.length >= 3) break;
      const h = TOPIC_SAMPLE_HEADLINES[id];
      if (h && !headlines.includes(h)) headlines.push(h);
    }
  }
  return headlines.slice(0, 3);
}

/** Compact clock for cards, e.g. 7:00 (24h style). */
export function formatDeliveryClock(hour: number): string {
  return `${hour}:00`;
}
