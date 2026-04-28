import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
};

const CF_BODY_SIGNALS = [
  'Just a moment',
  'Checking your browser',
  'Enable JavaScript and cookies',
  'DDoS protection by Cloudflare',
  'cf-browser-verification',
  'Attention Required! | Cloudflare',
];

export class ScraperError extends Error {
  code: string;
  recoverable: boolean;
  constructor(code: string, recoverable = false) {
    super(code);
    this.code = code;
    this.recoverable = recoverable;
  }
}

export interface ArticleData {
  title: string;
  text: string;
  thumbnailUrl: string | null;
}

export async function extractArticle(url: string): Promise<ArticleData> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(12_000),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('timed out') || msg.includes('timeout')) {
      throw new ScraperError('scrape_timeout');
    }
    throw new ScraperError('scrape_failed');
  }

  const body = await res.text();

  // Cloudflare detection
  const hasCfRay = !!res.headers.get('cf-ray');
  const isBlockedStatus = res.status === 403 || res.status === 503;
  const hasBodySignal = CF_BODY_SIGNALS.some((s) => body.includes(s));

  if ((hasCfRay && isBlockedStatus) || hasBodySignal) {
    throw new ScraperError('cloudflare_blocked', true);
  }

  if (!res.ok) throw new ScraperError('scrape_failed');

  const dom = new JSDOM(body, { url });
  const article = new Readability(dom.window.document).parse();

  if (!article || article.textContent.trim().length < 400) {
    throw new ScraperError('article_too_short');
  }

  const ogImage =
    dom.window.document
      .querySelector('meta[property="og:image"]')
      ?.getAttribute('content') ?? null;

  return {
    title: article.title || 'Untitled',
    text: cleanText(article.textContent),
    thumbnailUrl: ogImage,
  };
}

function cleanText(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 12_000);
}
