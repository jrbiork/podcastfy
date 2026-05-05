import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';

export const ENTITLEMENT_ID = 'premium';
export const FREE_LIMIT_SECONDS = 60; // 1 minute
export const DIGEST_SOFT_PAYWALL_DAYS = 3;
export const DIGEST_HARD_PAYWALL_DAYS = 4;

const TOTAL_SECONDS_KEY = 'podcastify_total_seconds';
const FIRST_DIGEST_DATE_KEY = 'podcastify_first_digest_date';

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

export async function getTotalGeneratedSeconds(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(TOTAL_SECONDS_KEY);
    return raw ? parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

export async function addGeneratedSeconds(seconds: number): Promise<void> {
  const current = await getTotalGeneratedSeconds();
  await AsyncStorage.setItem(TOTAL_SECONDS_KEY, String(current + seconds));
}

export type DigestTrialState = 'active' | 'soft' | 'hard';

export async function getDigestTrialState(): Promise<DigestTrialState> {
  try {
    const isSubscribed = await getIsSubscribed();
    if (isSubscribed) return 'active';
    const raw = await AsyncStorage.getItem(FIRST_DIGEST_DATE_KEY);
    if (!raw) return 'active';
    const daysSince = (Date.now() - parseInt(raw, 10)) / (1000 * 60 * 60 * 24);
    if (daysSince >= DIGEST_HARD_PAYWALL_DAYS) return 'hard';
    if (daysSince >= DIGEST_SOFT_PAYWALL_DAYS) return 'soft';
    return 'active';
  } catch {
    return 'active';
  }
}

export async function recordFirstDigestUse(): Promise<void> {
  try {
    const existing = await AsyncStorage.getItem(FIRST_DIGEST_DATE_KEY);
    if (existing) return;
    const isoDate = new Date().toISOString().slice(0, 10);
    await AsyncStorage.setItem(FIRST_DIGEST_DATE_KEY, String(Date.now()));
    const { saveUserPreferences } = await import('./api');
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await saveUserPreferences({ timezone: tz, firstDigestDate: isoDate }).catch(() => {});
  } catch { /* non-fatal */ }
}

export async function syncSubscriptionToServer(): Promise<void> {
  try {
    const isSubscribed = await getIsSubscribed();
    const { saveUserPreferences } = await import('./api');
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await saveUserPreferences({ timezone: tz, subscribed: isSubscribed }).catch(() => {});
  } catch { /* non-fatal */ }
}

export async function hasReachedFreeLimit(): Promise<boolean> {
  const isSubscribed = await getIsSubscribed();
  if (isSubscribed) return false;
  const used = await getTotalGeneratedSeconds();
  return used >= FREE_LIMIT_SECONDS;
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
    await AsyncStorage.removeItem(TOTAL_SECONDS_KEY);
    await AsyncStorage.removeItem(FIRST_DIGEST_DATE_KEY);
  } catch {
    /* ignore */
  }
}
