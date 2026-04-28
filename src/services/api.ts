import * as FileSystem from 'expo-file-system/legacy';
import { loadSession } from './auth';
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

async function authHeaders(): Promise<Record<string, string>> {
  const session = await loadSession();
  const token = session?.oidcIdToken;
  if (!token) throw Object.assign(new Error('Not signed in. Please sign in to create episodes.'), { code: 'not_signed_in' });
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export async function dispatchJob(
  input: GenerationInput,
  mode: 'podcast' | 'tts'
): Promise<string> {
  if (!API_BASE) throw Object.assign(new Error('missing_api_base'), { code: 'missing_api_base' });
  const headers = await authHeaders();
  const body =
    input.type === 'url'
      ? { url: input.url, mode }
      : { text: input.text, title: input.title ?? '', mode };
  let res: Response;
  try {
    res = await fetchWithTimeout(`${API_BASE}/jobs`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }, 15_000);
  } catch (e: unknown) {
    console.error('[api] dispatch fetch failed', {
      url: `${API_BASE}/jobs`,
      name: (e as { name?: string }).name ?? null,
      message: (e as { message?: string }).message ?? null,
    });
    throw Object.assign(new Error('network_error'), { code: 'network_error' });
  }

  if (res.status === 401) throw Object.assign(new Error('auth_expired'), { code: 'auth_expired' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
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
    res = await fetchWithTimeout(`${API_BASE}/jobs/${jobId}`, {
      headers,
    }, 10_000);
  } catch (e: unknown) {
    console.error('[api] poll fetch failed', {
      url: `${API_BASE}/jobs/${jobId}`,
      name: (e as { name?: string }).name ?? null,
      message: (e as { message?: string }).message ?? null,
    });
    throw Object.assign(new Error('network_error'), { code: 'network_error' });
  }

  if (!res.ok) throw new Error('poll_failed');
  return res.json() as Promise<JobStatus>;
}

export async function downloadAudio(audioUrl: string, destUri: string): Promise<void> {
  const result = await FileSystem.downloadAsync(audioUrl, destUri);
  if (result.status !== 200) throw new Error('download_failed');
}
