import type { ExtendedRssItem, RssFeed } from './rssService';

/**
 * Module-level store for the article navigation list.
 * Set immediately before navigating to ArticleDetail so the screen always
 * reads a fresh, complete list — avoiding stale closure / large-params issues
 * with React Navigation.
 */
let _items: ExtendedRssItem[] = [];
let _feed: RssFeed | null = null;

export function setArticleNavList(items: ExtendedRssItem[], feed: RssFeed) {
  _items = items;
  _feed  = feed;
}

export function getArticleNavList(): { items: ExtendedRssItem[]; feed: RssFeed | null } {
  return { items: _items, feed: _feed };
}
