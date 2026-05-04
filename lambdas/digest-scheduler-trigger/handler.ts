import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { TOPIC_FEED_URLS_BY_ID } from '../data/topicFeedMap';
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

const FEEDS_PER_TOPIC = 5;

// Fixed digest size targeting ~5–8 min of audio
const DEFAULT_TOP_N = 9;

/** Mirrors app `getTopicFeedUrls`: up to 5 RSS URLs per stored topic id (incl. legacy keys). */
function buildTopicFeedUrls(selectedTopics: string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const topicId of selectedTopics) {
    const urls = TOPIC_FEED_URLS_BY_ID[topicId];
    if (urls?.length) result[topicId] = [...urls].slice(0, FEEDS_PER_TOPIC);
  }
  return result;
}

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

  // Read user prefs from DynamoDB (same precedence as client: feedUrls → topic buckets)
  let feedUrls: string[] | undefined;
  let topicFeedUrls: Record<string, string[]> | undefined;
  let voice: string | undefined;

  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: process.env.USERS_TABLE!,
      Key: { userId: { S: userId } },
    }));

    const item = result.Item;
    if (item) {
      const fromSubs = item.feedUrls?.SS ?? [];
      if (fromSubs.length > 0) {
        feedUrls = fromSubs.slice(0, 50);
      } else {
        const selectedTopics = item.selectedTopics?.SS ?? [];
        if (selectedTopics.length > 0) {
          const built = buildTopicFeedUrls(selectedTopics);
          if (Object.keys(built).length > 0) topicFeedUrls = built;
        }
      }

      if (item.voice?.S) voice = item.voice.S;
    }
  } catch (err) {
    console.warn('[scheduler-trigger] failed to read user prefs, using defaults', { userId, err: String(err) });
  }

  const message: Record<string, unknown> = { userId, date, topN: DEFAULT_TOP_N };
  if (feedUrls && feedUrls.length > 0) message.feedUrls = feedUrls;
  else if (topicFeedUrls) message.topicFeedUrls = topicFeedUrls;
  if (voice) message.voice = voice;
  if (priorityTopicId) message.priorityTopicId = priorityTopicId;

  await sqsClient.send(new SendMessageCommand({
    QueueUrl: process.env.DIGEST_QUEUE_URL!,
    MessageBody: JSON.stringify(message),
  }));

  console.log('[scheduler-trigger] enqueued digest', {
    userId,
    date,
    flatFeedCount: feedUrls?.length ?? 0,
    topicCount: Object.keys(topicFeedUrls ?? {}).length,
    voice,
    topN: DEFAULT_TOP_N,
    priorityTopicId: priorityTopicId ?? null,
  });
};
