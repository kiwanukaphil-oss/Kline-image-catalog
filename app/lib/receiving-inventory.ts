'use client';
import { useCallback, useEffect, useState } from 'react';
import { requestPos, type CatalogItem } from './catalog-api';

/** Read matching pages with bounded concurrency; reject shifting results instead of selecting a partial scope. */
export async function readReceivingScope(query: string, branch: string, signal: AbortSignal) {
  type Page = { items: CatalogItem[]; total: number; limit: number };
  const readPage = (page: number) =>
    requestPos<Page>(`/catalog-workspace/items?${query}&page=${page}`, branch, { signal });
  const first = await readPage(1);
  const expectedTotal = Number(first.total);
  if (!Number.isFinite(expectedTotal) || expectedTotal < 0 || first.limit <= 0)
    throw new Error('Unable to read the complete merchandise selection.');
  const pages: Page[] = [first];
  const pageCount = Math.ceil(expectedTotal / first.limit);
  let nextPage = 2;
  async function readPageWorker() {
    // Preserve page ordering even when responses finish in a different order.
    while (nextPage <= pageCount && !signal.aborted) {
      const page = nextPage++;
      const result = await readPage(page);
      if (Number(result.total) !== expectedTotal || result.limit !== first.limit)
        throw new Error('Merchandise changed while loading. Reload to try again.');
      pages[page - 1] = result;
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, Math.max(0, pageCount - 1)) }, readPageWorker));
  const items = new Map(pages.flatMap((page) => page.items.map((item) => [item.id, item] as const)));
  if (items.size !== expectedTotal)
    throw new Error('Merchandise changed while loading. Reload to try again.');
  return [...items.values()];
}

/** Cancel obsolete branch/filter reads and never offer bulk actions over a partial result. */
export function useReceivingScope(query: string, branch: string) {
  const [state, setState] = useState<{ key: string; items: CatalogItem[]; error: string; loading: boolean }>({
    key: '',
    items: [],
    error: '',
    loading: true,
  });
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  const key = `${branch}:${query}:${version}`;
  useEffect(() => {
    const controller = new AbortController();
    setState({ key, items: [], error: '', loading: true });
    readReceivingScope(query, branch, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setState({ key, items, error: '', loading: false });
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setState({ key, items: [], error: cause.message, loading: false });
      });
    return () => controller.abort();
  }, [query, branch, key]);
  return {
    items: state.key === key ? state.items : [],
    error: state.key === key ? state.error : '',
    loading: state.key !== key || state.loading,
    refresh,
  };
}
