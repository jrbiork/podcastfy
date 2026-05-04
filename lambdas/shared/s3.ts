import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Max PDF object size after direct S3 upload (matches finalize validation). */
export const MAX_PDF_BYTES = 40 * 1024 * 1024;

export type JobStatus =
  | { status: 'awaiting_pdf_upload' }
  | { status: 'queued' }
  | { status: 'processing' }
  | { status: 'scripting' }
  | { status: 'generating_audio' }
  | {
      status: 'done';
      title: string;
      thumbnailUrl: string | null;
      durationSeconds: number;
      mode: 'podcast' | 'tts';
      audioUrl: string;
    }
  | { status: 'error'; error: string };

/** Status JSON in S3 (`done` omits `audioUrl`; status Lambda adds presigned URL). */
export type PersistedJobStatus =
  | Exclude<JobStatus, { status: 'done' }>
  | Omit<Extract<JobStatus, { status: 'done' }>, 'audioUrl'>;

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
const BUCKET = process.env.S3_BUCKET ?? 'podcastify-jobs';

function statusKey(jobId: string) {
  return `jobs/${jobId}/status.json`;
}

function audioKey(jobId: string) {
  return `jobs/${jobId}/audio.mp3`;
}

export function pdfInputKey(jobId: string): string {
  return `jobs/${jobId}/input.pdf`;
}

const PDF_PUT_EXPIRES_SEC = 900;

export async function getPresignedPdfPutUrl(jobId: string): Promise<{ uploadUrl: string; pdfKey: string }> {
  const pdfKey = pdfInputKey(jobId);
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: pdfKey,
    ContentType: 'application/pdf',
  });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: PDF_PUT_EXPIRES_SEC });
  return { uploadUrl, pdfKey };
}

export async function headPdfInput(jobId: string): Promise<{ contentLength: number; contentType?: string }> {
  const res = await s3.send(
    new HeadObjectCommand({ Bucket: BUCKET, Key: pdfInputKey(jobId) })
  );
  return {
    contentLength: res.ContentLength ?? 0,
    contentType: res.ContentType,
  };
}

export async function writeStatus(jobId: string, status: PersistedJobStatus): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: statusKey(jobId),
      Body: JSON.stringify(status),
      ContentType: 'application/json',
    })
  );
}

export async function readStatus(jobId: string): Promise<JobStatus | null> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: statusKey(jobId) })
    );
    const body = await res.Body?.transformToString();
    if (!body) return null;
    return JSON.parse(body) as JobStatus;
  } catch {
    return null;
  }
}

export async function audioExists(jobId: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: audioKey(jobId) }));
    return true;
  } catch {
    return false;
  }
}

export async function uploadAudio(jobId: string, buffer: Buffer): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: audioKey(jobId),
      Body: buffer,
      ContentType: 'audio/mpeg',
    })
  );
}

export async function uploadBuffer(key: string, buffer: Buffer, contentType: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType })
  );
}

export async function downloadBuffer(key: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const bytes = await res.Body?.transformToByteArray();
  if (!bytes) throw new Error('Empty S3 object');
  return Buffer.from(bytes);
}

export async function getPresignedAudioUrl(jobId: string): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: audioKey(jobId) }),
    { expiresIn: 3600 }
  );
}

// ── Digest storage ────────────────────────────────────────────────────────────

export interface DigestStory {
  title: string;
  feedName: string;
  feedId: string;
  link: string;
  estimatedDurationSeconds: number;
  summary?: string;
  topicLabel?: string;
}

export type DigestStatus =
  | { status: 'queued' }
  | { status: 'fetching_feeds' }
  | { status: 'enriching_popularity' }
  | { status: 'ranking' }
  | { status: 'summarizing' }
  | { status: 'scripting' }
  | { status: 'generating_audio' }
  | { status: 'done'; title: string; durationSeconds: number; digestId: string; stories: DigestStory[]; skippedTopicId?: string }
  | { status: 'error'; error: string };

function digestStatusKey(userId: string, date: string) {
  return `digests/${userId}/${date}/status.json`;
}

function digestAudioKey(userId: string, date: string) {
  return `digests/${userId}/${date}/audio.mp3`;
}

export async function writeDigestStatus(userId: string, date: string, status: DigestStatus): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: digestStatusKey(userId, date),
      Body: JSON.stringify(status),
      ContentType: 'application/json',
    })
  );
}

export async function readDigestStatus(userId: string, date: string): Promise<DigestStatus | null> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: digestStatusKey(userId, date) })
    );
    const body = await res.Body?.transformToString();
    if (!body) return null;
    return JSON.parse(body) as DigestStatus;
  } catch {
    return null;
  }
}

export async function uploadDigestAudio(userId: string, date: string, buffer: Buffer): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: digestAudioKey(userId, date),
      Body: buffer,
      ContentType: 'audio/mpeg',
    })
  );
}

export async function getPresignedDigestAudioUrl(userId: string, date: string): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: digestAudioKey(userId, date) }),
    { expiresIn: 3600 }
  );
}

/**
 * Deletes today's digest status and audio from S3 so a fresh generation can be
 * triggered. Used by the "Clear All Data" dev tool in the client.
 */
export async function deleteDigestFiles(userId: string, date: string): Promise<void> {
  await Promise.allSettled([
    s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: digestStatusKey(userId, date) })),
    s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: digestAudioKey(userId, date) })),
  ]);
}
