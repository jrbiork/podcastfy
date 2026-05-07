import * as FileSystem from 'expo-file-system/legacy';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { loadSession, saveSession } from './auth';
import { GenerationInput, JobStatus, DigestJobStatus } from '../types';

/** Match server [`MAX_PDF_BYTES`](lambdas/shared/s3.ts) for client-side picker hints. */
export const MAX_PDF_UPLOAD_BYTES = 40 * 1024 * 1024;

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
  let token = session?.oidcIdToken;

  // Google ID tokens expire quickly; fetch a fresh one for API calls and cache it.
  if (session?.provider === 'google') {
    try {
      const tokens = await GoogleSignin.getTokens();
      if (tokens.idToken) {
        token = tokens.idToken;
      }
    } catch (e: any) {
      console.log('[api] getTokens failed; using cached token', { msg: e?.message });
      try {
        const silent = await Promise.race([
          GoogleSignin.signInSilently(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('signInSilently timeout')), 8_000)
          ),
        ]);
        if ((silent as any)?.type === 'success') {
          const silentIdToken = (silent as any)?.data?.idToken;
          if (silentIdToken) token = silentIdToken;
        }
      } catch (silentErr: any) {
        console.log('[api] signInSilently failed; using cached token', {
          msg: silentErr?.message,
        });
      }
    }
  }

  if (!token) throw Object.assign(new Error('not_signed_in'), { code: 'not_signed_in' });

  if (token !== session?.oidcIdToken && session) {
    await saveSession({ ...session, oidcIdToken: token });
  }

  return token;
}

async function authHeaders(): Promise<Record<string, string>> {
  const session = await loadSession();
  if (!session) throw Object.assign(new Error('Not signed in.'), { code: 'not_signed_in' });
  const token = await getFreshToken(session);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function dispatchPdfJob(
  input: Extract<GenerationInput, { type: 'pdf' }>,
  mode: 'podcast' | 'tts'
): Promise<string> {
  const headers = await authHeaders();

  let presignRes: Response;
  try {
    presignRes = await fetchWithTimeout(
      `${API_BASE}/jobs/pdf/presign`,
      { method: 'POST', headers, body: '{}' },
      60_000
    );
  } catch (e: unknown) {
    console.error('[api] pdf presign fetch failed', {
      url: `${API_BASE}/jobs/pdf/presign`,
      message: (e as { message?: string }).message ?? null,
    });
    throw Object.assign(new Error('network_error'), { code: 'network_error' });
  }

  if (presignRes.status === 401) {
    throw Object.assign(new Error('auth_expired'), { code: 'auth_expired' });
  }
  if (!presignRes.ok) {
    const err = await presignRes.json().catch(() => ({}));
    console.warn('[api] pdf presign failed', { status: presignRes.status, err });
    throw new Error((err as { error?: string }).error ?? 'dispatch_failed');
  }

  const presignData = (await presignRes.json()) as { jobId: string; uploadUrl: string };
  const { jobId, uploadUrl } = presignData;
  console.log('[api] pdf presign ok', { jobId });

  const uploadResult = await FileSystem.uploadAsync(uploadUrl, input.uri, {
    httpMethod: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
  });

  console.log('[api] pdf upload to s3', { jobId, status: uploadResult.status });

  if (uploadResult.status < 200 || uploadResult.status >= 300) {
    throw Object.assign(new Error('pdf_upload_failed'), { code: 'pdf_upload_failed' });
  }

  const finalizeBody: Record<string, unknown> = {
    jobId,
    mode,
    title: input.title ?? '',
  };
  if (input.voice) finalizeBody.voice = input.voice;
  if (input.language) finalizeBody.language = input.language;

  let finalizeRes: Response;
  try {
    finalizeRes = await fetchWithTimeout(
      `${API_BASE}/jobs/pdf/finalize`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(finalizeBody),
      },
      60_000
    );
  } catch (e: unknown) {
    console.error('[api] pdf finalize fetch failed', {
      message: (e as { message?: string }).message ?? null,
    });
    throw Object.assign(new Error('network_error'), { code: 'network_error' });
  }

  if (finalizeRes.status === 401) {
    throw Object.assign(new Error('auth_expired'), { code: 'auth_expired' });
  }
  if (!finalizeRes.ok) {
    const err = await finalizeRes.json().catch(() => ({}));
    console.warn('[api] pdf finalize failed', { status: finalizeRes.status, err });
    throw new Error((err as { error?: string }).error ?? 'dispatch_failed');
  }

  return jobId;
}

