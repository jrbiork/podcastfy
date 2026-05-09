import { SQSHandler } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { extractArticle } from '../shared/scraper';
import {
  generateAlternatingAudio,
  getPairedVoice,
} from '../worker/tts';
import { readDigestStatus, writeDigestStatus, uploadDigestAudio } from '../shared/s3';
import { fetchRecentArticles, fetchArticlesByTopic } from './feedFetcher';
import { deduplicateAndRank } from './digestRanker';
import { enrichWithPopularity } from './popularityFetcher';
import { filterAdLikeStories } from './adStoryFilter';
import {
  summarizeArticle,
  generateDigestScript,
  mergeStoryAudioBounds,
} from './digestWriter';
import {
  filterRecentlyServedArticles,
  loadRecentServedStories,
  persistServedStories,
} from './servedHistory';
import { TOPIC_FEED_URLS_BY_ID } from '../data/topicFeedMap';
import { mapOrderedConcurrent } from '../shared/concurrency';

const ACTIVE_STATUSES = new Set([
  'fetching_feeds',
  'enriching_popularity',
  'ranking',
  'summarizing',
  'scripting',
  'generating_audio',
]);

// gpt-4o-mini Tier 1 = 500 RPM; conc 3 over 9 articles ≈ 9s wall-clock, well under cap.
const SUMMARY_CONCURRENCY = 3;

