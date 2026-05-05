import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { verifyToken, AuthError } from '../shared/auth';
import {
  readDigestStatus,
  writeDigestStatus,
  getPresignedDigestAudioUrl,
  deleteDigestFiles,
} from '../shared/s3';

const sqs = new SQSClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const DIGEST_QUEUE_URL = process.env.DIGEST_QUEUE_URL ?? '';
const USERS_TABLE = process.env.USERS_TABLE ?? '';

const IN_PROGRESS_STATUSES = new Set([
  'queued',
  'fetching_feeds',
  'ranking',
  'summarizing',
  'scripting',
  'generating_audio',
]);

function readStringArrayAttr(attr?: { SS?: string[]; L?: Array<{ S?: string }> }): string[] {
  if (!attr) return [];
  if (Array.isArray(attr.SS) && attr.SS.length > 0) return attr.SS;
  if (Array.isArray(attr.L) && attr.L.length > 0) {
    return attr.L.map((v) => v.S).filter((v): v is string => typeof v === 'string' && v.length > 0);
  }
  return [];
}

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestId = event.requestContext.requestId ?? 'unknown';
  const rawPath = event.rawPath ?? '';
  const method = event.requestContext.http.method;

  console.log('[digest-dispatcher] request received', {
    requestId,
    rawPath,
    method,
    hasAuthHeader: Boolean(event.headers?.authorization),
  });

  let userId: string;
  try {
    const result = await verifyToken(event.headers?.authorization);
    userId = result.sub;
  } catch (e) {
    const err = e as AuthError;
    console.warn('[digest-dispatcher] auth failed', {
      requestId,
      statusCode: err.statusCode,
      message: err.message,
    });
    return json(err.statusCode ?? 401, { error: err.message });
  }

  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC

  if (method === 'GET') {
    return handleGetLatest(requestId, userId, date);
  }

  if (method === 'DELETE') {
    return handleDeleteToday(requestId, userId, date);
  }

  // POST /digests
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  return handleDispatchDigest(requestId, userId, date, body);
};

async function handleGetLatest(requestId: string, userId: string, date: string) {
  const status = await readDigestStatus(userId, date);

  if (!status) {
    console.log('[digest-dispatcher] no digest today', { requestId, userId, date });
    return json(200, { status: 'not_started' });
  }

  if (status.status === 'done') {
    const audioUrl = await getPresignedDigestAudioUrl(userId, date);
    console.log('[digest-dispatcher] digest done, returning url', { requestId, userId, date });
    return json(200, { ...status, audioUrl });
  }

  console.log('[digest-dispatcher] digest in progress', { requestId, userId, date, status: status.status });
  return json(200, status);
}

async function handleDeleteToday(requestId: string, userId: string, date: string) {
  console.log('[digest-dispatcher] deleting digest', { requestId, userId, date });
  await deleteDigestFiles(userId, date);
  return json(200, { ok: true });
}

async function handleDispatchDigest(
  requestId: string,
  userId: string,
  date: string,
  body: Record<string, unknown>
) {
  const digestId = `${userId}/${date}`;

  // Validate optional feedUrls (up to 50 — 12 topics × 3–5 feeds each)
  let feedUrls: string[] | undefined;
  if (body.feedUrls !== undefined) {
    if (
      !Array.isArray(body.feedUrls) ||
      body.feedUrls.length > 50 ||
      !body.feedUrls.every((u) => typeof u === 'string')
    ) {
      return json(400, { error: 'feedUrls must be an array of up to 50 strings' });
    }
    for (const url of body.feedUrls as string[]) {
      try {
        new URL(url);
      } catch {
        return json(400, { error: `Invalid feed URL: ${url}` });
      }
    }
    feedUrls = body.feedUrls as string[];
  }

  const force = body.force === true;

  const VALID_VOICES = new Set(['alloy', 'echo', 'fable', 'nova', 'onyx', 'shimmer']);
  const voice = typeof body.voice === 'string' && VALID_VOICES.has(body.voice)
    ? body.voice
    : undefined;

  const topN = typeof body.topN === 'number' && body.topN > 0 && body.topN <= 20
    ? Math.round(body.topN)
    : undefined;

  let topicFeedUrls: Record<string, string[]> | undefined;
  if (body.topicFeedUrls !== undefined) {
    if (typeof body.topicFeedUrls !== 'object' || Array.isArray(body.topicFeedUrls)) {
      return json(400, { error: 'topicFeedUrls must be an object' });
    }
    const entries = Object.entries(body.topicFeedUrls as Record<string, unknown>);
    if (entries.length > 15) {
      return json(400, { error: 'topicFeedUrls exceeds 15 topics maximum' });
    }
    for (const [, urls] of entries) {
      if (!Array.isArray(urls) || urls.length > 10) {
        return json(400, { error: 'Each topic in topicFeedUrls must have an array of up to 10 URLs' });
      }
    }
    topicFeedUrls = body.topicFeedUrls as Record<string, string[]>;
  }

  // If caller didn't provide feeds/topic buckets (e.g. test regenerate button),
  // hydrate from saved user prefs so generation uses current preferences.
  if (!feedUrls && !topicFeedUrls && USERS_TABLE) {
    try {
      const user = await dynamo.send(new GetItemCommand({
        TableName: USERS_TABLE,
        Key: { userId: { S: userId } },
        ProjectionExpression: 'feedUrls',
      }));
      const item = user.Item;
      const fromSet = readStringArrayAttr(item?.feedUrls as any);
      if (fromSet.length > 0) {
        feedUrls = fromSet.slice(0, 50);
      }
    } catch (err) {
      console.warn('[digest-dispatcher] failed to hydrate feedUrls from prefs', {
        requestId,
        userId,
        err: String(err),
      });
    }
  }

  // Check existing status (idempotency)
  const existing = await readDigestStatus(userId, date);

  if (existing) {
    if (IN_PROGRESS_STATUSES.has(existing.status)) {
      console.log('[digest-dispatcher] digest already in progress', {
        requestId,
        userId,
        date,
        status: existing.status,
      });
      return json(200, { digestId, status: existing.status });
    }

    if (existing.status === 'done') {
      if (!force) {
        const audioUrl = await getPresignedDigestAudioUrl(userId, date);
        console.log('[digest-dispatcher] digest already done', { requestId, userId, date });
        return json(200, { ...existing, digestId, audioUrl });
      }
      // Explicit test/manual force should replace today's digest artifacts and regenerate.
      await deleteDigestFiles(userId, date);
      console.log('[digest-dispatcher] force re-enqueue and replace today digest', { requestId, userId, date });
    }
    // status === 'error', or done+force=true → fall through and re-enqueue
  }

  await writeDigestStatus(userId, date, { status: 'queued' });
  console.log('[digest-dispatcher] digest status queued', { requestId, userId, date });

  const message: Record<string, unknown> = { userId, date };
  // Prefer explicit subscription URLs from user prefs over topic buckets
  if (feedUrls && feedUrls.length > 0) message.feedUrls = feedUrls;
  else if (topicFeedUrls && Object.keys(topicFeedUrls).length > 0) message.topicFeedUrls = topicFeedUrls;
  if (voice)          message.voice          = voice;
  if (topN)           message.topN           = topN;

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: DIGEST_QUEUE_URL,
      MessageBody: JSON.stringify(message),
    })
  );
  console.log('[digest-dispatcher] digest enqueued', { requestId, userId, date });

  return json(200, { digestId, status: 'queued' });
}
