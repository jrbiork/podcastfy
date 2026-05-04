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
    "https://feeds.bbci.co.uk/news/rss.xml",
    "https://feeds.npr.org/1001/rss.xml",
    "https://www.theguardian.com/world/rss",
    "https://api.axios.com/feed/",
    "https://feeds.reuters.com/reuters/worldNews"
  ],
  technology: [
    "https://www.theverge.com/rss/index.xml",
    "https://techcrunch.com/feed/",
    "https://www.wired.com/feed/rss",
    "https://feeds.arstechnica.com/arstechnica/index",
    "https://www.technologyreview.com/feed/"
  ],
  "business-finance": [
    "https://feeds.a.dj.com/rss/RSSWSJD.xml",
    "https://feeds.bloomberg.com/markets/news.rss",
    "https://feeds.feedburner.com/HarvardBusiness",
    "https://feeds.reuters.com/reuters/businessNews",
    "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml"
  ],
  politics: [
    "https://www.politico.com/rss/politicopicks.xml",
    "https://www.theguardian.com/politics/rss",
    "https://feeds.npr.org/1014/rss.xml",
    "https://api.axios.com/feed/",
    "https://www.theatlantic.com/feed/all/"
  ],
  "health-wellness": [
    "https://feeds.bbci.co.uk/news/health/rss.xml",
    "https://feeds.npr.org/1128/rss.xml",
    "https://www.healthline.com/rss/health-news",
    "https://www.statnews.com/feed/",
    "https://rss.nytimes.com/services/xml/rss/nyt/Health.xml"
  ],
  science: [
    "https://www.quantamagazine.org/feed/",
    "https://www.theguardian.com/science/rss",
    "https://www.sciencedaily.com/rss/all.rss",
    "https://www.newscientist.com/feed/home/",
    "https://www.technologyreview.com/feed/"
  ],
  productivity: [
    "https://lifehacker.com/rss",
    "https://zenhabits.net/feed/",
    "https://tim.blog/feed/",
    "https://www.productivityist.com/feed/",
    "https://www.fastcompany.com/latest/rss"
  ],
  fitness: [
    "https://www.menshealth.com/rss/all.xml/",
    "https://www.runnersworld.com/rss/all/index.xml",
    "https://www.shape.com/feeds/all.xml",
    "https://www.self.com/feed/self-atom.xml",
    "https://www.nerdfitness.com/blog/feed/"
  ],
  "mental-health": [
    "https://www.theguardian.com/society/mental-health/rss",
    "https://www.sciencedaily.com/rss/mind_brain/mental_health.xml",
    "https://medlineplus.gov/feeds/topics/depression.xml",
    "https://www.statnews.com/category/health/feed/",
    "https://www.healthline.com/rss/health-news"
  ],
  food: [
    "https://www.smittenkitchen.com/feed/",
    "https://www.bonappetit.com/feed/rss",
    "https://www.eater.com/rss/index.xml",
    "https://www.epicurious.com/services/rss/recipes/new",
    "https://food52.com/blog.rss"
  ],
  travel: [
    "https://www.cntraveler.com/feed/rss",
    "https://skift.com/feed/",
    "https://www.bbc.com/travel/feed.rss",
    "https://www.travelandleisure.com/feeds/syndication/rss_latest.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Travel.xml"
  ],
  parenting: [
    "https://www.parents.com/feeds/all",
    "https://www.babycenter.com/rss/baby/",
    "https://www.todaysparent.com/feed/",
    "https://feeds.npr.org/1128/rss.xml",
    "https://www.fatherly.com/feed"
  ],
  "entertainment-news": [
    "https://variety.com/feed/",
    "https://www.hollywoodreporter.com/feed/",
    "https://deadline.com/feed/",
    "https://ew.com/feed/",
    "https://feeds.npr.org/1008/rss.xml"
  ],
  "movies-tv": [
    "https://www.slashfilm.com/feed/",
    "https://www.indiewire.com/feed/rss.xml",
    "https://www.avclub.com/rss.xml",
    "https://www.vulture.com/rss/index.xml",
    "https://collider.com/feed/"
  ],
  music: [
    "https://pitchfork.com/rss/news/feed.xml",
    "https://www.rollingstone.com/feed/",
    "https://www.nme.com/feed",
    "https://www.billboard.com/feed/",
    "https://www.stereogum.com/feed/"
  ],
  gaming: [
    "https://www.polygon.com/rss/index.xml",
    "https://www.ign.com/rss.xml",
    "https://www.gamespot.com/feeds/mashup/?type=rss",
    "https://kotaku.com/rss",
    "https://www.pcgamer.com/rss/"
  ],
  books: [
    "https://lithub.com/feed/",
    "https://www.theguardian.com/books/rss",
    "https://rss.nytimes.com/services/xml/rss/nyt/Books.xml",
    "https://www.theatlantic.com/feed/all/",
    "https://www.bookpage.com/feed/?post_type=preview"
  ],
  startups: [
    "https://techcrunch.com/feed/",
    "https://hnrss.org/best",
    "https://venturebeat.com/feed/",
    "https://www.inc.com/rss",
    "https://www.fastcompany.com/latest/rss"
  ],
  "crypto-web3": [
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "https://cointelegraph.com/rss",
    "https://bitcoinmagazine.com/.rss/full/",
    "https://decrypt.co/feed",
    "https://www.theblock.co/rss.xml"
  ],
  environment: [
    "https://www.theguardian.com/environment/rss",
    "https://www.climatecentral.org/feeds/news.rss",
    "https://www.carbonbrief.org/feed",
    "https://grist.org/feed/",
    "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml"
  ],
  "ai-tech": [
    "https://www.theverge.com/rss/index.xml",
    "https://techcrunch.com/feed/",
    "https://www.wired.com/feed/rss"
  ],
  world: [
    "https://feeds.bbci.co.uk/news/rss.xml",
    "https://www.theguardian.com/world/rss",
    "https://feeds.npr.org/1001/rss.xml"
  ],
  finance: [
    "https://feeds.a.dj.com/rss/RSSWSJD.xml",
    "https://feeds.bloomberg.com/markets/news.rss",
    "https://feeds.feedburner.com/HarvardBusiness"
  ],
  climate: [
    "https://www.theguardian.com/environment/rss",
    "https://www.climatecentral.org/feeds/news.rss",
    "https://www.carbonbrief.org/feed"
  ],
  culture: [
    "https://www.theatlantic.com/feed/all/",
    "https://feeds.npr.org/1008/rss.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Arts.xml"
  ],
  health: [
    "https://feeds.bbci.co.uk/news/health/rss.xml",
    "https://feeds.npr.org/1128/rss.xml",
    "https://www.healthline.com/rss/health-news"
  ],
  sports: [
    "https://feeds.bbci.co.uk/sport/rss.xml",
    "https://www.espn.com/espn/rss/news",
    "https://www.skysports.com/rss/12040"
  ],
  crypto: [
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "https://cointelegraph.com/rss",
    "https://bitcoinmagazine.com/.rss/full/"
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
