import type { ExtendedRssItem, RssFeed } from './rssService';

/**
 * Module-level store for the article navigation list.
 * Set immediately before navigating to ArticleDetail so the screen always
 * reads a fresh, complete list — avoiding stale closure / large-params issues
 * with React Navigation.
 */
let _items: ExtendedRssItem[] = [];
let _feeds: RssFeed[] = [];

export function setArticleNavList(items: ExtendedRssItem[], feeds: RssFeed | RssFeed[]) {
  _items = items;
  _feeds = Array.isArray(feeds) ? feeds : items.map(() => feeds);
}

export function getArticleNavList(): { items: ExtendedRssItem[]; feeds: RssFeed[] } {
  return { items: _items, feeds: _feeds };
}
