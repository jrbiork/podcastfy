import { createHash } from 'crypto';
import {
  type AttributeValue,
  BatchWriteItemCommand,
  DynamoDBClient,
  QueryCommand,
  type WriteRequest,
} from '@aws-sdk/client-dynamodb';
import type { FeedArticle } from './feedFetcher';

const dynamo = new DynamoDBClient({});
const DIGEST_SERVED_TABLE = process.env.DIGEST_SERVED_TABLE;

const TRACKING_PARAM_PREFIXES = ['utm_'];
const TRACKING_PARAM_KEYS = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
]);

const TITLE_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'was',
  'were',
  'with',
  'breaking',
  'live',
  'update',
]);

export interface ServedStoryRecord {
  fingerprint: string;
  titleFingerprint: string;
  linkFingerprint: string;
  normalizedTitle: string;
  titleTokens: string[];
}

export interface FilterResult {
  withoutExact: FeedArticle[];
  withoutExactOrFuzzy: FeedArticle[];
  exactFilteredCount: number;
  fuzzyFilteredCount: number;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeTitle(title: string): string {
  return normalizeWhitespace(
    title
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' '),
  );
}

function titleTokensFromNormalized(normalizedTitle: string): string[] {
  return normalizedTitle
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !TITLE_STOP_WORDS.has(token));
}

function canonicalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    u.protocol = 'https:';
    const filteredEntries = [...u.searchParams.entries()].filter(([key]) => {
      if (TRACKING_PARAM_KEYS.has(key)) return false;
      return !TRACKING_PARAM_PREFIXES.some((prefix) => key.startsWith(prefix));
    });
    u.search = '';
    for (const [key, value] of filteredEntries.sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      u.searchParams.append(key, value);
    }
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.toString();
  } catch {
    return normalizeWhitespace(rawUrl.toLowerCase());
  }
}

export function createServedStoryRecord(article: FeedArticle): ServedStoryRecord {
  const normalizedTitle = normalizeTitle(article.title);
  const tokens = titleTokensFromNormalized(normalizedTitle);
  const sortedTokens = [...new Set(tokens)].sort();
  const canonicalUrl = canonicalizeUrl(article.link);

  const titleFingerprint = hash(normalizedTitle);
  const linkFingerprint = hash(canonicalUrl);
  const fingerprint = hash(`${titleFingerprint}:${linkFingerprint}`);

  return {
    fingerprint,
    titleFingerprint,
    linkFingerprint,
    normalizedTitle,
    titleTokens: sortedTokens,
  };
}

function getDayString(baseDate: Date, daysDelta: number): string {
  const shifted = new Date(baseDate);
  shifted.setUTCDate(shifted.getUTCDate() + daysDelta);
  return shifted.toISOString().slice(0, 10);
}

function jaccardSimilarity(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 && tokensB.length === 0) return 1;
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const a = new Set(tokensA);
  const b = new Set(tokensB);
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export async function loadRecentServedStories(
  userId: string,
  date: string,
  lookbackDays = 3,
): Promise<ServedStoryRecord[]> {
  if (!DIGEST_SERVED_TABLE) return [];

  const dateObj = new Date(`${date}T00:00:00Z`);
  const startDate = getDayString(dateObj, -lookbackDays);
  const endDate = getDayString(dateObj, 0);
  const rangeStart = `${startDate}#`;
  const rangeEnd = `${endDate}#~`;

  const records: ServedStoryRecord[] = [];
  let lastEvaluatedKey: Record<string, AttributeValue> | undefined;

  do {
    const res = await dynamo.send(
      new QueryCommand({
        TableName: DIGEST_SERVED_TABLE,
        KeyConditionExpression:
          'userId = :userId and servedKey BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':userId': { S: userId },
          ':start': { S: rangeStart },
          ':end': { S: rangeEnd },
        },
        ProjectionExpression:
          'fingerprint, titleFingerprint, linkFingerprint, normalizedTitle, titleTokens',
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    for (const item of res.Items ?? []) {
      const titleTokens = item.titleTokens?.SS ?? [];
      records.push({
        fingerprint: item.fingerprint?.S ?? '',
        titleFingerprint: item.titleFingerprint?.S ?? '',
        linkFingerprint: item.linkFingerprint?.S ?? '',
        normalizedTitle: item.normalizedTitle?.S ?? '',
        titleTokens,
      });
    }

    lastEvaluatedKey = res.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return records.filter(
    (r) => Boolean(r.fingerprint && r.titleFingerprint && r.linkFingerprint),
  );
}

export function filterRecentlyServedArticles(
  articles: FeedArticle[],
  seenRecords: ServedStoryRecord[],
  fuzzyThreshold = 0.75,
): FilterResult {
  const seenFingerprint = new Set(seenRecords.map((r) => r.fingerprint));
  const seenTitleFingerprint = new Set(seenRecords.map((r) => r.titleFingerprint));
  const seenLinkFingerprint = new Set(seenRecords.map((r) => r.linkFingerprint));

  const withoutExact: FeedArticle[] = [];
  const withoutExactOrFuzzy: FeedArticle[] = [];
  let exactFilteredCount = 0;
  let fuzzyFilteredCount = 0;

  for (const article of articles) {
    const candidate = createServedStoryRecord(article);
    const exactMatch =
      seenFingerprint.has(candidate.fingerprint) ||
      seenTitleFingerprint.has(candidate.titleFingerprint) ||
      seenLinkFingerprint.has(candidate.linkFingerprint);

    if (exactMatch) {
      exactFilteredCount++;
      continue;
    }

    withoutExact.push(article);

    const fuzzyMatch = seenRecords.some(
      (seen) =>
        jaccardSimilarity(candidate.titleTokens, seen.titleTokens) >=
        fuzzyThreshold,
    );
    if (fuzzyMatch) {
      fuzzyFilteredCount++;
      continue;
    }

    withoutExactOrFuzzy.push(article);
  }

  return {
    withoutExact,
    withoutExactOrFuzzy,
    exactFilteredCount,
    fuzzyFilteredCount,
  };
}

export async function persistServedStories(
  userId: string,
  date: string,
  selectedArticles: FeedArticle[],
  ttlDays = 4,
): Promise<void> {
  if (!DIGEST_SERVED_TABLE || selectedArticles.length === 0) return;

  const nowEpochSec = Math.floor(Date.now() / 1000);
  const expiresAt = nowEpochSec + ttlDays * 24 * 60 * 60;
  const writeRequests: WriteRequest[] = selectedArticles.map((article) => {
    const record = createServedStoryRecord(article);
    return {
      PutRequest: {
        Item: {
          userId: { S: userId },
          servedKey: { S: `${date}#${record.fingerprint}` },
          servedDate: { S: date },
          fingerprint: { S: record.fingerprint },
          titleFingerprint: { S: record.titleFingerprint },
          linkFingerprint: { S: record.linkFingerprint },
          normalizedTitle: { S: record.normalizedTitle },
          ...(record.titleTokens.length > 0 ? { titleTokens: { SS: record.titleTokens } } : {}),
          expiresAt: { N: String(expiresAt) },
        },
      },
    };
  });

  for (let i = 0; i < writeRequests.length; i += 25) {
    const chunk = writeRequests.slice(i, i + 25);
    await dynamo.send(
      new BatchWriteItemCommand({
        RequestItems: {
          [DIGEST_SERVED_TABLE]: chunk,
        },
      }),
    );
  }
}
