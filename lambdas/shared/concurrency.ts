/**
 * Runs `fn` over `items` with a bounded number of in-flight tasks.
 * Results are returned in the original input order, regardless of completion order.
 *
 * Rejection semantics match `Promise.all`: the first rejection rejects the whole
 * call; in-flight tasks are not cancelled. If you need partial-success behaviour,
 * have `fn` swallow its own errors and return a sentinel value.
 */
export async function mapOrderedConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));

  const results: R[] = new Array(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}
