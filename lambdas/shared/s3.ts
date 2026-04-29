import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type JobStatus =
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

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
const BUCKET = process.env.S3_BUCKET ?? 'podcastify-jobs';

function statusKey(jobId: string) {
  return `jobs/${jobId}/status.json`;
}

function audioKey(jobId: string) {
  return `jobs/${jobId}/audio.mp3`;
}

export async function writeStatus(
  jobId: string,
  status: Omit<JobStatus, 'audioUrl'>
): Promise<void> {
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
