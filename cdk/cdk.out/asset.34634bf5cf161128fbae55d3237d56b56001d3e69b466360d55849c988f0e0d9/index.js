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

// data/topicFeedMap.ts
var TOPIC_FEED_URLS_BY_ID = {
  news: [
    "https://www.reuters.com/rssFeed/topNews",
    "https://apnews.com/rss",
    "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"
  ],
  technology: [
    "https://techcrunch.com/feed",
    "https://www.theverge.com/rss/index.xml",
    "https://www.wired.com/feed/rss"
  ],
  "business-finance": [
    "https://www.bloomberg.com/feed/podcast/etf-report.xml",
    "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    "https://feeds.a.dj.com/rss/RSSMarketsMain.xml"
  ],
  politics: [
    "https://www.politico.com/rss/politics08.xml",
    "https://thehill.com/rss/syndicator/19110",
    "https://feeds.npr.org/1014/rss.xml"
  ],
  "health-wellness": [
    "https://www.health.harvard.edu/rss/blog.xml",
    "https://rssfeeds.webmd.com/rss/rss.aspx?RSSSource=RSS_PUBLIC",
    "https://tools.cdc.gov/api/v2/resources/media/403372.rss"
  ],
  science: [
    "https://www.scientificamerican.com/feed/rss/",
    "https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=science",
    "https://www.sciencenews.org/feed"
  ],
  productivity: [
    "https://jamesclear.com/feed",
    "https://zenhabits.net/feed/",
    "https://lifehacker.com/rss"
  ],
  fitness: [
    "https://www.menshealth.com/rss/all.xml/",
    "https://breakingmuscle.com/feed/",
    "https://www.acefitness.org/resources/everyone/blog/rss/"
  ],
  "mental-health": [
    "https://www.psychologytoday.com/us/rss",
    "https://www.verywellmind.com/rss",
    "https://www.mindful.org/feed/"
  ],
  food: [
    "https://www.seriouseats.com/rss",
    "https://rss.nytimes.com/services/xml/rss/nyt/DiningandWine.xml",
    "https://www.bonappetit.com/feed/rss"
  ],
  travel: [
    "https://www.lonelyplanet.com/news/rss.xml",
    "https://www.cntraveler.com/feed/rss",
    "https://thepointsguy.com/feed/"
  ],
  parenting: [
    "https://www.parents.com/thmb/rss",
    "https://www.whattoexpect.com/rss",
    "https://www.scarymommy.com/feed"
  ],
  "entertainment-news": [
    "https://variety.com/feed/",
    "https://www.hollywoodreporter.com/feed",
    "https://ew.com/feed"
  ],
  "movies-tv": [
    "https://www.indiewire.com/feed/",
    "https://collider.com/feed/",
    "https://editorial.rottentomatoes.com/feed/"
  ],
  music: [
    "https://pitchfork.com/rss/news/",
    "https://www.rollingstone.com/music/music-news/feed/",
    "https://www.billboard.com/feed/"
  ],
  gaming: [
    "https://feeds.ign.com/ign/all",
    "https://www.gamespot.com/feeds/mashup/",
    "https://www.polygon.com/rss/index.xml"
  ],
  books: [
    "https://lithub.com/feed/",
    "https://rss.nytimes.com/services/xml/rss/nyt/Books.xml",
    "https://www.theparisreview.org/blog/feed/"
  ],
  startups: [
    "https://techcrunch.com/startups/feed",
    "https://venturebeat.com/feed/",
    "https://www.entrepreneur.com/latest.rss"
  ],
  "crypto-web3": [
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "https://cointelegraph.com/rss",
    "https://decrypt.co/feed"
  ],
  environment: [
    "https://insideclimatenews.org/feed/",
    "https://grist.org/feed/",
    "https://e360.yale.edu/feed/rss.xml"
  ],
  "ai-tech": [
    "https://techcrunch.com/feed",
    "https://www.theverge.com/rss/index.xml",
    "https://www.wired.com/feed/rss"
  ],
  world: [
    "https://www.reuters.com/rssFeed/topNews",
    "https://apnews.com/rss",
    "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"
  ],
  finance: [
    "https://www.bloomberg.com/feed/podcast/etf-report.xml",
    "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    "https://feeds.a.dj.com/rss/RSSMarketsMain.xml"
  ],
  climate: [
    "https://insideclimatenews.org/feed/",
    "https://grist.org/feed/",
    "https://e360.yale.edu/feed/rss.xml"
  ],
  culture: [
    "https://variety.com/feed/",
    "https://www.hollywoodreporter.com/feed",
    "https://ew.com/feed"
  ],
  health: [
    "https://www.health.harvard.edu/rss/blog.xml",
    "https://rssfeeds.webmd.com/rss/rss.aspx?RSSSource=RSS_PUBLIC",
    "https://tools.cdc.gov/api/v2/resources/media/403372.rss"
  ],
  sports: [
    "https://www.menshealth.com/rss/all.xml/",
    "https://breakingmuscle.com/feed/",
    "https://www.acefitness.org/resources/everyone/blog/rss/"
  ],
  crypto: [
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "https://cointelegraph.com/rss",
    "https://decrypt.co/feed"
  ]
};

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
var FEEDS_PER_TOPIC = 5;
var DEFAULT_TOP_N = 9;
function buildTopicFeedUrls(selectedTopics) {
  const result = {};
  for (const topicId of selectedTopics) {
    const urls = TOPIC_FEED_URLS_BY_ID[topicId];
    if (urls?.length) result[topicId] = [...urls].slice(0, FEEDS_PER_TOPIC);
  }
  return result;
}
function readStringArrayAttr(attr) {
  if (!attr) return [];
  if (Array.isArray(attr.SS) && attr.SS.length > 0) return attr.SS;
  if (Array.isArray(attr.L) && attr.L.length > 0) {
    return attr.L.map((v) => v.S).filter((v) => typeof v === "string" && v.length > 0);
  }
  return [];
}
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
  let feedUrls;
  let topicFeedUrls;
  let voice;
  try {
    const result = await dynamo.send(new import_client_dynamodb.GetItemCommand({
      TableName: process.env.USERS_TABLE,
      Key: { userId: { S: userId } }
    }));
    const item = result.Item;
    if (item) {
      const fromSubs = readStringArrayAttr(item.feedUrls);
      if (fromSubs.length > 0) {
        feedUrls = fromSubs.slice(0, 50);
      } else {
        const selectedTopics = readStringArrayAttr(item.selectedTopics);
        if (selectedTopics.length > 0) {
          const built = buildTopicFeedUrls(selectedTopics);
          if (Object.keys(built).length > 0) topicFeedUrls = built;
        }
      }
      if (item.voice?.S) voice = item.voice.S;
      const firstDigestDate = item.firstDigestDate?.S ?? null;
      const subscribed = item.subscribed?.BOOL ?? false;
      if (firstDigestDate && !subscribed) {
        const HARD_PAYWALL_DAYS = 4;
        const daysSince = (Date.now() - new Date(firstDigestDate).getTime()) / (1e3 * 60 * 60 * 24);
        if (daysSince >= HARD_PAYWALL_DAYS) {
          console.log("[scheduler-trigger] skipping free user past trial", { userId, daysSince: daysSince.toFixed(1) });
          return;
        }
      }
    }
  } catch (err) {
    console.warn("[scheduler-trigger] failed to read user prefs, using defaults", { userId, err: String(err) });
  }
  const message = { userId, date, topN: DEFAULT_TOP_N };
  if (feedUrls && feedUrls.length > 0) message.feedUrls = feedUrls;
  else if (topicFeedUrls) message.topicFeedUrls = topicFeedUrls;
  if (voice) message.voice = voice;
  if (priorityTopicId) message.priorityTopicId = priorityTopicId;
  await sqsClient.send(new import_client_sqs.SendMessageCommand({
    QueueUrl: process.env.DIGEST_QUEUE_URL,
    MessageBody: JSON.stringify(message)
  }));
  console.log("[scheduler-trigger] enqueued digest", {
    userId,
    date,
    flatFeedCount: feedUrls?.length ?? 0,
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
