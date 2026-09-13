export type DeliveryLine = {
  id?: string;
  size: string;
  quantity: string;
  price: string;
  cost?: string;
  cost_missing?: boolean;
};
export type DeliveryItem = {
  id: string;
  name: string;
  image_url: string | null;
  attributes: Record<string, string | number | boolean>;
  revision: string;
  is_published: boolean;
  is_cancelled: boolean;
  has_size: boolean;
  count_source: string;
  required_fields: { key: string; label: string; type: string }[];
  lines: DeliveryLine[];
  issues: string[];
  selected: boolean;
  dirty: boolean;
  error?: string;
};
export type DeliveryReview = {
  unit: { id: string; group: boolean; item_ids: string[] };
  item_ids: string[];
  revision?: string;
  name?: string;
  outcome?: string;
  image_url?: string | null;
  error?: string;
  already_received?: boolean;
  rows?: { size: string; quantity: number; price: number }[];
};

/** Use saved sizes as proposals only for a single blank row; never turn a range into one sellable variant. */
export function editableDeliveryItem(item: DeliveryItem): DeliveryItem {
  const size = String(item.attributes?.size || '').trim();
  const single =
    /^(?:(?:W\s*|UK\s*|EU\s*|US\s*)?\d{1,3}(?:\.5)?(?:\s*L\s*\d{2,3})?|XXS|XS|S|M|L|XL|X{2,6}L|[2-9]XL|one size)$/i.test(
      size,
    );
  const seed =
    item.lines.length === 1 && single && !item.lines[0].size && item.count_source !== 'human_confirmed';
  return {
    ...item,
    selected: !item.is_published && !item.is_cancelled,
    dirty: !!seed,
    lines: item.lines.map((line) => ({
      ...line,
      size: line.size || (seed ? size : ''),
      quantity: String(line.quantity),
      price: line.price == null ? '' : String(line.price),
      ...(Object.hasOwn(line, 'cost') ? { cost: line.cost == null ? '' : String(line.cost) } : {}),
    })),
  };
}

/** One row payload saves the visible stock proposal and commercial fields without exposing hidden costs. */
export function deliverySavePayload(item: DeliveryItem) {
  return {
    id: item.id,
    revision: item.revision,
    name: item.name,
    attributes: Object.fromEntries(
      item.required_fields
        .filter((field) => Object.hasOwn(item.attributes, field.key))
        .map((field) => [field.key, item.attributes[field.key]]),
    ),
    lines: item.lines.map((line) => ({ ...line, quantity: Number(line.quantity) })),
  };
}
