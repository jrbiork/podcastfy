import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { readDigestStatus } from '../shared/s3';

const IN_PROGRESS = new Set([
  'queued',
  'fetching_feeds',
  'ranking',
  'summarizing',
  'scripting',
  'generating_audio',
]);

const dynamo = new DynamoDBClient({});
const sqsClient = new SQSClient({});

// Fixed digest size targeting ~5–7 min of audio
const DEFAULT_TOP_N = 6;

export const handler = async (event: { userId: string }): Promise<void> => {
  const { userId } = event;

  if (!userId) {
    console.error('[scheduler-trigger] missing userId in event', { event });
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  console.log('[scheduler-trigger] fired', { userId, date });

  // Idempotency — skip if already done or in progress
  const status = await readDigestStatus(userId, date);
  if (status && (status.status === 'done' || IN_PROGRESS.has(status.status))) {
    console.log('[scheduler-trigger] skipping, already', status.status, { userId, date });
    return;
  }

  // Read yesterday's digest to find any topic that was skipped due to budget constraints.
  // That topic gets guaranteed priority in today's Pass 1 selection.
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const prevStatus = await readDigestStatus(userId, yesterday);
  const priorityTopicId =
    prevStatus?.status === 'done' ? prevStatus.skippedTopicId : undefined;

  // Read user prefs from DynamoDB (topicFeedUrls is canonical input)
  let topicFeedUrls: Record<string, string[]> | undefined;
  let voice: string | undefined;

  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: process.env.USERS_TABLE!,
      Key: { userId: { S: userId } },
    }));

    const item = result.Item;
    if (item) {
      if (item.topicFeedUrls?.M) {
        const parsed = Object.fromEntries(
          Object.entries(item.topicFeedUrls.M).map(([topicId, urlsAttr]) => [
            topicId,
            (urlsAttr.L ?? [])
              .map((v) => v.S)
              .filter((u): u is string => typeof u === 'string' && u.length > 0),
          ]),
        );
        if (Object.keys(parsed).length > 0) topicFeedUrls = parsed;
      }

      if (item.voice?.S) voice = item.voice.S;

      const subscribed = item.subscribed?.BOOL ?? false;
      const digestListenedDates = item.digestListenedDates?.SS ?? [];

      // Hard paywall from day 4: once 3 unique digest days were completed.
      if (!subscribed) {
        const HARD_PAYWALL_LISTEN_DAYS = 3;
        if (digestListenedDates.length >= HARD_PAYWALL_LISTEN_DAYS) {
          console.log('[scheduler-trigger] skipping free user at hard paywall', {
            userId,
            listenedDays: digestListenedDates.length,
          });
          return;
        }
      }
    }
  } catch (err) {
    console.warn('[scheduler-trigger] failed to read user prefs, using defaults', { userId, err: String(err) });
  }

  const message: Record<string, unknown> = { userId, date, topN: DEFAULT_TOP_N };
  if (topicFeedUrls) message.topicFeedUrls = topicFeedUrls;
  if (voice) message.voice = voice;
  if (priorityTopicId) message.priorityTopicId = priorityTopicId;

  await sqsClient.send(new SendMessageCommand({
    QueueUrl: process.env.DIGEST_QUEUE_URL!,
    MessageBody: JSON.stringify(message),
  }));

  console.log('[scheduler-trigger] enqueued digest', {
    userId,
    date,
    topicCount: Object.keys(topicFeedUrls ?? {}).length,
    voice,
    topN: DEFAULT_TOP_N,
    priorityTopicId: priorityTopicId ?? null,
  });
};
