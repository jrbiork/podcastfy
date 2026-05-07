import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const DEVICE_ID_KEY = 'podcastify.deviceId.v1';

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing && existing.length >= 8) return existing;

  const next = Crypto.randomUUID();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, next);
  return next;
}

