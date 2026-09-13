import { requestPos, type CatalogItem } from './catalog-api';
import type { CategoryField } from '@/components/receiving';

export type PreparationDetail = {
  item: CatalogItem;
  fields: CategoryField[];
  revision: string;
  blockers: string[];
};
export type PreparationCount = { size: string; quantity: string };
export type PreparationRow = {
  id: string;
  selected: boolean;
  detail?: PreparationDetail;
  name: string;
  brand: string;
  category: string;
  attributes: CatalogItem['attributes'];
  changedAttributes: string[];
  counts: PreparationCount[];
  detailsChanged: boolean;
  countsChanged: boolean;
  resolveFlag: boolean;
  error: string;
  result: string;
};

/** Only a single unambiguous saved label may seed an unconfirmed blank size row. */
export function proposedCounts(detail: PreparationDetail): PreparationCount[] {
  const lines = detail.item.variant_lines;
  const label = String(detail.item.attributes?.size || '').trim();
  const singleSize = /^(?:\d{1,3}(?:\.5)?|(?:[2-9])?X{0,3}[SML]|one size)$/i.test(label);
  const seed = detail.item.stock_distribution_source !== 'human_confirmed' && lines.length <= 1 && singleSize;
  return lines.length
    ? lines.map((line) => ({
        size: String(line.variant_attributes.size || (seed ? label : '')),
        quantity: String(line.quantity),
      }))
    : [{ size: seed ? label : '', quantity: '' }];
}

/** Build editable rows from fresh server snapshots without marking inferred quantities confirmed. */
export function preparationRow(detail: PreparationDetail): PreparationRow {
  return {
    id: detail.item.id,
    selected: !detail.item.is_published && !detail.item.is_cancelled,
    detail,
    name: detail.item.name || '',
    brand: detail.item.brand || '',
    category: detail.item.category_id,
    attributes: { ...detail.item.attributes },
    changedAttributes: [],
    counts: proposedCounts(detail),
    detailsChanged: false,
    countsChanged: false,
    resolveFlag: false,
    error: '',
    result: '',
  };
}

/** Count confirmation is explicit; never distribute one quantity over inferred sizes or accept duplicate rows. */
export function countEntries(row: PreparationRow) {
  if (!row.counts.length) throw new Error('Add at least one size and quantity.');
  const hasSize = row.detail?.fields.some((field) => field.key === 'size');
  const seen = new Set<string>();
  return row.counts.map((count) => {
    const size = count.size.trim();
    const quantity = Number(count.quantity);
    if (!count.quantity.trim() || !Number.isSafeInteger(quantity) || quantity < 1)
      throw new Error('Enter a positive whole quantity for every size.');
    if (hasSize && !size) throw new Error('Enter the size shown on the product label.');
    if (/[,;/\n]|\s[-–]\s/.test(size)) throw new Error('Put each size on its own row.');
    const key = size.toLowerCase();
    if (seen.has(key)) throw new Error('Combine duplicate sizes on one row.');
    seen.add(key);
    return { variant_attributes: hasSize ? { size } : {}, quantity };
  });
}

/** Limit in-flight work and retain an outcome for every lot instead of aborting the batch at its first exception. */
export async function mapPreparation<T, R>(
  items: T[],
  action: (item: T, index: number) => Promise<R>,
  concurrency = 3,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        try {
          results[index] = { status: 'fulfilled', value: await action(items[index], index) };
        } catch (reason) {
          results[index] = { status: 'rejected', reason };
        }
      }
    }),
  );
  return results;
}

export const readPreparation = (id: string, branch: string, signal?: AbortSignal) =>
  requestPos<PreparationDetail>(`/catalog-workspace/items/${id}`, branch, { signal });

type BatchResult = { id: string; detail?: PreparationDetail; error?: string; saved?: boolean };

/** Load chunks rather than one HTTP request per product, retaining the caller's order and every error. */
export async function readPreparationBatch(
  ids: string[],
  branch: string,
  signal?: AbortSignal,
): Promise<PromiseSettledResult<PreparationRow>[]> {
  const results: PromiseSettledResult<PreparationRow>[] = [];
  for (let start = 0; start < ids.length; start += 50) {
    const chunk = ids.slice(start, start + 50);
    try {
      const response = await requestPos<{ results: BatchResult[] }>(
        '/catalog-workspace/preparation/read',
        branch,
        {
          method: 'POST',
          body: JSON.stringify({ item_ids: chunk }),
          signal,
        },
      );
      for (const id of chunk) {
        const result = response.results.find((row) => row.id === id);
        results.push(
          result?.detail
            ? { status: 'fulfilled', value: preparationRow(result.detail) }
            : { status: 'rejected', reason: new Error(result?.error || 'Product response missing.') },
        );
      }
    } catch (reason) {
      results.push(...chunk.map(() => ({ status: 'rejected' as const, reason })));
    }
    if (signal?.aborted) break;
  }
  return results;
}

