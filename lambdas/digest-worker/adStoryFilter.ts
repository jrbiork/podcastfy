import type { FeedArticle } from './feedFetcher';

export type AdFilterReason =
  | 'title_keyword'
  | 'url_path_keyword'
  | 'description_promo_code'
  | 'description_discount'
  | 'description_shopping_cta'
  | 'allowlisted_adtech_news';

const TITLE_KEYWORDS = [
  'promo code',
  'coupon',
  'coupons',
  'discount code',
  'discount codes',
  'deal',
  'deals',
  'sale',
  'sales',
  'clearance',
  'price drop',
  'lowest price',
  '% off',
];

const URL_PATH_KEYWORDS = [
  '/promo-code',
  '/promo-codes',
  '/coupon',
  '/coupons',
  '/deal',
  '/deals',
  '/sale',
  '/sales',
  '/shopping',
  '/buying-guide',
];

// Keep legitimate business/news coverage about advertising strategy/industry.
const AD_TECH_NEWS_ALLOWLIST = ['ad tech', 'advertising', 'ad play'];

function norm(s: string): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function safeUrl(link: string): URL | null {
  try {
    return new URL(link);
  } catch {
    return null;
  }
}

function hasTitleKeyword(title: string): boolean {
  const t = norm(title);
  return TITLE_KEYWORDS.some((k) => t.includes(k));
}

function hasUrlPathKeyword(link: string): boolean {
  const u = safeUrl(link);
  const hay = norm(u ? `${u.hostname}${u.pathname}` : link);
  return URL_PATH_KEYWORDS.some((k) => hay.includes(k));
}

function discountSignals(text: string): { hasPromoCode: boolean; hasDiscount: boolean; hasCta: boolean } {
  const t = norm(text);
  const hasPromoCode =
    /\bpromo\s*code\b/.test(t) ||
    /\buse\s+code\b/.test(t) ||
    /\bcode\s+[a-z0-9]{4,}\b/i.test(text); // keep original casing for code detection

  const hasDiscount =
    /\b\d{1,3}%\s*off\b/.test(t) ||
    /\b(up to)\s+\d{1,3}%\b/.test(t) ||
    /\b(save|saving)\s+\$?\d+\b/.test(t) ||
    /\b(extra)\s+\d{1,3}%\b/.test(t);

  const hasCta = /\b(sign up|shop now|buy now|limited time|offer)\b/.test(t);

  return { hasPromoCode, hasDiscount, hasCta };
}

function looksLikeAdTechNews(title: string): boolean {
  const t = norm(title);
  return AD_TECH_NEWS_ALLOWLIST.some((k) => t.includes(k));
}

export function isAdLikeStory(article: FeedArticle): { isAd: boolean; reasons: AdFilterReason[] } {
  const reasons: AdFilterReason[] = [];

  const titleHit = hasTitleKeyword(article.title);
  const urlHit = hasUrlPathKeyword(article.link);
  if (titleHit) reasons.push('title_keyword');
  if (urlHit) reasons.push('url_path_keyword');

  const { hasPromoCode, hasDiscount, hasCta } = discountSignals(
    `${article.description ?? ''} ${article.title ?? ''}`,
  );
  if (hasPromoCode) reasons.push('description_promo_code');
  if (hasDiscount) reasons.push('description_discount');
  if (hasCta) reasons.push('description_shopping_cta');

  if (looksLikeAdTechNews(article.title) && !titleHit && !urlHit) {
    return { isAd: false, reasons: ['allowlisted_adtech_news'] };
  }

  // Conservative rule: (title OR url) plus at least one supporting promo/discount/CTA cue.
  const supporting = [hasPromoCode, hasDiscount, hasCta].filter(Boolean).length;
  const isAd = (titleHit || urlHit) && supporting >= 1;

  return { isAd, reasons };
}

export function filterAdLikeStories(
  articles: FeedArticle[],
  opts?: { strictness?: 'normal' | 'strong_only' },
): { kept: FeedArticle[]; removed: Array<{ article: FeedArticle; reasons: AdFilterReason[] }> } {
  const strictness = opts?.strictness ?? 'normal';
  const kept: FeedArticle[] = [];
  const removed: Array<{ article: FeedArticle; reasons: AdFilterReason[] }> = [];

  for (const a of articles) {
    const decision = isAdLikeStory(a);
    if (!decision.isAd) {
      kept.push(a);
      continue;
    }

    if (strictness === 'strong_only') {
      const strong =
        decision.reasons.includes('title_keyword') || decision.reasons.includes('url_path_keyword');
      if (!strong) {
        kept.push(a);
        continue;
      }
    }

    removed.push({ article: a, reasons: decision.reasons });
  }

  return { kept, removed };
}