// Default feeds cover multiple topics with several sources each so every category
// can be represented in the digest (see `TOPIC_FEED_URLS_BY_ID` for canonical lists).
const DEFAULT_DIGEST_FEEDS = [
  // AI & Tech
  {
    id: 'verge',
    name: 'The Verge',
    url: 'https://www.theverge.com/rss/index.xml',
  },
  { id: 'techcrunch', name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
  { id: 'wired', name: 'Wired', url: 'https://www.wired.com/feed/rss' },
  // Startups
  { id: 'hackernews', name: 'Hacker News', url: 'https://hnrss.org/best' },
  {
    id: 'venturebeat',
    name: 'VentureBeat',
    url: 'https://venturebeat.com/feed/',
  },
  {
    id: 'fastco',
    name: 'Fast Company',
    url: 'https://www.fastcompany.com/latest/rss',
  },
  // Finance
  { id: 'wsj', name: 'WSJ', url: 'https://feeds.a.dj.com/rss/RSSWSJD.xml' },
  {
    id: 'bloomberg',
    name: 'Bloomberg',
    url: 'https://feeds.bloomberg.com/technology/news.rss',
  },
  {
    id: 'hbr',
    name: 'HBR',
    url: 'https://feeds.feedburner.com/HarvardBusiness',
  },
  // World News
  { id: 'bbc', name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  {
    id: 'guardian',
    name: 'The Guardian',
    url: 'https://www.theguardian.com/world/rss',
  },
  { id: 'npr', name: 'NPR News', url: 'https://feeds.npr.org/1001/rss.xml' },
];

// Reverse lookup: feed URL → topicId (built once from the curated map)
const URL_TO_TOPIC = new Map<string, string>();
for (const [topicId, urls] of Object.entries(TOPIC_FEED_URLS_BY_ID)) {
  for (const url of urls) URL_TO_TOPIC.set(url, topicId);
}

const dynamo = new DynamoDBClient({});
const sns = new SNSClient({});
const USERS_TABLE = process.env.USERS_TABLE!;
const LOOKBACK_DAYS = 3;
const FUZZY_TITLE_SIMILARITY_THRESHOLD = 0.75;
// Fixed digest size targeting ~5–7 min of audio
const DEFAULT_TOP_N = 9;

/**
 * Infers a topicId for a feed URL.
 * First checks the curated topic map (exact match), then falls back to
 * URL keyword heuristics so custom subscriptions still get grouped.
 */
function inferTopicFromUrl(url: string): string | undefined {
  const exact = URL_TO_TOPIC.get(url);
  if (exact) return exact;

  const u = url.toLowerCase();
  if (/books?|lithu?b|novel|fiction|literary|goodread/.test(u)) return 'books';
  if (/nme\.com|\/music\/|pitchfork|rollingstone|billboard/.test(u))
    return 'music';
  if (/health|wellness|medical|medicine|webmd|healthline|statnews/.test(u))
    return 'health-wellness';
  if (/mental.?health|therapy|psycholog|mindful/.test(u))
    return 'mental-health';
  if (/fitness|workout|running|runnersworld|menshealth|shape\.com/.test(u))
    return 'fitness';
  if (
    /tech|software|hardware|gadget|engadget|theverge|arstechnica|wired\.com/.test(
      u,
    )
  )
    return 'technology';
  if (
    /openai|deepmind|anthropic|machine.learn|artificial.intell|\/ai\//.test(u)
  )
    return 'ai-tech';
  if (/startup|venture|ycombinator|producthunt/.test(u)) return 'startups';
  if (/crypto|bitcoin|ethereum|web3|blockchain/.test(u)) return 'crypto';
  if (/economic|economy|macro|inflation|gdp|unemployment|cpi/.test(u))
    return 'economy';
  if (/science|research|scidaily|quanta|newscientist/.test(u)) return 'science';
  if (/finance|invest|market|economic|bloomberg|wsj|nasdaq/.test(u))
    return 'business-finance';
  if (/\/sport|football|soccer|basketball|nfl|nba|espn|bleacher/.test(u))
    return 'news';
  if (/film|movie|cinema|\/tv\/|television|imdb|rottentomato/.test(u))
    return 'movies-tv';
  if (/gaming|\/game|esport|playstation|xbox|nintendo|ign\.com|kotaku/.test(u))
    return 'gaming';
  if (/food|recipe|cook|cuisine|restaurant|eater\.com/.test(u)) return 'food';
  if (/travel|destination|hotel|tourist|lonely.?planet/.test(u))
    return 'travel';
  if (/politic|democrat|republican|congress|senate/.test(u)) return 'politics';
  if (/environment|climate|green|sustainab|ecolog/.test(u))
    return 'environment';
  if (/parent|family|child|kid|baby/.test(u)) return 'parenting';
  if (/productiv|lifehack|habit|efficiency/.test(u)) return 'productivity';
  if (/entertain|celebrity|popculture|variety\.com/.test(u))
    return 'entertainment-news';

  return undefined;
}

interface DigestMessage {
  userId: string;
  date: string;
  feedUrls?: string[];
  topicFeedUrls?: Record<string, string[]>;
  voice?: string;
  topN?: number;
  /** Topic that received zero stories yesterday — gets first slot in Pass 1 today. */
  priorityTopicId?: string;
}

async function publishDigestReadyPush(
  userId: string,
  date: string,
  title: string,
): Promise<void> {
  if (!USERS_TABLE) return;

  const user = await dynamo.send(
    new GetItemCommand({
      TableName: USERS_TABLE,
      Key: { userId: { S: userId } },
      ProjectionExpression: 'iosPushEndpointArn, iosPushEnabled, iosPushEndpoints',
    }),
  );

  const endpointArn = user.Item?.iosPushEndpointArn?.S;
  const pushEnabled = user.Item?.iosPushEnabled?.BOOL ?? false;
  if (!pushEnabled) return;

  const endpoints = user.Item?.iosPushEndpoints?.M;
  const endpointArns = endpoints
    ? Object.values(endpoints)
        .map((v) => v.M?.endpointArn?.S)
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];
  const targets = [...new Set([...(endpointArn ? [endpointArn] : []), ...endpointArns])];
  if (targets.length === 0) return;

  const payload = {
    aps: {
      alert: {
        title: 'Your daily digest is ready',
        body: title,
      },
      sound: 'default',
    },
    target: 'today',
    digestDate: date,
  };

  const results = await Promise.allSettled(
    targets.map((arn) =>
      sns.send(
        new PublishCommand({
          TargetArn: arn,
          MessageStructure: 'json',
          Message: JSON.stringify({
            default: 'Your daily digest is ready',
            APNS: JSON.stringify(payload),
            APNS_SANDBOX: JSON.stringify(payload),
          }),
        }),
      ),
    ),
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled');
  const failed = results.filter((r) => r.status === 'rejected');
  const disabledCount = failed.filter((r) =>
    String((r as PromiseRejectedResult).reason).includes('EndpointDisabled'),
  ).length;

  console.log('[digest-worker] push publish result', {
    userId,
    date,
    targets: targets.length,
    delivered: succeeded.length,
    failed: failed.length,
    disabledEndpoints: disabledCount,
    messageIds: succeeded.map((r) => (r as PromiseFulfilledResult<any>).value.MessageId).filter(Boolean),
  });
  if (disabledCount > 0) {
    // Endpoint was disabled by Apple after a previous delivery failure — the device
    // has not opened the app recently enough to re-register a fresh APNs token.
    // Nothing can be done server-side; the endpoint will be re-enabled the next
    // time the user opens the app and usePushTokenRefresh calls registerDeviceForPush.
    console.warn('[digest-worker] push skipped: endpoint disabled by Apple', { userId, date, disabledCount });
  }
}

async function processDigest(msg: DigestMessage): Promise<void> {
  const { userId, date } = msg;
  const statusDate = new Date(date + 'T12:00:00Z');

  // Idempotency guard: skip if another invocation already claimed or completed this digest.
  // Multiple SQS messages for the same userId/date can arrive concurrently; the first to
  // write a status past 'queued' wins — subsequent invocations bail out here.
  const currentStatus = await readDigestStatus(userId, date);
  if (currentStatus) {
    if (currentStatus.status === 'done') {
      console.log('[digest-worker] skipping: digest already done', { userId, date });
      return;
    }
    if (ACTIVE_STATUSES.has(currentStatus.status)) {
      console.log('[digest-worker] skipping: digest already in progress', {
        userId,
        date,
        status: currentStatus.status,
      });
      return;
    }
  }

  // 1. Fetch feeds
  await writeDigestStatus(userId, date, { status: 'fetching_feeds' });

  let rawArticles;
  // Match dispatcher: explicit feedUrls (saved subscriptions) win over topic buckets
  if (msg.feedUrls && msg.feedUrls.length > 0) {
    // Group feedUrls by inferred topic so articles get topicIds for grouping/transitions.
    // Feeds that can't be matched to a topic are fetched separately without topicId.
    const topicMap: Record<string, string[]> = {};
    const unknownFeeds: Array<{ id: string; name: string; url: string }> = [];

    for (const url of msg.feedUrls) {
      const topicId = inferTopicFromUrl(url);
      if (topicId) {
        (topicMap[topicId] ??= []).push(url);
      } else {
        unknownFeeds.push({ id: url, name: new URL(url).hostname, url });
      }
    }

    console.log('[digest-worker] fetching flat feed list', {
      userId,
      date,
      total: msg.feedUrls.length,
      topicsMapped: Object.keys(topicMap).length,
      unknown: unknownFeeds.length,
    });

    const [topicArticles, unknownArticles] = await Promise.all([
      Object.keys(topicMap).length > 0
        ? fetchArticlesByTopic(topicMap)
        : Promise.resolve([]),
      unknownFeeds.length > 0
        ? fetchRecentArticles(unknownFeeds)
        : Promise.resolve([]),
    ]);
    rawArticles = [...topicArticles, ...unknownArticles];
  } else if (msg.topicFeedUrls && Object.keys(msg.topicFeedUrls).length > 0) {
    console.log('[digest-worker] fetching topic feeds', {
      userId,
      date,
      topicCount: Object.keys(msg.topicFeedUrls).length,
    });
    rawArticles = await fetchArticlesByTopic(msg.topicFeedUrls);
  } else {
    console.log('[digest-worker] fetching default feeds', { userId, date });
    rawArticles = await fetchRecentArticles(DEFAULT_DIGEST_FEEDS);
  }
  console.log('[digest-worker] fetched articles', {
    userId,
    date,
    count: rawArticles.length,
  });

  // 1b. Enrich with popularity signals (HN Algolia + RSS comment counts)
  await writeDigestStatus(userId, date, { status: 'enriching_popularity' });
  const enrichedArticles = await enrichWithPopularity(rawArticles);
  console.log('[digest-worker] enriched articles', {
    userId,
    date,
    count: enrichedArticles.length,
  });

  // 2. Rank + deduplicate
  await writeDigestStatus(userId, date, { status: 'ranking' });
  const topN = msg.topN ?? DEFAULT_TOP_N;
  let rankingInput = enrichedArticles;

  try {
    const seen = await loadRecentServedStories(userId, date, LOOKBACK_DAYS);
    const { withoutExact, withoutExactOrFuzzy, exactFilteredCount, fuzzyFilteredCount } =
      filterRecentlyServedArticles(
        enrichedArticles,
        seen,
        FUZZY_TITLE_SIMILARITY_THRESHOLD,
      );
    const minRequiredCandidates = Math.min(topN, 3);
    let fallbackMode: 'strict' | 'exact_only' | 'none' = 'strict';
    rankingInput = withoutExactOrFuzzy;

    if (rankingInput.length < minRequiredCandidates) {
      rankingInput = withoutExact;
      fallbackMode = 'exact_only';
    }
    if (rankingInput.length < minRequiredCandidates) {
      rankingInput = enrichedArticles;
      fallbackMode = 'none';
    }

    console.log('[digest-worker] cross-day dedup result', {
      userId,
      date,
      candidatesBefore: enrichedArticles.length,
      candidatesAfter: rankingInput.length,
      seenCount: seen.length,
      exactFilteredCount,
      fuzzyFilteredCount,
      fallbackMode,
    });
  } catch (err) {
    rankingInput = enrichedArticles;
    console.warn('[digest-worker] cross-day dedup failed; continuing without filter', {
      userId,
      date,
      err: String(err),
    });
  }

  let ranked = deduplicateAndRank(rankingInput, topN, msg.priorityTopicId);

  // 2b. Filter ad-like/deal pages before summarization/scripting/TTS
  // (e.g. promo-code / coupon / shopping deal pages).
  const minRequiredCandidates = Math.min(topN, 3);
  {
    const { kept, removed } = filterAdLikeStories(ranked, { strictness: 'normal' });
    if (removed.length > 0) {
      if (kept.length >= minRequiredCandidates) {
        ranked = kept;
        console.log('[digest-worker] filtered ad-like stories', {
          userId,
          date,
          removedCount: removed.length,
          keptCount: kept.length,
          removedTitles: removed.slice(0, 5).map((r) => r.article.title),
        });
      } else {
        // Avoid empty/too-small digests: fall back to strong-only removal, else keep original.
        const relaxed = filterAdLikeStories(ranked, { strictness: 'strong_only' });
        if (relaxed.kept.length >= minRequiredCandidates && relaxed.removed.length > 0) {
          ranked = relaxed.kept;
          console.log('[digest-worker] filtered ad-like stories (relaxed)', {
            userId,
            date,
            removedCount: relaxed.removed.length,
            keptCount: relaxed.kept.length,
            removedTitles: relaxed.removed.slice(0, 5).map((r) => r.article.title),
          });
        } else {
          console.warn('[digest-worker] ad-like filter would shrink digest too far; skipping filter', {
            userId,
            date,
            topN,
            candidateCount: ranked.length,
            wouldKeep: kept.length,
            removedCount: removed.length,
          });
        }
      }
    }
  }

  // Detect which topic (if any) had candidates but didn't make it into the final set.
  // The first such topic becomes priorityTopicId for tomorrow's digest.
  const candidateTopics = new Set(rankingInput.map((a) => a.topicId).filter(Boolean) as string[]);
  const rankedTopics = new Set(ranked.map((a) => a.topicId).filter(Boolean) as string[]);
  const skippedTopicId = [...candidateTopics].find((t) => !rankedTopics.has(t));

  console.log('[digest-worker] ranked articles', {
    userId,
    date,
    count: ranked.length,
    skippedTopicId: skippedTopicId ?? null,
  });

  if (ranked.length === 0) {
    throw new Error('No articles available for digest');
  }

  // 3. Summarize each article in parallel with bounded concurrency.
  // Order is preserved because generateDigestScript consumes summaries in ranked order.
  await writeDigestStatus(userId, date, { status: 'summarizing' });

  const summaries = await mapOrderedConcurrent(
    ranked,
    SUMMARY_CONCURRENCY,
    async (article) => {
      let fullText = '';
      try {
        const extracted = await extractArticle(article.link);
        fullText = extracted.text ?? '';
      } catch {
        fullText = article.description;
      }
      const summary = await summarizeArticle(article, fullText);
      console.log('[digest-worker] summarized', { title: article.title });
      return summary;
    },
  );

  // 4. Generate script
  await writeDigestStatus(userId, date, { status: 'scripting' });
  const { segments, stories: scriptStories, segmentLabels } =
    await generateDigestScript(summaries, statusDate);
  console.log('[digest-worker] script generated', {
    userId,
    date,
    segments: segments.length,
    stories: scriptStories.length,
  });

  // 5. Generate audio — dual narrator voices that alternate by segment
  await writeDigestStatus(userId, date, { status: 'generating_audio' });
  const primaryVoice = msg.voice ?? 'fable';
  const secondaryVoice = getPairedVoice(primaryVoice);
  const { buffer: audioBuffer, chunkDurationSeconds, totalDurationSeconds } =
    await generateAlternatingAudio(segments, primaryVoice, secondaryVoice);
  const durationSeconds = Math.round(totalDurationSeconds);

  const stories = mergeStoryAudioBounds(
    scriptStories,
    segmentLabels,
    chunkDurationSeconds,
  );
  console.log('[digest-worker] audio generated', {
    userId,
    date,
    durationSeconds,
  });

  // 6. Upload and finalize
  await uploadDigestAudio(userId, date, audioBuffer);

  const digestDate = new Date(date + 'T12:00:00Z');
  const title = `Daily Briefing – ${digestDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })}`;

  await writeDigestStatus(userId, date, {
    status: 'done',
    title,
    durationSeconds,
    digestId: `${userId}/${date}`,
    stories,
    ...(skippedTopicId ? { skippedTopicId } : {}),
  });

  try {
    await persistServedStories(userId, date, ranked);
    console.log('[digest-worker] persisted served-story history', {
      userId,
      date,
      count: ranked.length,
    });
  } catch (err) {
    console.warn('[digest-worker] failed to persist served-story history', {
      userId,
      date,
      err: String(err),
    });
  }

  console.log('[digest-worker] digest complete', {
    userId,
    date,
    title,
    durationSeconds,
  });

  try {
    await publishDigestReadyPush(userId, date, title);
    console.log('[digest-worker] push published', { userId, date });
  } catch (err) {
    // Best-effort: digest completion must not fail when push delivery fails.
    console.warn('[digest-worker] push publish failed', {
      userId,
      date,
      err: String(err),
    });
  }
}

export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    let msg: DigestMessage;
    try {
      msg = JSON.parse(record.body) as DigestMessage;
    } catch {
      console.error('[digest-worker] invalid message body', {
        body: record.body,
      });
      continue;
    }

    const { userId, date } = msg;
    console.log('[digest-worker] processing digest new version', {
      userId,
      date,
    });

    try {
      await processDigest(msg);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[digest-worker] pipeline failed', {
        userId,
        date,
        err: errMsg,
      });
      try {
        await writeDigestStatus(userId, date, {
          status: 'error',
          error: errMsg,
        });
      } catch (writeErr) {
        console.error('[digest-worker] failed to write error status', {
          writeErr: String(writeErr),
        });
      }
    }
  }
};