export async function dispatchJob(
  input: GenerationInput,
  mode: 'podcast' | 'tts'
): Promise<string> {
  if (!API_BASE) throw Object.assign(new Error('missing_api_base'), { code: 'missing_api_base' });

  if (input.type === 'pdf') {
    return dispatchPdfJob(input, mode);
  }

  let body: Record<string, unknown>;
  if (input.type === 'url') {
    body = { url: input.url, mode };
  } else {
    body = { text: input.text, title: input.title ?? '', mode };
  }
  if (input.voice) body.voice = input.voice;
  if (input.language) body.language = input.language;
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

export async function dispatchDigest(
  topicFeedUrls?: Record<string, string[]>,
  force?: boolean,
  voice?: string,
  topN?: number,
): Promise<{ digestId: string; status: string }> {
  if (!API_BASE) throw Object.assign(new Error('missing_api_base'), { code: 'missing_api_base' });
  const headers = await authHeaders();
  const bodyObj: Record<string, unknown> = {};
  if (topicFeedUrls && Object.keys(topicFeedUrls).length > 0) bodyObj.topicFeedUrls = topicFeedUrls;
  if (force) bodyObj.force = true;
  if (voice) bodyObj.voice = voice;
  if (topN) bodyObj.topN = topN;
  const body = JSON.stringify(bodyObj);
  let res: Response;
  try {
    res = await fetchWithTimeout(`${API_BASE}/digests`, { method: 'POST', headers, body }, 30_000);
  } catch (e: unknown) {
    throw Object.assign(new Error('network_error'), { code: 'network_error' });
  }
  if (res.status === 401) throw Object.assign(new Error('auth_expired'), { code: 'auth_expired' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? 'dispatch_failed');
  }
  return res.json() as Promise<{ digestId: string; status: string }>;
}

/**
 * Deletes today's digest audio and status from S3.
 * Used by "Clear All Data" in the Profile screen so a fresh digest can be
 * generated immediately during testing without waiting until tomorrow.
 */
export async function deleteDigestToday(): Promise<void> {
  if (!API_BASE) return;
  const headers = await authHeaders();
  try {
    await fetchWithTimeout(`${API_BASE}/digests`, { method: 'DELETE', headers }, 15_000);
  } catch {
    // Best-effort — don't block the clear-data flow if this fails
  }
}

export async function getLatestDigest(): Promise<DigestJobStatus> {
  if (!API_BASE) throw Object.assign(new Error('missing_api_base'), { code: 'missing_api_base' });
  const headers = await authHeaders();
  let res: Response;
  try {
    res = await fetchWithTimeout(`${API_BASE}/digests/latest`, { headers }, 10_000);
  } catch (e: unknown) {
    throw Object.assign(new Error('network_error'), { code: 'network_error' });
  }
  if (res.status === 401) throw Object.assign(new Error('auth_expired'), { code: 'auth_expired' });
  if (!res.ok) throw new Error('poll_failed');
  return res.json() as Promise<DigestJobStatus>;
}

export interface UserPreferences {
  timezone: string | null;
  topicFeedUrls: Record<string, string[]> | null;
  deliveryHour: number | null;
  voice: string | null;
  durationMinutes: number | null;
  selectedTopics: string[] | null;
  firstDigestDate: string | null;
  digestListenedDates: string[] | null;
  subscribed: boolean | null;
}

export async function registerPushToken(token: string, deviceId: string): Promise<void> {
  if (!API_BASE) throw Object.assign(new Error('missing_api_base'), { code: 'missing_api_base' });
  const headers = await authHeaders();
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${API_BASE}/users/push-token`,
      { method: 'POST', headers, body: JSON.stringify({ token, deviceId, enabled: true }) },
      15_000,
    );
  } catch {
    throw Object.assign(new Error('network_error'), { code: 'network_error' });
  }
  if (res.status === 401) throw Object.assign(new Error('auth_expired'), { code: 'auth_expired' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? 'push_register_failed');
  }
}

export async function sendTestTodayPush(): Promise<void> {
  if (!API_BASE) throw Object.assign(new Error('missing_api_base'), { code: 'missing_api_base' });
  const headers = await authHeaders();
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${API_BASE}/users/push-test`,
      { method: 'POST', headers, body: '{}' },
      15_000,
    );
  } catch {
    throw Object.assign(new Error('network_error'), { code: 'network_error' });
  }
  if (res.status === 401) throw Object.assign(new Error('auth_expired'), { code: 'auth_expired' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? 'push_test_failed');
  }
}

export async function getUserPreferences(): Promise<UserPreferences> {
  if (!API_BASE) throw Object.assign(new Error('missing_api_base'), { code: 'missing_api_base' });
  const headers = await authHeaders();
  let res: Response;
  try {
    res = await fetchWithTimeout(`${API_BASE}/users/preferences`, { headers }, 10_000);
  } catch {
    throw Object.assign(new Error('network_error'), { code: 'network_error' });
  }
  if (res.status === 401) throw Object.assign(new Error('auth_expired'), { code: 'auth_expired' });
  if (!res.ok) throw new Error('prefs_fetch_failed');
  return res.json() as Promise<UserPreferences>;
}

export async function saveUserPreferences(prefs: {
  timezone: string;
  topicFeedUrls?: Record<string, string[]>;
  deliveryHour?: number;
  voice?: string;
  durationMinutes?: number;
  selectedTopics?: string[];
  firstDigestDate?: string | null;
  digestListenedDates?: string[] | null;
  subscribed?: boolean | null;
}): Promise<UserPreferences> {
  if (!API_BASE) throw Object.assign(new Error('missing_api_base'), { code: 'missing_api_base' });
  const headers = await authHeaders();
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${API_BASE}/users/preferences`,
      { method: 'POST', headers, body: JSON.stringify(prefs) },
      15_000,
    );
  } catch {
    throw Object.assign(new Error('network_error'), { code: 'network_error' });
  }
  if (res.status === 401) throw Object.assign(new Error('auth_expired'), { code: 'auth_expired' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? 'prefs_save_failed');
  }
  return res.json() as Promise<UserPreferences>;
}
