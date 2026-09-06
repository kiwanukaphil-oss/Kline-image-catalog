export type PriceLine = {
  id: string;
  variant_attributes: Record<string, string>;
  quantity: number;
  effective_price: number | null;
  effective_cost?: number | null;
  price_override: number | null;
  cost_override?: number | null;
};
export type PriceItem = {
  id: string;
  name: string;
  brand: string;
  category_id?: string;
  category_name?: string;
  attributes?: Record<string, string>;
  image_url: string | null;
  revision: string;
  is_published: boolean;
  base_price: number | null;
  base_cost_price?: number | null;
  lines: PriceLine[];
};
export type PricePlan = {
  includes_costs?: boolean;
  undone_at?: string;
  id: string;
  status: string;
  applied_at: string;
  expires_at: string;
  summary: {
    item_count: number;
    variant_count: number;
    total_units: number;
    changed_count: number;
    protected_count: number;
  };
  rows: {
    item_id: string;
    line_id: string;
    name: string;
    variant_attributes: Record<string, string>;
    quantity: number;
    price_before: number | null;
    price_after: number | null;
    cost_before?: number | null;
    cost_after?: number | null;
    changed: boolean;
    price_source: string;
    price_protected: boolean;
    cost_protected?: boolean;
  }[];
};
export const parseMoney = (raw: string) => {
  /* Require a finite positive monetary value within the POS precision and amount limits. */

  const value = Number(raw);
  if (
    !raw.trim() ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 99999999.99 ||
    Math.abs(value * 100 - Math.round(value * 100)) > 0.000001
  )
    throw new Error('Enter a positive price with no more than two decimal places.');
  return value;
};

/** Compile explicit selections into POS plans; partial size selections never change sibling defaults. */
export function compilePriceProposal(
  items: PriceItem[],
  selected: string[],
  shared: string,
  exceptions: Record<string, string>,
  field: 'retail' | 'cost',
  intent: 'fill' | 'revise',
) {
  const selectedIds = new Set(selected);
  const baseKey = field === 'retail' ? 'base_price' : 'base_cost_price';
  const lineKey = field === 'retail' ? 'price_override' : 'cost_override';
  const replaceKey = field === 'retail' ? 'replace_price_override' : 'replace_cost_override';
  const proposals = items.flatMap((item) => {
    /* Apply parent defaults only when all sizes are selected; subsets receive explicit line edits. */

    const lines = item.lines.filter((line) => selectedIds.has(line.id));
    if (!lines.length) return [];
    const all = lines.length === item.lines.length;
    const explicit = lines.flatMap<Record<string, string | number | boolean | null>>((line) => {
      const raw = exceptions[line.id];
      if (raw === 'shared')
        return [
          { id: line.id, [lineKey]: !all && shared.trim() ? parseMoney(shared) : null, [replaceKey]: true },
        ];
      if (raw?.trim()) return [{ id: line.id, [lineKey]: parseMoney(raw), [replaceKey]: true }];
      if (!all && shared.trim()) return [{ id: line.id, [lineKey]: parseMoney(shared), [replaceKey]: true }];
      return [];
    });
    if (!shared.trim() && !explicit.length) return [];
    return [
      {
        id: item.id,
        expected_revision: item.revision,
        target_line_ids: lines.map((line) => line.id),
        ...(all && shared.trim() ? { [baseKey]: parseMoney(shared) } : {}),
        lines: explicit,
      },
    ];
  });
  if (!proposals.length) throw new Error('Choose merchandise and enter a price.');
  return {
    retail_mode: field === 'retail' ? intent : 'leave',
    cost_mode: field === 'cost' ? intent : 'leave',
    keep_overrides: true,
    keep_cost_overrides: true,
    items: proposals,
  };
}
