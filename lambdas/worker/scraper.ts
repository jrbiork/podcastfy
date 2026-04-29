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

// Signals that indicate the page is technically blocking automated access
// (bot challenges, CAPTCHAs, WAFs) — NOT content paywalls.
// If the page loads with actual article content, let it through regardless.
const BOT_PROTECTION_SIGNALS = [
  // Cloudflare
  'Just a moment',
  'Checking your browser',
  'Enable JavaScript and cookies',
  'DDoS protection by Cloudflare',
  'cf-browser-verification',
  'Attention Required! | Cloudflare',
  'challenges.cloudflare.com',
  // Generic CAPTCHA / human verification
  'Please verify you are human',
  'Please complete the security check',
  'Prove you are human',
  'Are you a robot',
  'Robot Check',
  'Human Verification',
  'Verifying you are human',
  // reCAPTCHA
  'www.google.com/recaptcha',
  'g-recaptcha',
  // hCaptcha
  'hcaptcha.com',
  'h-captcha',
  // Imperva / Incapsula
  'incapsula incident',
  '_imp_apg_r_',
  'site is protected by Imperva',
  // PerimeterX
  'px-captcha',
  'PerimeterX',
  '_pxCaptcha',
  // DataDome
  'datadome.co',
  'Please enable cookies',
  // Akamai Bot Manager
  'akamai.com/bot-manager',
  // Generic WAF / access denied pages (short pages with no article content)
  '<title>Access Denied</title>',
  '<title>403 Forbidden</title>',
  '<title>blocked</title>',
];

function isBotProtected(body: string, status: number): boolean {
  if (status === 429) return true; // Too Many Requests — rate-limited by bot protection
  const lower = body.toLowerCase();
  return BOT_PROTECTION_SIGNALS.some((s) => lower.includes(s.toLowerCase()));
}

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

  // Detect bot/scraper protection challenges before anything else
  const hasCfRay = !!res.headers.get('cf-ray');
  const isBlockedStatus = res.status === 403 || res.status === 503;

  if ((hasCfRay && isBlockedStatus) || isBotProtected(body, res.status)) {
    throw new ScraperError('scrape_protected', true);
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
