import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const SESSION_KEY = 'auth_session_v1';

export type AuthSession = {
  provider: 'google' | 'apple' | 'local';
  userId: string;
  email?: string;
  displayName?: string;
  photoUrl?: string;
  oidcIdToken?: string;
};

export async function createGuestSession(): Promise<AuthSession> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return { provider: 'local', userId: `guest_${hex}` };
}

export async function loadSession(): Promise<AuthSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export async function saveSession(session: AuthSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  } catch {
    /* already cleared */
  }
}
