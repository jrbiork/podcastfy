"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// digest-scheduler-trigger/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_client_sqs = require("@aws-sdk/client-sqs");

// shared/s3.ts
var import_client_s3 = require("@aws-sdk/client-s3");
var import_s3_request_presigner = require("@aws-sdk/s3-request-presigner");
var MAX_PDF_BYTES = 40 * 1024 * 1024;
var s3 = new import_client_s3.S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
var BUCKET = process.env.S3_BUCKET ?? "podcastify-jobs";
function digestStatusKey(userId, date) {
  return `digests/${userId}/${date}/status.json`;
}
async function readDigestStatus(userId, date) {
  try {
    const res = await s3.send(
      new import_client_s3.GetObjectCommand({ Bucket: BUCKET, Key: digestStatusKey(userId, date) })
    );
    const body = await res.Body?.transformToString();
    if (!body) return null;
    return JSON.parse(body);
  } catch {
    return null;
  }
}

// digest-scheduler-trigger/handler.ts
var IN_PROGRESS = /* @__PURE__ */ new Set([
  "queued",
  "fetching_feeds",
  "ranking",
  "summarizing",
  "scripting",
  "generating_audio"
]);
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var sqsClient = new import_client_sqs.SQSClient({});
var DEFAULT_TOP_N = 6;
var handler = async (event) => {
  const { userId } = event;
  if (!userId) {
    console.error("[scheduler-trigger] missing userId in event", { event });
    return;
  }
  const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  console.log("[scheduler-trigger] fired", { userId, date });
  const status = await readDigestStatus(userId, date);
  if (status && (status.status === "done" || IN_PROGRESS.has(status.status))) {
    console.log("[scheduler-trigger] skipping, already", status.status, { userId, date });
    return;
  }
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const prevStatus = await readDigestStatus(userId, yesterday);
  const priorityTopicId = prevStatus?.status === "done" ? prevStatus.skippedTopicId : void 0;
  let topicFeedUrls;
  let voice;
  try {
    const result = await dynamo.send(new import_client_dynamodb.GetItemCommand({
      TableName: process.env.USERS_TABLE,
      Key: { userId: { S: userId } }
    }));
    const item = result.Item;
    if (item) {
      if (item.topicFeedUrls?.M) {
        const parsed = Object.fromEntries(
          Object.entries(item.topicFeedUrls.M).map(([topicId, urlsAttr]) => [
            topicId,
            (urlsAttr.L ?? []).map((v) => v.S).filter((u) => typeof u === "string" && u.length > 0)
          ])
        );
        if (Object.keys(parsed).length > 0) topicFeedUrls = parsed;
      }
      if (item.voice?.S) voice = item.voice.S;
      const subscribed = item.subscribed?.BOOL ?? false;
      const digestListenedDates = item.digestListenedDates?.SS ?? [];
      if (!subscribed) {
        const HARD_PAYWALL_LISTEN_DAYS = 3;
        if (digestListenedDates.length >= HARD_PAYWALL_LISTEN_DAYS) {
          console.log("[scheduler-trigger] skipping free user at hard paywall", {
            userId,
            listenedDays: digestListenedDates.length
          });
          return;
        }
      }
    }
  } catch (err) {
    console.warn("[scheduler-trigger] failed to read user prefs, using defaults", { userId, err: String(err) });
  }
  const message = { userId, date, topN: DEFAULT_TOP_N };
  if (topicFeedUrls) message.topicFeedUrls = topicFeedUrls;
  if (voice) message.voice = voice;
  if (priorityTopicId) message.priorityTopicId = priorityTopicId;
  await sqsClient.send(new import_client_sqs.SendMessageCommand({
    QueueUrl: process.env.DIGEST_QUEUE_URL,
    MessageBody: JSON.stringify(message)
  }));
  console.log("[scheduler-trigger] enqueued digest", {
    userId,
    date,
    topicCount: Object.keys(topicFeedUrls ?? {}).length,
    voice,
    topN: DEFAULT_TOP_N,
    priorityTopicId: priorityTopicId ?? null
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
