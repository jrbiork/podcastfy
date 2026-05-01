import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';
import { verifyToken, AuthError } from '../shared/auth';
import {
  writeStatus,
  readStatus,
  getPresignedPdfPutUrl,
  headPdfInput,
  pdfInputKey,
  MAX_PDF_BYTES,
} from '../shared/s3';

const sqs = new SQSClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const QUEUE_URL = process.env.SQS_QUEUE_URL ?? '';

const VALID_VOICES = ['alloy', 'echo', 'fable', 'nova', 'onyx', 'shimmer'];
const VALID_LANGS = ['en-US', 'en-GB', 'es', 'fr', 'de', 'pt-BR'];

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function parseVoiceLanguage(body: Record<string, unknown>) {
  const voice =
    typeof body.voice === 'string' && VALID_VOICES.includes(body.voice) ? body.voice : null;
  const language =
    typeof body.language === 'string' && VALID_LANGS.includes(body.language)
      ? body.language
      : null;
  return { voice, language };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestId = event.requestContext.requestId ?? 'unknown';
  const rawPath = event.rawPath ?? '';
  console.log('[dispatcher] request received', {
    requestId,
    rawPath,
    hasAuthHeader: Boolean(event.headers?.authorization),
    hasBody: Boolean(event.body),
  });

  try {
    await verifyToken(event.headers?.authorization);
  } catch (e) {
    const err = e as AuthError;
    console.warn('[dispatcher] auth failed', {
      requestId,
      statusCode: err.statusCode,
      message: err.message,
    });
    return json(err.statusCode ?? 401, { error: err.message });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    console.warn('[dispatcher] invalid json body', { requestId, rawBody: event.body ?? null });
    return json(400, { error: 'Invalid JSON body' });
  }

  if (rawPath.endsWith('/jobs/pdf/presign')) {
    return handlePdfPresign(requestId, body);
  }
  if (rawPath.endsWith('/jobs/pdf/finalize')) {
    return handlePdfFinalize(requestId, body);
  }

  return handleDispatchJob(requestId, body);
};

async function handlePdfPresign(requestId: string, _body: Record<string, unknown>) {
  const jobId = uuidv4();
  await writeStatus(jobId, { status: 'awaiting_pdf_upload' });
  console.log('[dispatcher] pdf presign status written', { requestId, jobId });

  const { uploadUrl, pdfKey } = await getPresignedPdfPutUrl(jobId);
  console.log('[dispatcher] pdf presign url issued', { requestId, jobId, pdfKey });

  return json(200, { jobId, uploadUrl, pdfKey });
}

async function handlePdfFinalize(requestId: string, body: Record<string, unknown>) {
  const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
  if (!jobId) {
    console.warn('[dispatcher] finalize missing jobId', { requestId });
    return json(400, { error: 'Missing jobId' });
  }

  const mode = body.mode === 'tts' ? 'tts' : 'podcast';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const { voice, language } = parseVoiceLanguage(body);

  const current = await readStatus(jobId);
  if (!current) {
    console.warn('[dispatcher] finalize job not found', { requestId, jobId });
    return json(404, { error: 'Job not found' });
  }

  if (current.status === 'queued') {
    console.log('[dispatcher] finalize idempotent queued', { requestId, jobId });
    return json(200, { jobId, status: 'queued' });
  }

  if (current.status !== 'awaiting_pdf_upload') {
    console.warn('[dispatcher] finalize invalid status', {
      requestId,
      jobId,
      status: current.status,
    });
    return json(400, { error: 'PDF upload not pending for this job' });
  }

  let meta: { contentLength: number; contentType?: string };
  try {
    meta = await headPdfInput(jobId);
  } catch {
    console.warn('[dispatcher] finalize pdf missing in s3', { requestId, jobId });
    return json(400, { error: 'PDF not uploaded yet or upload incomplete' });
  }

  if (meta.contentLength <= 0) {
    console.warn('[dispatcher] finalize empty pdf', { requestId, jobId });
    return json(400, { error: 'PDF upload is empty' });
  }

  if (meta.contentLength > MAX_PDF_BYTES) {
    console.warn('[dispatcher] finalize pdf too large', {
      requestId,
      jobId,
      bytes: meta.contentLength,
      max: MAX_PDF_BYTES,
    });
    return json(400, {
      error: `PDF too large (max ${Math.floor(MAX_PDF_BYTES / (1024 * 1024))} MB)`,
    });
  }

  const ct = (meta.contentType ?? '').toLowerCase();
  if (ct && !ct.includes('pdf') && !ct.includes('octet-stream')) {
    console.warn('[dispatcher] finalize wrong content-type', { requestId, jobId, ct });
    return json(400, { error: 'Uploaded file must be a PDF (application/pdf)' });
  }

  await writeStatus(jobId, { status: 'queued' });
  console.log('[dispatcher] status queued after pdf finalize', { requestId, jobId });

  const pdfKey = pdfInputKey(jobId);
  const message: Record<string, unknown> = {
    jobId,
    mode,
    pdfKey,
    title,
    ...(voice ? { voice } : {}),
    ...(language ? { language } : {}),
  };

  await sqs.send(
    new SendMessageCommand({ QueueUrl: QUEUE_URL, MessageBody: JSON.stringify(message) })
  );
  console.log('[dispatcher] job enqueued after pdf finalize', { requestId, jobId, mode });

  return json(200, { jobId, status: 'queued' });
}

async function handleDispatchJob(requestId: string, body: Record<string, unknown>) {
  const mode = body.mode === 'tts' ? 'tts' : 'podcast';
  const url = typeof body.url === 'string' ? body.url.trim() : null;
  const text = typeof body.text === 'string' ? body.text.trim() : null;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const { voice, language } = parseVoiceLanguage(body);

  if (!url && !text) {
    console.warn('[dispatcher] missing input', { requestId, mode });
    return json(400, { error: 'Provide url or text (PDF uses /jobs/pdf/presign then direct upload)' });
  }
  if (url) {
    try {
      new URL(url);
    } catch {
      console.warn('[dispatcher] invalid url', { requestId, url });
      return json(400, { error: 'Invalid URL' });
    }
  }
  if (text && text.length > 14000) {
    console.warn('[dispatcher] text too long', { requestId, length: text.length });
    return json(400, { error: 'Text too long (max 14000 chars)' });
  }

  const jobId = uuidv4();
  await writeStatus(jobId, { status: 'queued' });
  console.log('[dispatcher] status queued written', { requestId, jobId });

  let message: Record<string, unknown>;
  if (url) {
    message = { jobId, mode, url, ...(voice ? { voice } : {}), ...(language ? { language } : {}) };
  } else {
    message = {
      jobId,
      mode,
      text,
      title,
      ...(voice ? { voice } : {}),
      ...(language ? { language } : {}),
    };
  }

  await sqs.send(
    new SendMessageCommand({ QueueUrl: QUEUE_URL, MessageBody: JSON.stringify(message) })
  );
  console.log('[dispatcher] job enqueued', { requestId, jobId, mode, via: url ? 'url' : 'text' });

  return json(200, { jobId, status: 'queued' });
}
