import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import {
  SchedulerClient,
  CreateScheduleCommand,
  UpdateScheduleCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-scheduler';
import {
  SNSClient,
  CreatePlatformEndpointCommand,
  SetEndpointAttributesCommand,
  PublishCommand,
} from '@aws-sdk/client-sns';
import { verifyToken, AuthError } from '../shared/auth';

const dynamo = new DynamoDBClient({});
const scheduler = new SchedulerClient({});
const sns = new SNSClient({});

const USERS_TABLE = process.env.USERS_TABLE!;
const TRIGGER_LAMBDA_ARN = process.env.TRIGGER_LAMBDA_ARN!;
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN!;
const SCHEDULE_GROUP =
  process.env.SCHEDULE_GROUP ?? 'podcastify-digest-schedules';
const SNS_PLATFORM_APPLICATION_ARN = process.env.SNS_PLATFORM_APPLICATION_ARN!;

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function pathEndsWith(rawPath: string | undefined, suffix: string): boolean {
  return (rawPath ?? '').endsWith(suffix);
}

/** Read optional fields from an existing DynamoDB user row (partial updates merge onto this). */
function readExistingPrefs(item?: Record<string, AttributeValue>) {
  if (!item) {
    return {
      feedUrls: null as string[] | null,
      selectedTopics: null as string[] | null,
      voice: null as string | null,
      durationMinutes: null as number | null,
      deliveryHour: 6 as number,
      firstDigestDate: null as string | null,
      digestListenedDates: null as string[] | null,
      subscribed: false,
    };
  }
  return {
    topicFeedUrls: item.topicFeedUrls?.M
      ? Object.fromEntries(
          Object.entries(item.topicFeedUrls.M).map(([topicId, urlsAttr]) => [
            topicId,
            (urlsAttr.L ?? [])
              .map((v) => v.S)
              .filter((u): u is string => typeof u === 'string' && u.length > 0),
          ]),
        )
      : null,
    selectedTopics: item.selectedTopics?.SS ?? null,
    voice: item.voice?.S ?? null,
    durationMinutes:
      item.durationMinutes?.N != null ? Number(item.durationMinutes.N) : null,
    deliveryHour:
      item.deliveryHour?.N != null ? Number(item.deliveryHour.N) : 6,
    firstDigestDate: item.firstDigestDate?.S ?? null,
    digestListenedDates: item.digestListenedDates?.SS ?? null,
    subscribed: item.subscribed?.BOOL ?? false,
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;
  const rawPath = event.rawPath;

  let userId: string;
  try {
    const result = await verifyToken(event.headers?.authorization);
    userId = result.sub;
  } catch (e) {
    const err = e as AuthError;
    return json(err.statusCode ?? 401, { error: err.message });
  }

  if (pathEndsWith(rawPath, '/users/push-token')) {
    if (method !== 'POST') {
      return json(405, { error: 'Method not allowed' });
    }
    return handlePushToken(userId, event.body ?? '{}');
  }

  if (pathEndsWith(rawPath, '/users/push-test')) {
    if (method !== 'POST') {
      return json(405, { error: 'Method not allowed' });
    }
    return handlePushTest(userId);
  }

  if (method === 'GET') {
    return handleGet(userId);
  }

  if (method === 'POST') {
    return handlePost(userId, event.body ?? '{}');
  }

  return json(405, { error: 'Method not allowed' });
};

async function handleGet(userId: string) {
  try {
    console.log('[user-preferences] GET', { userId });
    const result = await dynamo.send(
      new GetItemCommand({
        TableName: USERS_TABLE,
        Key: { userId: { S: userId } },
      }),
    );

    if (!result.Item) {
      return json(200, {
        timezone: null,
        topicFeedUrls: null,
        deliveryHour: null,
        selectedTopics: null,
        voice: null,
        durationMinutes: null,
        firstDigestDate: null,
        digestListenedDates: null,
        subscribed: false,
      });
    }

    return json(200, {
      timezone: result.Item.timezone?.S ?? null,
      topicFeedUrls: result.Item.topicFeedUrls?.M
        ? Object.fromEntries(
            Object.entries(result.Item.topicFeedUrls.M).map(
              ([topicId, urlsAttr]) => [
                topicId,
                (urlsAttr.L ?? [])
                  .map((v) => v.S)
                  .filter(
                    (u): u is string =>
                      typeof u === 'string' && u.length > 0,
                  ),
              ],
            ),
          )
        : null,
      deliveryHour:
        result.Item.deliveryHour?.N != null
          ? Number(result.Item.deliveryHour.N)
          : null,
      selectedTopics: result.Item.selectedTopics?.SS ?? null,
      voice: result.Item.voice?.S ?? null,
      durationMinutes:
        result.Item.durationMinutes?.N != null
          ? Number(result.Item.durationMinutes.N)
          : null,
      firstDigestDate: result.Item.firstDigestDate?.S ?? null,
      digestListenedDates: result.Item.digestListenedDates?.SS ?? null,
      subscribed: result.Item.subscribed?.BOOL ?? false,
    });
  } catch (err) {
    console.error('[user-preferences] GET failed', {
      userId,
      err: String(err),
    });
    return json(500, { error: 'Failed to read preferences' });
  }
}

async function handlePost(userId: string, rawBody: string) {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const timezone = body.timezone;
  const topicFeedUrlsRaw = body.topicFeedUrls;
  const deliveryHourRaw = body.deliveryHour;
  const selectedTopicsRaw = body.selectedTopics;
  const voiceRaw = body.voice;
  const durationMinutesRaw = body.durationMinutes;
  const firstDigestDateRaw = body.firstDigestDate;
  const digestListenedDatesRaw = body.digestListenedDates;
  const subscribedRaw = body.subscribed;

  if (!timezone || typeof timezone !== 'string') {
    return json(400, {
      error: 'timezone is required (IANA format, e.g. "America/New_York")',
    });
  }

  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    return json(400, { error: `Invalid IANA timezone: ${timezone}` });
  }

  let topicFeedUrlsFromBody: Record<string, string[]> | undefined;
  if (topicFeedUrlsRaw !== undefined) {
    if (
      typeof topicFeedUrlsRaw !== 'object' ||
      topicFeedUrlsRaw === null ||
      Array.isArray(topicFeedUrlsRaw)
    ) {
      return json(400, { error: 'topicFeedUrls must be an object' });
    }
    const entries = Object.entries(topicFeedUrlsRaw as Record<string, unknown>);
    if (entries.length > 20) {
      return json(400, { error: 'topicFeedUrls must have at most 20 topics' });
    }
    const parsed: Record<string, string[]> = {};
    for (const [topicId, urls] of entries) {
      if (
        !Array.isArray(urls) ||
        urls.length > 50 ||
        !urls.every((u) => typeof u === 'string')
      ) {
        return json(400, {
          error: `topicFeedUrls.${topicId} must be an array of up to 50 strings`,
        });
      }
      for (const url of urls) {
        try {
          new URL(url);
        } catch {
          return json(400, { error: `Invalid feed URL: ${url}` });
        }
      }
      const deduped = [...new Set(urls as string[])];
      if (deduped.length > 0) parsed[topicId] = deduped;
    }
    topicFeedUrlsFromBody = parsed;
  }

  let selectedTopicsFromBody: string[] | undefined;
  if (selectedTopicsRaw !== undefined) {
    if (
      !Array.isArray(selectedTopicsRaw) ||
      selectedTopicsRaw.length > 20 ||
      !selectedTopicsRaw.every((t) => typeof t === 'string')
    ) {
      return json(400, {
        error: 'selectedTopics must be an array of up to 20 strings',
      });
    }
    selectedTopicsFromBody = selectedTopicsRaw as string[];
  }

  const VALID_VOICES = new Set([
    'alloy',
    'echo',
    'fable',
    'nova',
    'onyx',
    'shimmer',
  ]);

  let voiceFromBody: string | undefined;
  if (voiceRaw !== undefined) {
    if (typeof voiceRaw === 'string' && VALID_VOICES.has(voiceRaw)) {
      voiceFromBody = voiceRaw;
    } else if (voiceRaw !== null) {
      return json(400, {
        error: 'voice must be one of: alloy, echo, fable, nova, onyx, shimmer',
      });
    }
    // voiceRaw === null → explicit clear (voiceFromBody stays undefined, merged below)
  }

  let durationFromBody: 3 | 5 | 10 | undefined;
  if (durationMinutesRaw !== undefined) {
    if (
      durationMinutesRaw === 3 ||
      durationMinutesRaw === 5 ||
      durationMinutesRaw === 10
    ) {
      durationFromBody = durationMinutesRaw;
    } else if (durationMinutesRaw !== null) {
      return json(400, { error: 'durationMinutes must be 3, 5, or 10' });
    }
  }

  let deliveryHourFromBody: number | undefined;
  if (
    typeof deliveryHourRaw === 'number' &&
    deliveryHourRaw >= 0 &&
    deliveryHourRaw <= 23
  ) {
    deliveryHourFromBody = deliveryHourRaw;
  } else if (deliveryHourRaw !== undefined && deliveryHourRaw !== null) {
    return json(400, { error: 'deliveryHour must be an integer 0–23' });
  }

  let digestListenedDatesFromBody: string[] | undefined;
  if (digestListenedDatesRaw !== undefined) {
    if (
      !Array.isArray(digestListenedDatesRaw) ||
      digestListenedDatesRaw.length > 31 ||
      !digestListenedDatesRaw.every((d) => typeof d === 'string')
    ) {
      return json(400, {
        error: 'digestListenedDates must be an array of up to 31 date strings',
      });
    }
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (!(digestListenedDatesRaw as string[]).every((d) => DATE_RE.test(d))) {
      return json(400, {
        error: 'digestListenedDates entries must be YYYY-MM-DD strings',
      });
    }
    digestListenedDatesFromBody = [...new Set(digestListenedDatesRaw as string[])];
  }

  // Load existing row — PutItem replaces the whole item, so partial POSTs must merge
  let existingItem: Record<string, AttributeValue> | undefined;
  try {
    const existing = await dynamo.send(
      new GetItemCommand({
        TableName: USERS_TABLE,
        Key: { userId: { S: userId } },
      }),
    );
    existingItem = existing.Item;
  } catch (err) {
    console.error('[user-preferences] New DynamoDB GetItem failed', {
      userId,
      err: String(err),
    });
    return json(500, { error: 'Failed to read existing preferences' });
  }

  const prev = readExistingPrefs(existingItem);

  const mergedTopicFeedUrls =
    topicFeedUrlsFromBody !== undefined
      ? Object.keys(topicFeedUrlsFromBody).length > 0
        ? topicFeedUrlsFromBody
        : null
      : prev.topicFeedUrls;

  const mergedSelectedTopics =
    selectedTopicsFromBody !== undefined
      ? selectedTopicsFromBody.length > 0
        ? selectedTopicsFromBody
        : null
      : prev.selectedTopics;

  const mergedVoice =
    voiceRaw !== undefined ? (voiceFromBody ?? null) : prev.voice;

  const mergedDuration =
    durationMinutesRaw !== undefined
      ? (durationFromBody ?? null)
      : prev.durationMinutes;

  const mergedDeliveryHour = deliveryHourFromBody ?? prev.deliveryHour;

  // firstDigestDate: only set once — never overwrite an earlier date
  const mergedFirstDigestDate =
    firstDigestDateRaw !== undefined &&
    typeof firstDigestDateRaw === 'string' &&
    !prev.firstDigestDate
      ? firstDigestDateRaw
      : prev.firstDigestDate;

  const mergedDigestListenedDates =
    digestListenedDatesFromBody !== undefined
      ? digestListenedDatesFromBody.length > 0
        ? digestListenedDatesFromBody
        : null
      : prev.digestListenedDates;

  // subscribed: always updated from client (client syncs RevenueCat status on launch)
  const mergedSubscribed =
    typeof subscribedRaw === 'boolean' ? subscribedRaw : prev.subscribed;

  // Save to DynamoDB (full item — merged)
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: USERS_TABLE,
        Item: {
          userId: { S: userId },
          timezone: { S: timezone },
          deliveryHour: { N: String(mergedDeliveryHour) },
          updatedAt: { N: String(Date.now()) },
          ...(mergedTopicFeedUrls &&
          Object.keys(mergedTopicFeedUrls).length > 0
            ? {
                topicFeedUrls: {
                  M: Object.fromEntries(
                    Object.entries(mergedTopicFeedUrls).map(([topicId, urls]) => [
                      topicId,
                      { L: urls.map((url) => ({ S: url })) },
                    ]),
                  ),
                },
              }
            : {}),
          ...(mergedSelectedTopics && mergedSelectedTopics.length > 0
            ? { selectedTopics: { SS: mergedSelectedTopics } }
            : {}),
          ...(mergedVoice ? { voice: { S: mergedVoice } } : {}),
          ...(mergedDuration != null
            ? { durationMinutes: { N: String(mergedDuration) } }
            : {}),
          ...(mergedFirstDigestDate
            ? { firstDigestDate: { S: mergedFirstDigestDate } }
            : {}),
          ...(mergedDigestListenedDates && mergedDigestListenedDates.length > 0
            ? { digestListenedDates: { SS: mergedDigestListenedDates } }
            : {}),
          subscribed: { BOOL: mergedSubscribed },
        },
      }),
    );
  } catch (err) {
    console.error('[user-preferences] DynamoDB PutItem failed', {
      userId,
      err: String(err),
    });
    return json(500, { error: 'Failed to save preferences' });
  }

  console.log('[user-preferences] prefs saved', {
    userId,
    timezone,
    deliveryHour: mergedDeliveryHour,
    hasTopicFeedUrls: Boolean(
      mergedTopicFeedUrls && Object.keys(mergedTopicFeedUrls).length,
    ),
    hasSelectedTopics: Boolean(mergedSelectedTopics?.length),
    voice: mergedVoice,
    durationMinutes: mergedDuration,
    listenedDays: mergedDigestListenedDates?.length ?? 0,
  });

  try {
    await upsertSchedule(userId, timezone, mergedDeliveryHour);
    console.log('[user-preferences] schedule upserted', {
      userId,
      timezone,
      hour: mergedDeliveryHour,
    });
  } catch (err) {
    console.error('[user-preferences] schedule upsert failed', {
      userId,
      err: String(err),
    });
  }

  return json(200, {
    timezone,
    topicFeedUrls: mergedTopicFeedUrls,
    deliveryHour: mergedDeliveryHour,
    selectedTopics: mergedSelectedTopics,
    voice: mergedVoice,
    durationMinutes: mergedDuration,
    firstDigestDate: mergedFirstDigestDate,
    digestListenedDates: mergedDigestListenedDates,
    subscribed: mergedSubscribed,
  });
}

