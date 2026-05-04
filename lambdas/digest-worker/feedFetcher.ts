const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

export interface FeedArticle {
  feedId: string;
  feedName: string;
  title: string;
  link: string;
  description: string;
  pubDate: Date;
  contentLength: number;
  topicId?: string;
  rssCommentCount?: number;
  hnScore?: number;
  hnComments?: number;
  popularityScore?: number;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripHtml(str: string): string {
  return decodeHtmlEntities(str.replace(/<[^>]+>/g, '').trim());
}

function stripCdata(str: string): string {
  return str.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

function extractTag(xml: string, tag: string): string {
  const match =
    xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')) ??
    xml.match(new RegExp(`<${tag}[^>]*/>`));
  if (!match) return '';
  return stripCdata(match[1] ?? '');
}

function extractLink(xml: string): string {
  // Atom: <link href="..."/>
  const atomHref = xml.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  if (atomHref) return atomHref[1];
  // RSS: <link>...</link>
  return extractTag(xml, 'link');
}

function parsePubDate(xml: string): Date | null {
  for (const tag of ['pubDate', 'published', 'updated', 'dc:date']) {
    const raw = extractTag(xml, tag);
    if (raw) {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

function extractRssCommentCount(block: string): number | undefined {
  const slash = extractTag(block, 'slash:comments');
  if (slash) { const n = parseInt(slash, 10); if (!isNaN(n) && n >= 0) return n; }
  const plain = extractTag(block, 'comments');
  if (plain) { const n = parseInt(plain, 10); if (!isNaN(n) && n >= 0) return n; }
  return undefined;
}

function parseItems(xml: string, feedId: string, feedName: string, windowMs: number): FeedArticle[] {
  const now = Date.now();
  const articles: FeedArticle[] = [];

  // Match RSS <item> or Atom <entry> blocks
  const blockRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(xml)) !== null) {
    const block = match[1];

    const title = stripHtml(extractTag(block, 'title'));
    if (!title) continue;

    const link = extractLink(block);
    if (!link) continue;

    const description = extractTag(block, 'description') || extractTag(block, 'summary') || '';
    const rawDescription = stripHtml(description);
    const contentLength = rawDescription.length;

    const pubDate = parsePubDate(block);
    // If pubDate is unparseable, include article (generous default)
    const age = pubDate ? now - pubDate.getTime() : 0;
    if (pubDate && age > windowMs) continue;

    articles.push({
      feedId,
      feedName,
      title,
      link,
      description: rawDescription,
      pubDate: pubDate ?? new Date(),
      contentLength,
      rssCommentCount: extractRssCommentCount(block),
    });
  }

  return articles;
}

/**
 * Fetches articles from feeds organized by topic, tagging each article with its topicId.
 * Used when the digest request includes topicFeedUrls for category-diverse ranking.
 */
export async function fetchArticlesByTopic(
  topicFeedMap: Record<string, string[]>,
  windowHours = 24
): Promise<FeedArticle[]> {
  const windowMs = windowHours * 3_600_000;
  const results: FeedArticle[] = [];

  for (const [topicId, urls] of Object.entries(topicFeedMap)) {
    for (const url of urls) {
      try {
        const response = await fetch(url, {
          headers: BROWSER_HEADERS,
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) {
          console.warn('[feedFetcher] non-ok response', { topicId, url, status: response.status });
          continue;
        }
        const xml = await response.text();
        const feedId = new URL(url).hostname.replace(/^www\./, '');
        const items = parseItems(xml, feedId, feedId, windowMs).map((a) => ({ ...a, topicId }));
        items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
        results.push(...items.slice(0, 3));
        console.log('[feedFetcher] fetched topic feed', { topicId, feedId, itemCount: items.length });
      } catch (err) {
        console.warn('[feedFetcher] error fetching topic feed', { topicId, url, err: String(err) });
      }
    }
  }

  return results;
}

export async function fetchRecentArticles(
  feeds: Array<{ id: string; name: string; url: string }>,
  windowHours = 24
): Promise<FeedArticle[]> {
  const windowMs = windowHours * 3_600_000;
  const results: FeedArticle[] = [];

  for (const feed of feeds) {
    try {
      const response = await fetch(feed.url, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(8_000),
      });

      if (!response.ok) {
        console.warn('[feedFetcher] non-ok response', { feedId: feed.id, status: response.status });
        continue;
      }

      const xml = await response.text();
      const items = parseItems(xml, feed.id, feed.name, windowMs);

      // Sort descending by date, cap at 3 per feed for source diversity
      items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
      results.push(...items.slice(0, 3));

      console.log('[feedFetcher] fetched feed', { feedId: feed.id, itemCount: items.length });
    } catch (err) {
      console.warn('[feedFetcher] error fetching feed', { feedId: feed.id, err: String(err) });
    }
  }

  return results;
}