/** Send bounded batch writes; validation failures remain per-lot and successful rows return fresh revisions. */
export async function savePreparationBatch(
  rows: PreparationRow[],
  branch: string,
  mode: 'details' | 'counts',
): Promise<PromiseSettledResult<PreparationRow>[]> {
  const outcomes: PromiseSettledResult<PreparationRow>[] = [];
  const valid: { index: number; row: PreparationRow; payload: object }[] = [];
  rows.forEach((row, index) => {
    try {
      if (!row.detail) throw new Error('Reload this product first.');
      const payload =
        mode === 'counts'
          ? { entries: countEntries(row) }
          : {
              name: row.name,
              brand: row.brand,
              category_id: row.category,
              attributes: Object.fromEntries(
                row.changedAttributes.map((key) => [key, row.attributes[key] ?? null]),
              ),
              resolve_flag: row.resolveFlag,
            };
      valid.push({ index, row, payload: { ...payload, expected_revision: row.detail.revision } });
    } catch (reason) {
      outcomes[index] = { status: 'rejected', reason };
    }
  });
  for (let start = 0; start < valid.length;) {
    const chunk: typeof valid = [];
    let bytes = 0;
    while (start < valid.length && chunk.length < 20) {
      const entry = valid[start];
      const length = new TextEncoder().encode(JSON.stringify(entry.payload)).length;
      if (chunk.length && bytes + length > 70000) break;
      chunk.push(entry);
      bytes += length;
      start++;
    }
    try {
      const response = await requestPos<{ results: BatchResult[] }>(
        '/catalog-workspace/preparation/save',
        branch,
        {
          method: 'POST',
          body: JSON.stringify({
            mode,
            rows: chunk.map((entry) => ({ id: entry.row.id, payload: entry.payload })),
          }),
        },
      );
      for (const entry of chunk) {
        const result = response.results.find((row) => row.id === entry.row.id);
        if (!result?.detail) {
          outcomes[entry.index] = {
            status: 'rejected',
            reason: new Error(result?.error || 'Reload saved state before retrying.'),
          };
          continue;
        }
        const next = preparationRow(result.detail);
        if (mode === 'details') {
          next.counts = entry.row.counts;
          next.countsChanged = entry.row.countsChanged;
        }
        outcomes[entry.index] = {
          status: 'fulfilled',
          value: {
            ...next,
            selected: entry.row.selected,
            result: mode === 'counts' ? 'Counts confirmed' : 'Details saved',
          },
        };
      }
    } catch (reason) {
      for (const entry of chunk) outcomes[entry.index] = { status: 'rejected', reason };
    }
  }
  return outcomes;
}

/** Reuse the server's existing revision checks and audit trail; each confirmation is an absolute count, never a stock increment. */
// Removal candidate: the batch panel now uses savePreparationBatch; retain this single-lot helper pending owner review.
export async function savePreparation(row: PreparationRow, branch: string, mode: 'details' | 'counts') {
  if (!row.detail) throw new Error('Reload this product before saving.');
  const payload =
    mode === 'counts'
      ? { entries: countEntries(row) }
      : {
          name: row.name,
          brand: row.brand,
          category_id: row.category,
          attributes: Object.fromEntries(
            row.changedAttributes.map((key) => [key, row.attributes[key] ?? null]),
          ),
          resolve_flag: row.resolveFlag,
        };
  await requestPos(`/catalog-workspace/items/${row.id}${mode === 'counts' ? '/count' : ''}`, branch, {
    method: 'PATCH',
    body: JSON.stringify({ ...payload, expected_revision: row.detail.revision }),
  });
  const next = preparationRow(await readPreparation(row.id, branch));
  if (mode === 'details') {
    next.counts = row.counts;
    next.countsChanged = row.countsChanged;
  }
  return {
    ...next,
    selected: row.selected,
    result: mode === 'counts' ? 'Counts confirmed' : 'Details saved',
  };
}
