import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import {
  SchedulerClient,
  CreateScheduleCommand,
  UpdateScheduleCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-scheduler';
import { verifyToken, AuthError } from '../shared/auth';

const dynamo = new DynamoDBClient({});
const scheduler = new SchedulerClient({});

const USERS_TABLE = process.env.USERS_TABLE!;
const TRIGGER_LAMBDA_ARN = process.env.TRIGGER_LAMBDA_ARN!;
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN!;
const SCHEDULE_GROUP =
  process.env.SCHEDULE_GROUP ?? 'podcastify-digest-schedules';

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
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
    };
  }
  return {
    feedUrls: item.feedUrls?.SS ?? null,
    selectedTopics: item.selectedTopics?.SS ?? null,
    voice: item.voice?.S ?? null,
    durationMinutes:
      item.durationMinutes?.N != null ? Number(item.durationMinutes.N) : null,
    deliveryHour:
      item.deliveryHour?.N != null ? Number(item.deliveryHour.N) : 6,
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;

  let userId: string;
  try {
    const result = await verifyToken(event.headers?.authorization);
    userId = result.sub;
  } catch (e) {
    const err = e as AuthError;
    return json(err.statusCode ?? 401, { error: err.message });
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
        feedUrls: null,
        deliveryHour: null,
        selectedTopics: null,
        voice: null,
        durationMinutes: null,
      });
    }

    return json(200, {
      timezone: result.Item.timezone?.S ?? null,
      feedUrls: result.Item.feedUrls?.SS ?? null,
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
  const feedUrlsRaw = body.feedUrls;
  const deliveryHourRaw = body.deliveryHour;
  const selectedTopicsRaw = body.selectedTopics;
  const voiceRaw = body.voice;
  const durationMinutesRaw = body.durationMinutes;

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

  let feedUrlsFromBody: string[] | undefined;
  if (feedUrlsRaw !== undefined) {
    if (
      !Array.isArray(feedUrlsRaw) ||
      feedUrlsRaw.length > 50 ||
      !feedUrlsRaw.every((u) => typeof u === 'string')
    ) {
      return json(400, {
        error: 'feedUrls must be an array of up to 50 strings',
      });
    }
    for (const url of feedUrlsRaw) {
      try {
        new URL(url);
      } catch {
        return json(400, { error: `Invalid feed URL: ${url}` });
      }
    }
    feedUrlsFromBody = feedUrlsRaw as string[];
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

  const mergedFeedUrls =
    feedUrlsFromBody !== undefined
      ? feedUrlsFromBody.length > 0
        ? feedUrlsFromBody
        : null
      : prev.feedUrls;

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
          ...(mergedFeedUrls && mergedFeedUrls.length > 0
            ? { feedUrls: { SS: mergedFeedUrls } }
            : {}),
          ...(mergedSelectedTopics && mergedSelectedTopics.length > 0
            ? { selectedTopics: { SS: mergedSelectedTopics } }
            : {}),
          ...(mergedVoice ? { voice: { S: mergedVoice } } : {}),
          ...(mergedDuration != null
            ? { durationMinutes: { N: String(mergedDuration) } }
            : {}),
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
    hasFeedUrls: Boolean(mergedFeedUrls?.length),
    hasSelectedTopics: Boolean(mergedSelectedTopics?.length),
    voice: mergedVoice,
    durationMinutes: mergedDuration,
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
    feedUrls: mergedFeedUrls,
    deliveryHour: mergedDeliveryHour,
    selectedTopics: mergedSelectedTopics,
    voice: mergedVoice,
    durationMinutes: mergedDuration,
  });
}

async function upsertSchedule(
  userId: string,
  timezone: string,
  hour = 6,
): Promise<void> {
  // Schedule names: letters, numbers, hyphens, underscores only (max 64 chars)
  const name = `digest-${userId.replace(/[^a-zA-Z0-9-]/g, '_')}`.slice(0, 64);

  const scheduleParams = {
    Name: name,
    GroupName: SCHEDULE_GROUP,
    ScheduleExpression: `cron(0 ${hour} * * ? *)`,
    ScheduleExpressionTimezone: timezone,
    FlexibleTimeWindow: { Mode: 'OFF' as const },
    Target: {
      Arn: TRIGGER_LAMBDA_ARN,
      RoleArn: SCHEDULER_ROLE_ARN,
      Input: JSON.stringify({ userId }),
    },
    State: 'ENABLED' as const,
  };

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
