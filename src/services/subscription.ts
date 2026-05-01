import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';

export const ENTITLEMENT_ID = 'premium';
export const FREE_LIMIT_SECONDS = 60; // 1 minute

const TOTAL_SECONDS_KEY = 'podcastify_total_seconds';

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
  } catch {
    /* ignore */
  }
}
