import AsyncStorage from '@react-native-async-storage/async-storage';

console.log('[Analytics] module loaded');

const MEASUREMENT_ID = process.env.EXPO_PUBLIC_GA4_MEASUREMENT_ID ?? '';
const API_SECRET = process.env.EXPO_PUBLIC_GA4_API_SECRET ?? '';
const CLIENT_ID_KEY = 'ga4_client_id';

let cachedClientId: string | null = null;

/** Call after `AsyncStorage.clear()` so the in-memory id matches a fresh store. */
export function resetGa4ClientIdCache() {
  cachedClientId = null;
}

async function getClientId(): Promise<string> {
  if (cachedClientId) return cachedClientId;
  try {
    const stored = await AsyncStorage.getItem(CLIENT_ID_KEY);
    if (stored) {
      cachedClientId = stored;
      return stored;
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await AsyncStorage.setItem(CLIENT_ID_KEY, id);
    cachedClientId = id;
    return id;
  } catch {
    return 'anonymous';
  }
}

/**
 * Fire-and-forget GA4 event via Measurement Protocol.
 * Never throws — analytics must never block or break the UI.
 */
export async function trackEvent(
  name: string,
  params?: Record<string, string | number | boolean>
): Promise<void> {
  if (params && Object.keys(params).length > 0) {
    console.log(`[Analytics] ${name}`, params);
  } else {
    console.log(`[Analytics] ${name}`);
  }

  if (!MEASUREMENT_ID || !API_SECRET) return;

  try {
    const clientId = await getClientId();
    await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          events: [{
            name,
            params: { engagement_time_msec: 100, ...(params ?? {}) },
          }],
        }),
      }
    );
  } catch {
    // silently ignore — analytics should never crash the app
  }
}

export const Analytics = {
  appOpen: () => trackEvent('app_open'),
  onboardingCompleted: () => trackEvent('onboarding_completed'),
  digestStarted: (date: string) => trackEvent('digest_started', { date }),
  digestListenEnded: (listenPct: number, completed: boolean, durationMs: number) =>
    trackEvent('digest_listen_ended', { listen_pct: listenPct, completed, duration_ms: durationMs }),
  paywallShown: (type: 'soft' | 'hard') => trackEvent('paywall_shown', { type }),
  paywallSubscribeTapped: (packageType: string, price: string) =>
    trackEvent('paywall_subscribe_tapped', { package_type: packageType, price }),
  paywallDismissed: () => trackEvent('paywall_dismissed'),
  subscriptionStarted: (packageId: string) =>
    trackEvent('subscription_started', { package_id: packageId }),
  purchaseFailed: (packageType: string, reason: string) =>
    trackEvent('purchase_failed', { package_type: packageType, reason }),
  restoreTapped: () => trackEvent('restore_tapped'),
  restoreSuccess: () => trackEvent('restore_success'),
  restoreFailed: (reason: string) => trackEvent('restore_failed', { reason }),
  signIn: (provider: 'google' | 'apple') => trackEvent('sign_in', { provider }),
  signInError: (provider: 'google' | 'apple', error: string) =>
    trackEvent('sign_in_error', { provider, error }),
  generateStarted: (mode: string, inputType: 'url' | 'text' | 'pdf', summarize: boolean) =>
    trackEvent('generate_started', { mode, input_type: inputType, summarize }),
  playerOpened: (title: string, mode: string) =>
    trackEvent('player_opened', { episode_title: title, mode }),
  episodePlayed: (title: string, positionS: number) =>
    trackEvent('episode_played', { episode_title: title, position_s: positionS }),
  episodePaused: (title: string, positionS: number) =>
    trackEvent('episode_paused', { episode_title: title, position_s: positionS }),
  episodeCompleted: (title: string, durationS: number) =>
    trackEvent('episode_completed', { episode_title: title, duration_s: durationS }),
  episodeRestarted: (title: string) => trackEvent('episode_restarted', { episode_title: title }),
  episodeSeeked: (title: string, fromS: number, toS: number) =>
    trackEvent('episode_seeked', { episode_title: title, from_s: fromS, to_s: toS }),
  episodeSkipped: (title: string, direction: 'back' | 'forward', amountS: number, positionS: number) =>
    trackEvent('episode_skipped', { episode_title: title, direction, amount_s: amountS, position_s: positionS }),
  playbackSpeedChanged: (speed: number, title: string) =>
    trackEvent('playback_speed_changed', { speed, episode_title: title }),
};
