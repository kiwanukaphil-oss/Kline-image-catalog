import type { PriceItem } from './pricing';

type WorkspacePage = { items: PriceItem[]; total: number; limit: number };

/** Load complete pricing choices in order, with at most three reads in flight and no partial result on failure. */
export async function loadPricingWorkspace(
  scope: string[],
  readPage: (body: { item_ids: string[] } | { page: number }) => Promise<WorkspacePage>,
  isActive: () => boolean,
): Promise<PriceItem[]> {
  const first = await readPage(scope.length ? { item_ids: scope } : { page: 1 });
  if (!isActive()) return [];
  if (scope.length || first.items.length >= first.total) return first.items;
  if (!Number.isFinite(first.limit) || first.limit <= 0)
    throw new Error('Pricing pages could not be loaded. Try again.');
  const all = [...first.items];
  const lastPage = Math.ceil(first.total / first.limit);
  for (let start = 2; start <= lastPage && isActive(); start += 3) {
    const pages = Array.from({ length: Math.min(3, lastPage - start + 1) }, (_, index) => start + index);
    const results = await Promise.all(pages.map((page) => readPage({ page })));
    if (!isActive()) return [];
    all.push(...results.flatMap((result) => result.items));
  }
  return all;
}
