import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';

export const ENTITLEMENT_ID = 'premium';
const DIGEST_LISTENED_DATES_KEY = 'podcastify_digest_listened_dates';
const FIRST_DIGEST_DATE_KEY = 'podcastify_first_digest_date';
const DIGEST_HARD_PAYWALL_LISTEN_DAYS = 3;

let configured = false;

function getApiKey(): string | null {
  if (Platform.OS === 'ios') {
    const prod = process.env.EXPO_PUBLIC_REVENUECAT_IOS ?? '';
    const test = process.env.EXPO_PUBLIC_REVENUECAT_IOS_TEST ?? '';
    if (__DEV__ && test) return test;
    return prod || null;
  }
  return null;
}

export async function initPurchases(userId?: string): Promise<void> {
  if (!configured) {
    const apiKey = getApiKey();
    if (!apiKey) return;
    if (!__DEV__ && apiKey.startsWith('test_')) return;
    Purchases.configure({ apiKey });
    configured = true;
  }
  if (userId) {
    try {
      await Purchases.logIn(userId);
    } catch {
      /* non-fatal */
    }
  }
}

export function isPurchasesConfigured(): boolean {
  return configured;
}

export async function getIsSubscribed(): Promise<boolean> {
  if (!configured) return false;
  try {
    const info = await Purchases.getCustomerInfo();
    // Check named entitlement first; fall back to any active subscription
    return (
      info.entitlements.active[ENTITLEMENT_ID] != null ||
      info.activeSubscriptions.length > 0
    );
  } catch {
    return false;
  }
}

export async function getSubscriptionDetails(): Promise<{
  isSubscribed: boolean;
  expirationDate: string | null;
}> {
  if (!configured) return { isSubscribed: false, expirationDate: null };
  try {
    const info = await Purchases.getCustomerInfo();
    const entitlement = info.entitlements.active[ENTITLEMENT_ID];
    const isSubscribed = entitlement != null || info.activeSubscriptions.length > 0;
    return {
      isSubscribed,
      // expirationDate on the entitlement can be null for some plan types;
      // latestExpirationDate is the most reliable fallback across all active subs.
      expirationDate: entitlement?.expirationDate ?? info.latestExpirationDate ?? null,
    };
  } catch {
    return { isSubscribed: false, expirationDate: null };
  }
}

export type DigestTrialState = 'active' | 'hard';

async function getListenedDigestDates(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(DIGEST_LISTENED_DATES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d): d is string => typeof d === 'string' && d.length > 0);
  } catch {
    return [];
  }
}

export async function getDigestTrialState(): Promise<DigestTrialState> {
  try {
    const isSubscribed = await getIsSubscribed();
    if (isSubscribed) return 'active';
    const listenedDates = await getListenedDigestDates();
    if (listenedDates.length >= DIGEST_HARD_PAYWALL_LISTEN_DAYS) return 'hard';
    return 'active';
  } catch {
    return 'active';
  }
}

export async function recordDigestListened(date: string): Promise<boolean> {
  try {
    const { saveUserPreferences } = await import('./api');
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const listenedDates = await getListenedDigestDates();
    const alreadyCounted = listenedDates.includes(date);
    const nextDates = alreadyCounted ? listenedDates : [...listenedDates, date];
    if (!alreadyCounted) {
      await AsyncStorage.setItem(
        DIGEST_LISTENED_DATES_KEY,
        JSON.stringify(nextDates),
      );
      await saveUserPreferences({
        timezone: tz,
        digestListenedDates: nextDates,
      }).catch(() => {});
    }

    // Preserve first-digest server sync behavior for backend analytics/scheduling.
    const existingFirstDigest = await AsyncStorage.getItem(FIRST_DIGEST_DATE_KEY);
    if (!existingFirstDigest) {
      await AsyncStorage.setItem(FIRST_DIGEST_DATE_KEY, String(Date.now()));
      await saveUserPreferences({ timezone: tz, firstDigestDate: date }).catch(() => {});
    }

    // Soft paywall should show once after completing day 1 and day 2 digests.
    return !alreadyCounted && nextDates.length <= DIGEST_HARD_PAYWALL_LISTEN_DAYS;
  } catch {
    return false;
  }
}

export async function syncSubscriptionToServer(): Promise<void> {
  try {
    const isSubscribed = await getIsSubscribed();
    const { saveUserPreferences } = await import('./api');
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await saveUserPreferences({ timezone: tz, subscribed: isSubscribed }).catch(() => {});
  } catch { /* non-fatal */ }
}

export async function purchaseOffering(packageToPurchase: Purchases.PurchasesPackage): Promise<boolean> {
  if (!configured) throw new Error('Subscriptions are not configured.');
  const { customerInfo } = await Purchases.purchasePackage(packageToPurchase);
  return (
    customerInfo.entitlements.active[ENTITLEMENT_ID] != null ||
    customerInfo.activeSubscriptions.length > 0
  );
}

export async function restorePurchases(): Promise<boolean> {
  if (!configured) throw new Error('Subscriptions are not configured.');
  const info = await Purchases.restorePurchases();
  return (
    info.entitlements.active[ENTITLEMENT_ID] != null ||
    info.activeSubscriptions.length > 0
  );
}

export async function clearLocalData(): Promise<void> {
  try {
    await AsyncStorage.removeItem(DIGEST_LISTENED_DATES_KEY);
    await AsyncStorage.removeItem(FIRST_DIGEST_DATE_KEY);
  } catch {
    /* ignore */
  }
}