async function handlePushToken(userId: string, rawBody: string) {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const tokenRaw = body.token;
  const enabledRaw = body.enabled;

  const token = typeof tokenRaw === 'string' ? tokenRaw.trim() : '';
  const enabled = enabledRaw === undefined ? true : Boolean(enabledRaw);

  if (!enabled) {
    try {
      await dynamo.send(
        new UpdateItemCommand({
          TableName: USERS_TABLE,
          Key: { userId: { S: userId } },
          UpdateExpression:
            'SET iosPushEnabled = :enabled, updatedAt = :updatedAt REMOVE iosPushToken, iosPushEndpointArn',
          ExpressionAttributeValues: {
            ':enabled': { BOOL: false },
            ':updatedAt': { N: String(Date.now()) },
          },
        }),
      );
      return json(200, { pushEnabled: false });
    } catch (err) {
      console.error('[user-preferences] disable push failed', {
        userId,
        err: String(err),
      });
      return json(500, { error: 'Failed to disable push notifications' });
    }
  }

  if (!token || token.length < 32) {
    return json(400, {
      error: 'token is required and must be a valid APNs token',
    });
  }
  if (!SNS_PLATFORM_APPLICATION_ARN) {
    return json(500, { error: 'Push notifications are not configured' });
  }

  let endpointArn = '';
  try {
    const result = await sns.send(
      new CreatePlatformEndpointCommand({
        PlatformApplicationArn: SNS_PLATFORM_APPLICATION_ARN,
        Token: token,
        CustomUserData: userId,
      }),
    );
    endpointArn = result.EndpointArn ?? '';
  } catch (err) {
    const msg = String(err);
    const existingArn = msg.match(
      /Endpoint (arn:aws:sns[^ ]+) already exists/,
    )?.[1];
    if (!existingArn) {
      console.error('[user-preferences] create endpoint failed', {
        userId,
        err: msg,
      });
      return json(500, { error: 'Failed to register push token' });
    }
    endpointArn = existingArn;
  }

  if (!endpointArn) {
    return json(500, { error: 'Failed to resolve push endpoint' });
  }

  try {
    await sns.send(
      new SetEndpointAttributesCommand({
        EndpointArn: endpointArn,
        Attributes: {
          Token: token,
          Enabled: 'true',
          CustomUserData: userId,
        },
      }),
    );
  } catch (err) {
    console.error('[user-preferences] set endpoint attrs failed', {
      userId,
      endpointArn,
      err: String(err),
    });
  }

  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: USERS_TABLE,
        Key: { userId: { S: userId } },
        UpdateExpression:
          'SET iosPushToken = :token, iosPushEndpointArn = :endpointArn, iosPushEnabled = :enabled, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':token': { S: token },
          ':endpointArn': { S: endpointArn },
          ':enabled': { BOOL: true },
          ':updatedAt': { N: String(Date.now()) },
        },
      }),
    );
  } catch (err) {
    console.error('[user-preferences] persist push token failed', {
      userId,
      endpointArn,
      err: String(err),
    });
    return json(500, { error: 'Failed to persist push endpoint' });
  }

  return json(200, { pushEnabled: true });
}

