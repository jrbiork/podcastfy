import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';
import { verifyToken, AuthError } from '../shared/auth';
import { writeStatus, uploadBuffer } from '../shared/s3';

const sqs = new SQSClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const QUEUE_URL = process.env.SQS_QUEUE_URL ?? '';

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestId = event.requestContext.requestId ?? 'unknown';
  console.log('[dispatcher] request received', {
    requestId,
    hasAuthHeader: Boolean(event.headers?.authorization),
    hasBody: Boolean(event.body),
  });

  try {
    await verifyToken(event.headers?.authorization);
  } catch (e) {
    const err = e as AuthError;
    console.warn('[dispatcher] auth failed', { requestId, statusCode: err.statusCode, message: err.message });
    return json(err.statusCode ?? 401, { error: err.message });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    console.warn('[dispatcher] invalid json body', { requestId, rawBody: event.body ?? null });
    return json(400, { error: 'Invalid JSON body' });
  }

  const mode = body.mode === 'tts' ? 'tts' : 'podcast';
  const url = typeof body.url === 'string' ? body.url.trim() : null;
  const text = typeof body.text === 'string' ? body.text.trim() : null;
  const pdfBase64 = typeof body.pdf_base64 === 'string' ? body.pdf_base64 : null;
  const title = typeof body.title === 'string' ? body.title.trim() : '';

  if (!url && !text && !pdfBase64) {
    console.warn('[dispatcher] missing input', { requestId, mode });
    return json(400, { error: 'Provide url, text, or pdf_base64' });
  }
  if (url) {
    try { new URL(url); } catch {
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
  if (pdfBase64) {
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    const pdfKey = `jobs/${jobId}/input.pdf`;
    await uploadBuffer(pdfKey, pdfBuffer, 'application/pdf');
    console.log('[dispatcher] pdf uploaded to s3', { requestId, jobId, bytes: pdfBuffer.length });
    message = { jobId, mode, pdfKey, title };
  } else if (url) {
    message = { jobId, mode, url };
  } else {
    message = { jobId, mode, text, title };
  }

  await sqs.send(
    new SendMessageCommand({ QueueUrl: QUEUE_URL, MessageBody: JSON.stringify(message) })
  );
  console.log('[dispatcher] job enqueued', { requestId, jobId, mode, via: pdfBase64 ? 'pdf' : url ? 'url' : 'text' });

  return json(200, { jobId, status: 'queued' });
};
