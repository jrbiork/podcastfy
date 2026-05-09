import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

const dynamo = new DynamoDBClient({});
const USERS_TABLE = process.env.USERS_TABLE!;
const WEBHOOK_SECRET = process.env.REVENUECAT_WEBHOOK_SECRET!;

// Events that confirm an active, paid subscription
const ACTIVE_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
]);

// Events that mean the subscription is no longer active
const INACTIVE_EVENTS = new Set([
  'EXPIRATION',
  'BILLING_ISSUES_DETECTED',
]);

// CANCELLATION is intentionally ignored: the subscription remains active until
// the period end, so we wait for EXPIRATION to flip the flag.

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const authHeader = event.headers?.authorization ?? event.headers?.Authorization ?? '';
  if (!WEBHOOK_SECRET || authHeader !== WEBHOOK_SECRET) {
    console.warn('[revenuecat-webhook] unauthorized request');
    return { statusCode: 401, body: 'Unauthorized' };
  }

  let body: { event?: { type?: string; app_user_id?: string } };
  try {
    body = JSON.parse(event.body ?? '{}') as typeof body;
  } catch {
    return { statusCode: 400, body: 'Bad Request' };
  }

  const type = body.event?.type;
  const userId = body.event?.app_user_id;

  if (!type || !userId) {
    console.warn('[revenuecat-webhook] missing type or app_user_id', { type, userId });
    return { statusCode: 400, body: 'Bad Request' };
  }

  let subscribed: boolean | null = null;
  if (ACTIVE_EVENTS.has(type)) subscribed = true;
  else if (INACTIVE_EVENTS.has(type)) subscribed = false;

  if (subscribed === null) {
    console.log('[revenuecat-webhook] ignored event', { type, userId });
    return { statusCode: 200, body: 'Ignored' };
  }

  console.log('[revenuecat-webhook] updating subscription', { type, userId, subscribed });

  await dynamo.send(
    new UpdateItemCommand({
      TableName: USERS_TABLE,
      Key: { userId: { S: userId } },
      UpdateExpression: 'SET subscribed = :s',
      ExpressionAttributeValues: { ':s': { BOOL: subscribed } },
    }),
  );

  return { statusCode: 200, body: 'OK' };
};