async function handlePushTest(userId: string) {
  let endpointArn = '';
  try {
    const user = await dynamo.send(
      new GetItemCommand({
        TableName: USERS_TABLE,
        Key: { userId: { S: userId } },
        ProjectionExpression: 'iosPushEndpointArn, iosPushEnabled',
      }),
    );
    endpointArn = user.Item?.iosPushEndpointArn?.S ?? '';
    const pushEnabled = user.Item?.iosPushEnabled?.BOOL ?? false;
    if (!endpointArn || !pushEnabled) {
      return json(400, {
        error: 'Push is not enabled for this user on this device.',
      });
    }
  } catch (err) {
    console.error('[user-preferences] push test read user failed', {
      userId,
      err: String(err),
    });
    return json(500, { error: 'Failed to load push endpoint' });
  }

  const payload = {
    aps: {
      alert: {
        title: 'Podcastify test notification',
        body: 'Tap to open Today screen.',
      },
      sound: 'default',
    },
    target: 'today',
  };

  try {
    await sns.send(
      new PublishCommand({
        TargetArn: endpointArn,
        MessageStructure: 'json',
        Message: JSON.stringify({
          APNS: JSON.stringify(payload),
          APNS_SANDBOX: JSON.stringify(payload),
          default: 'Podcastify test notification',
        }),
      }),
    );
  } catch (err) {
    console.error('[user-preferences] push test publish failed', {
      userId,
      endpointArn,
      err: String(err),
    });
    return json(500, { error: 'Failed to send test push' });
  }

  return json(200, { sent: true });
}

