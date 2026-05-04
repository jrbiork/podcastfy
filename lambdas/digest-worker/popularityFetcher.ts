import type { FeedArticle } from './feedFetcher';

const HN_TOPICS = new Set([
  'technology', 'ai-tech', 'startups', 'science',
  'crypto-web3', 'business-finance', 'news', 'politics',
]);

const HN_TIMEOUT_MS = 2500;
const HN_POINTS_CAP = 1000;
const RSS_COMMENTS_CAP = 200;

interface HnHit {
  title: string;
  url: string | null;
  points: number | null;
  num_comments: number | null;
}

interface HnSearchResponse {
  hits: HnHit[];
}

function normalizeHnPoints(pts: number): number {
  return pts <= 0 ? 0 : Math.min(1, Math.log1p(pts) / Math.log1p(HN_POINTS_CAP));
}

function normalizeRssComments(n: number): number {
  return n <= 0 ? 0 : Math.min(1, Math.log1p(n) / Math.log1p(RSS_COMMENTS_CAP));
}

function findBestHit(hits: HnHit[], articleUrl: string): HnHit | null {
  if (hits.length === 0) return null;

  const exact = hits.find(h => h.url === articleUrl);
  if (exact) return exact;

  try {
    const target = new URL(articleUrl);
    const normalized = `${target.hostname}${target.pathname}`;
    const pathMatch = hits.find(h => {
      if (!h.url) return false;
      try {
        const u = new URL(h.url);
        return `${u.hostname}${u.pathname}` === normalized;
      } catch { return false; }
    });
    if (pathMatch) return pathMatch;
  } catch { /* invalid URL */ }

  // Title-based fallback: only trust if score is meaningful
  if ((hits[0].points ?? 0) >= 10) return hits[0];
  return null;
}

async function fetchHnData(article: FeedArticle): Promise<{ hnScore: number; hnComments: number } | null> {
  const query = encodeURIComponent(article.link);
  const url = `https://hn.algolia.com/api/v1/search?query=${query}&tags=story&hitsPerPage=5`;

  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(HN_TIMEOUT_MS),
      headers: { 'User-Agent': 'Podcastify-Digest/1.0' },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as HnSearchResponse;
    const hit = findBestHit(data.hits, article.link);
    if (!hit) return null;
    return { hnScore: hit.points ?? 0, hnComments: hit.num_comments ?? 0 };
  } catch {
    return null;
  }
}

export async function enrichWithPopularity(articles: FeedArticle[]): Promise<FeedArticle[]> {
  const start = Date.now();

  const eligibleIdxs: number[] = [];
  const skippedIdxs: number[] = [];

  articles.forEach((a, i) => {
    if (a.topicId && HN_TOPICS.has(a.topicId)) {
      eligibleIdxs.push(i);
    } else {
      skippedIdxs.push(i);
    }
  });

  const hnResults = await Promise.allSettled(
    eligibleIdxs.map(i => fetchHnData(articles[i]))
  );

  const output = [...articles];

  let hnMatched = 0;
  eligibleIdxs.forEach((origIdx, resultIdx) => {
    const result = hnResults[resultIdx];
    const hnData = result.status === 'fulfilled' ? result.value : null;
    if (hnData) hnMatched++;
    const hnScore = hnData?.hnScore ?? 0;
    const hnComments = hnData?.hnComments ?? 0;
    const rssCommentCount = articles[origIdx].rssCommentCount ?? 0;
    const popularityScore = Math.max(normalizeHnPoints(hnScore), normalizeRssComments(rssCommentCount));
    output[origIdx] = {
      ...articles[origIdx],
      ...(hnData ? { hnScore, hnComments } : {}),
      popularityScore,
    };
  });

  skippedIdxs.forEach(origIdx => {
    const rssCommentCount = articles[origIdx].rssCommentCount ?? 0;
    output[origIdx] = {
      ...articles[origIdx],
      popularityScore: normalizeRssComments(rssCommentCount),
    };
  });

  const rssCommentCount = articles.filter(a => (a.rssCommentCount ?? 0) > 0).length;
  console.log('[popularityFetcher] enrichment complete', {
    total: articles.length,
    hnQueried: eligibleIdxs.length,
    hnMatched,
    rssComments: rssCommentCount,
    elapsedMs: Date.now() - start,
  });

  return output;
}
