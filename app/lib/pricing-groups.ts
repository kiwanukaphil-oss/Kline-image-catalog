import { parseMoney, type PriceItem, type PriceLine, type PricePlan } from './pricing.ts';

export type PricingFilters = { search: string; category: string; brand: string; size: string };
export type PriceExceptionRule = { id: string; brand: string; size: string; price: string };
export const emptyPricingFilters: PricingFilters = { search: '', category: '', brand: '', size: '' };
export const pricingKey = (value: string | null | undefined) => (value || '').trim().toLocaleLowerCase();
export const lineSize = (line: PriceLine) =>
  Object.entries(line.variant_attributes).find(([key]) => pricingKey(key) === 'size')?.[1] || '';
export const brandKey = (item: PriceItem) => pricingKey(item.brand) || '__unbranded__';

/** Resolve the complete matching group before display pagination; only eligible sizes are selectable. */
export function filterPricingItems(
  items: PriceItem[],
  filters: PricingFilters,
  field: 'retail' | 'cost',
  intent: 'fill' | 'revise',
) {
  const words = pricingKey(filters.search).split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    const searchable = pricingKey(
      [item.name, item.brand, item.category_name, ...Object.values(item.attributes || {})].join(' '),
    );
    return (
      !item.is_published &&
      (!filters.category || item.category_id === filters.category) &&
      (!filters.brand || brandKey(item) === filters.brand) &&
      words.every((word) => searchable.includes(word)) &&
      item.lines.some((line) => eligiblePriceLine(line, filters.size, field, intent))
    );
  });
}

export function eligiblePriceLine(
  line: PriceLine,
  size: string,
  field: 'retail' | 'cost',
  intent: 'fill' | 'revise',
) {
  return (
    line.quantity > 0 &&
    (!size || pricingKey(lineSize(line)) === size) &&
    (intent === 'revise' || (field === 'retail' ? line.effective_price : line.effective_cost) == null)
  );
}

/** Expand optional brand/size exceptions to exact selected lines; conflicting prices never silently win. */
export function resolveGroupExceptions(
  items: PriceItem[],
  selected: string[],
  rules: PriceExceptionRule[],
  individual: Record<string, string>,
) {
  const selectedIds = new Set(selected);
  const exceptions: Record<string, string> = {};
  const conflicts: string[] = [];
  const counts = Object.fromEntries(rules.map((rule) => [rule.id, 0]));
  for (const item of items)
    for (const line of item.lines) {
      if (!selectedIds.has(line.id)) continue;
      const matching = rules.filter(
        (rule) =>
          (rule.brand || rule.size) &&
          (!rule.brand || brandKey(item) === rule.brand) &&
          (!rule.size || pricingKey(lineSize(line)) === rule.size),
      );
      matching.forEach((rule) => counts[rule.id]++);
      if (individual[line.id]?.trim()) {
        exceptions[line.id] = individual[line.id];
        continue;
      }
      const prices = new Set(matching.filter((rule) => rule.price.trim()).map((rule) => Number(rule.price)));
      if (prices.size > 1) conflicts.push(`${item.name || 'Unnamed lot'} / ${lineSize(line) || 'Standard'}`);
      else if (matching.length) exceptions[line.id] = matching.find((rule) => rule.price.trim())?.price || '';
    }
  return { exceptions, conflicts, counts };
}

/** Validate unfinished and unmatched exception rows before compiling a financial proposal. */
export function validateGroupExceptions(
  rules: PriceExceptionRule[],
  resolved: ReturnType<typeof resolveGroupExceptions>,
) {
  for (const [index, rule] of rules.entries()) {
    if (!rule.brand && !rule.size) throw new Error(`Choose a brand or size for exception ${index + 1}.`);
    parseMoney(rule.price);
    if (!resolved.counts[rule.id])
      throw new Error(`Exception ${index + 1} matches no selected sizes. Adjust it or remove it.`);
  }
  if (resolved.conflicts.length)
    throw new Error(
      `Conflicting exceptions for ${resolved.conflicts[0]}${resolved.conflicts.length > 1 ? ` and ${resolved.conflicts.length - 1} other sizes` : ''}. Adjust the exceptions or set an individual price.`,
    );
}

/** Summarize the authoritative server review, retaining exact rows for optional drill-down. */
export function summarizePricePlan(plan: PricePlan, field: 'retail' | 'cost') {
  const groups = new Map<
    string,
    { price: number | null; changed: boolean; lots: Set<string>; sizes: number; units: number }
  >();
  for (const row of plan.rows) {
    const price = (field === 'retail' ? row.price_after : row.cost_after) ?? null;
    const key = `${price}:${row.changed}`;
    const group = groups.get(key) || {
      price,
      changed: row.changed,
      lots: new Set<string>(),
      sizes: 0,
      units: 0,
    };
    group.lots.add(row.item_id);
    group.sizes++;
    group.units += row.quantity;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => (a.price ?? -1) - (b.price ?? -1));
}
