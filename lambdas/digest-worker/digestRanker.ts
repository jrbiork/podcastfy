import type { FeedArticle } from './feedFetcher';

function tokenize(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function deduplicateAndRank(
  articles: FeedArticle[],
  topN = 8,
  priorityTopicId?: string,
): FeedArticle[] {
  // Deduplicate: for each pair with Jaccard title similarity > 0.7, keep the one
  // with greater contentLength
  const tokenSets = articles.map((a) => tokenize(a.title));
  const dropped = new Set<number>();

  for (let i = 0; i < articles.length; i++) {
    if (dropped.has(i)) continue;
    for (let j = i + 1; j < articles.length; j++) {
      if (dropped.has(j)) continue;
      if (jaccard(tokenSets[i], tokenSets[j]) > 0.7) {
        const scoreI = (articles[i].popularityScore ?? 0) * 0.6 + Math.min(articles[i].contentLength / 2000, 1) * 0.4;
        const scoreJ = (articles[j].popularityScore ?? 0) * 0.6 + Math.min(articles[j].contentLength / 2000, 1) * 0.4;
        if (scoreI >= scoreJ) {
          dropped.add(j);
        } else {
          dropped.add(i);
          break;
        }
      }
    }
  }

  const unique = articles.filter((_, i) => !dropped.has(i));

  // Filter low-value
  const filtered = unique.filter((a) => a.contentLength >= 50);

  // Score and sort
  const now = Date.now();
  const windowMs = 24 * 3_600_000;

  const scored = filtered.map((a) => {
    const ageMs = now - a.pubDate.getTime();
    const recencyScore = Math.max(0, Math.min(1, 1 - ageMs / windowMs));
    const contentScore = Math.min(a.contentLength / 2000, 1);
    const popularityScore = a.popularityScore ?? 0;
    const score = recencyScore * 0.45 + contentScore * 0.25 + popularityScore * 0.30;
    return { article: a, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Enforce per-feed cap so no single source dominates the digest
  const feedCounts: Record<string, number> = {};
  const diverse: typeof scored = [];
  for (const item of scored) {
    const count = feedCounts[item.article.feedId] ?? 0;
    if (count < 2) {
      diverse.push(item);
      feedCounts[item.article.feedId] = count + 1;
    }
  }

  // Compute a per-topic ceiling that scales with topN and the number of active topics.
  // e.g. topN=5 with 4 topics → ceil=2; topN=9 with 4 topics → ceil=3; topN=16 with 4 topics → ceil=4
  const activeTopics = new Set(diverse.map((d) => d.article.topicId).filter(Boolean));
  const topicCount = Math.max(activeTopics.size, 1);
  const perTopicCap = Math.max(1, Math.ceil(topN / topicCount));

  const topicCounts: Record<string, number> = {};
  const selected = new Set<number>(); // indices into diverse[]
  const result: FeedArticle[] = [];

  // Pass 1 — floor: take the single best article per topic (guarantees representation).
  // If priorityTopicId is set (yesterday's skipped topic), lock in its best article first
  // so it can never be crowded out again.
  if (priorityTopicId && result.length < topN) {
    const idx = diverse.findIndex((d) => d.article.topicId === priorityTopicId);
    if (idx !== -1) {
      topicCounts[priorityTopicId] = 1;
      selected.add(idx);
      result.push(diverse[idx].article);
    }
  }

  for (let i = 0; i < diverse.length && result.length < topN; i++) {
    const t = diverse[i].article.topicId;
    if (t && !(topicCounts[t] ?? 0)) {
      topicCounts[t] = 1;
      selected.add(i);
      result.push(diverse[i].article);
    }
  }

  // Pass 2 — fill up to perTopicCap per topic, in global score order
  for (let i = 0; i < diverse.length && result.length < topN; i++) {
    if (selected.has(i)) continue;
    const t = diverse[i].article.topicId ?? '';
    const count = topicCounts[t] ?? 0;
    if (count < perTopicCap) {
      topicCounts[t] = count + 1;
      selected.add(i);
      result.push(diverse[i].article);
    }
  }

  // Pass 3 — overflow: if still not full (topics exhausted early), admit any remainder
  for (let i = 0; i < diverse.length && result.length < topN; i++) {
    if (!selected.has(i)) result.push(diverse[i].article);
  }

  // Group by topic so all stories from the same topic are adjacent in the script.
  // Topic order follows first appearance in the ranked result (highest-scoring topic first).
  const topicOrder: string[] = [];
  const byTopic = new Map<string, FeedArticle[]>();
  const noTopic: FeedArticle[] = [];

  for (const article of result) {
    const t = article.topicId ?? '';
    if (!t) {
      noTopic.push(article);
    } else {
      if (!byTopic.has(t)) {
        topicOrder.push(t);
        byTopic.set(t, []);
      }
      byTopic.get(t)!.push(article);
    }
  }

  return [...topicOrder.flatMap(t => byTopic.get(t)!), ...noTopic];
}
