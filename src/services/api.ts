import * as FileSystem from 'expo-file-system/legacy';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { loadSession, saveSession } from './auth';
import { GenerationInput, JobStatus } from '../types';

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
        const silent = await GoogleSignin.signInSilently();
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
