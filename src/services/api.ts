import * as FileSystem from 'expo-file-system/legacy';
import { EncodingType } from 'expo-file-system/legacy';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { loadSession, saveSession } from './auth';
import { GenerationInput, JobStatus } from '../types';

function normalizeApiBase(raw: string | undefined): string {
  return (raw ?? '')
    .trim()
    // handle accidental quotes in .env values
    .replace(/^['"]|['"]$/g, '')
    .replace(/\/$/, '');
}

const API_BASE = normalizeApiBase(process.env.EXPO_PUBLIC_API_BASE);

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getFreshToken(session: Awaited<ReturnType<typeof loadSession>>): Promise<string> {
  // DIAGNOSTIC MODE: use the stored token directly (saved during signIn()).
  // We previously tried getTokens()/signInSilently() to refresh, but those may
  // return tokens with the wrong audience on some SDK versions. The token from
  // the original signIn() is known-good for the configured webClientId.
  const stored = session?.oidcIdToken;

  if (session?.provider === 'google') {
    // Best-effort: try to get a fresher token, but only USE it if it looks valid
    try {
      const tokens = await GoogleSignin.getTokens();
      if (tokens.idToken) {
        console.log('[api] getTokens returned idToken', {
          len: tokens.idToken.length,
          sameAsStored: tokens.idToken === stored,
        });
        // Compare the audiences via base64 decode of the JWT payload
        const decode = (jwt: string) => {
          try {
            const part = jwt.split('.')[1];
            const padded = part + '='.repeat((4 - (part.length % 4)) % 4);
            return JSON.parse(atob(padded.replace(/-/g, '+').replace(/_/g, '/')));
          } catch { return null; }
        };
        const newPayload = decode(tokens.idToken);
        const oldPayload = stored ? decode(stored) : null;
        console.log('[api] token audiences', {
          newAud: newPayload?.aud,
          newExp: newPayload?.exp,
          oldAud: oldPayload?.aud,
          oldExp: oldPayload?.exp,
          now: Math.floor(Date.now() / 1000),
        });
      }
    } catch (e: any) {
      console.log('[api] getTokens failed', { msg: e?.message });
    }
  }

  if (!stored) throw Object.assign(new Error('not_signed_in'), { code: 'not_signed_in' });
  return stored;
}

async function authHeaders(): Promise<Record<string, string>> {
  const session = await loadSession();
  if (!session) throw Object.assign(new Error('Not signed in.'), { code: 'not_signed_in' });
  const token = await getFreshToken(session);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export async function dispatchJob(
  input: GenerationInput,
  mode: 'podcast' | 'tts'
): Promise<string> {
  if (!API_BASE) throw Object.assign(new Error('missing_api_base'), { code: 'missing_api_base' });
  let body: Record<string, unknown>;
  if (input.type === 'url') {
    body = { url: input.url, mode };
  } else if (input.type === 'pdf') {
    const base64 = await FileSystem.readAsStringAsync(input.uri, { encoding: EncodingType.Base64 });
    body = { pdf_base64: base64, title: input.title ?? '', mode };
  } else {
    body = { text: input.text, title: input.title ?? '', mode };
  }
  const headers = await authHeaders();
  const bodyJson = JSON.stringify(body);
  console.log('[api] dispatch request', {
    type: input.type,
    mode,
    bodyBytes: bodyJson.length,
    hasAuth: Boolean(headers.Authorization),
    tokenLen: headers.Authorization?.length ?? 0,
  });
  let res: Response;
  try {
    res = await fetchWithTimeout(`${API_BASE}/jobs`, {
      method: 'POST',
      headers,
      body: bodyJson,
    }, 60_000);
  } catch (e: unknown) {
    console.error('[api] dispatch fetch failed', {
      url: `${API_BASE}/jobs`,
      name: (e as { name?: string }).name ?? null,
      message: (e as { message?: string }).message ?? null,
    });
    throw Object.assign(new Error('network_error'), { code: 'network_error' });
  }

  console.log('[api] dispatch response', { status: res.status, ok: res.ok });

  if (res.status === 401) {
    const errBody = await res.text().catch(() => '');
    console.warn('[api] dispatch 401', { errBody });
    throw Object.assign(new Error('auth_expired'), { code: 'auth_expired' });
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.warn('[api] dispatch failed', { status: res.status, err });
    throw new Error((err as { error?: string }).error ?? 'dispatch_failed');
  }

  const data = (await res.json()) as { jobId: string };
  return data.jobId;
}

export async function pollJob(jobId: string): Promise<JobStatus> {
  if (!API_BASE) throw Object.assign(new Error('missing_api_base'), { code: 'missing_api_base' });
  const headers = await authHeaders();
  let res: Response;
  try {
    res = await fetchWithTimeout(`${API_BASE}/jobs/${jobId}`, { headers }, 10_000);
  } catch (e: unknown) {
    console.error('[api] poll fetch failed', {
      url: `${API_BASE}/jobs/${jobId}`,
      name: (e as { name?: string }).name ?? null,
      message: (e as { message?: string }).message ?? null,
    });
    throw Object.assign(new Error('network_error'), { code: 'network_error' });
  }

  if (res.status === 401) {
    throw Object.assign(new Error('auth_expired'), { code: 'auth_expired' });
  }
  if (!res.ok) throw new Error('poll_failed');
  return res.json() as Promise<JobStatus>;
}

export async function downloadAudio(audioUrl: string, destUri: string): Promise<void> {
  const result = await FileSystem.downloadAsync(audioUrl, destUri);
  if (result.status !== 200) throw new Error('download_failed');
}