async function upsertSchedule(
  userId: string,
  timezone: string,
  hour = 6,
): Promise<void> {
  // Schedule names: letters, numbers, hyphens, underscores only (max 64 chars)
  const name = `digest-${userId.replace(/[^a-zA-Z0-9-]/g, '_')}`.slice(0, 64);
  const scheduledHour = (hour - 1 + 24) % 24;
  const scheduledMinute = pickStableMinute(userId, hour);

  const scheduleParams = {
    Name: name,
    GroupName: SCHEDULE_GROUP,
    ScheduleExpression: `cron(${scheduledMinute} ${scheduledHour} * * ? *)`,
    ScheduleExpressionTimezone: timezone,
    FlexibleTimeWindow: { Mode: 'OFF' as const },
    Target: {
      Arn: TRIGGER_LAMBDA_ARN,
      RoleArn: SCHEDULER_ROLE_ARN,
      Input: JSON.stringify({ userId }),
    },
    State: 'ENABLED' as const,
  };

  console.log('[user-preferences] computed digest schedule time', {
    userId,
    requestedHour: hour,
    scheduledHour,
    scheduledMinute,
    timezone,
  });

  try {
    await scheduler.send(new UpdateScheduleCommand(scheduleParams));
  } catch (e) {
    if (e instanceof ResourceNotFoundException) {
      await scheduler.send(new CreateScheduleCommand(scheduleParams));
    } else {
      throw e;
    }
  }
}

function pickStableMinute(userId: string, hour: number): number {
  // Stable "random" minute per user and preferred hour to spread load (0-50).
  const seed = `${userId}:${hour}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % 51;
}
