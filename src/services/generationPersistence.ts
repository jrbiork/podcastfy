import AsyncStorage from '@react-native-async-storage/async-storage';

const PENDING_JOBS_KEY = 'podcastify_pending_generation_jobs';

export type PersistedGenerationJob = {
  genId: string;
  jobId: string;
  mode: 'podcast' | 'tts';
  startedAt: number;
};

function isPersistedJob(value: unknown): value is PersistedGenerationJob {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.genId === 'string' &&
    typeof o.jobId === 'string' &&
    (o.mode === 'podcast' || o.mode === 'tts') &&
    typeof o.startedAt === 'number'
  );
}

export async function loadPersistedGenerationJobs(): Promise<PersistedGenerationJob[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_JOBS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPersistedJob);
  } catch {
    return [];
  }
}

async function savePersistedGenerationJobs(jobs: PersistedGenerationJob[]): Promise<void> {
  if (jobs.length === 0) {
    await AsyncStorage.removeItem(PENDING_JOBS_KEY);
    return;
  }
  await AsyncStorage.setItem(PENDING_JOBS_KEY, JSON.stringify(jobs));
}

export async function appendPersistedGenerationJob(job: PersistedGenerationJob): Promise<void> {
  const jobs = await loadPersistedGenerationJobs();
  const merged = [...jobs.filter((j) => j.genId !== job.genId), job];
  await savePersistedGenerationJobs(merged);
}

export async function removePersistedGenerationJob(genId: string): Promise<void> {
  const jobs = await loadPersistedGenerationJobs();
  await savePersistedGenerationJobs(jobs.filter((j) => j.genId !== genId));
}

export async function clearPersistedGenerationJobs(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_JOBS_KEY);
}
