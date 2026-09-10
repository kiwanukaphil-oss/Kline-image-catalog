type SourceLot = {
  id: string;
  stock_quantity: number;
  stock_distribution_source: string;
};
type MatchedProduct = { id: string; item_ids: string[]; target_product_id: string | null };

/** Count destinations once while retaining source quantities and identifying groups only partly in view. */
export function summarizeReceivingProducts(items: SourceLot[], matches: MatchedProduct[]) {
  const lots = new Map(items.map((item) => [item.id, item]));
  const membership = new Map(matches.flatMap((group) => group.item_ids.map((id) => [id, group] as const)));
  const destinations = new Set<string>();
  const groups = new Map<string, MatchedProduct>();
  let separateLots = 0;
  for (const id of lots.keys()) {
    const group = membership.get(id);
    if (group) {
      groups.set(group.id, group);
      destinations.add(group.target_product_id ? `pos:${group.target_product_id}` : `group:${group.id}`);
    } else {
      separateLots++;
      destinations.add(`lot:${id}`);
    }
  }
  return {
    sourceLots: lots.size,
    products: destinations.size,
    matchedGroups: groups.size,
    separateLots,
    partialGroups: [...groups.values()].filter((group) => group.item_ids.some((id) => !lots.has(id))).length,
    units: [...lots.values()].reduce((sum, item) => sum + Number(item.stock_quantity || 0), 0),
    confirmed:
      lots.size > 0 &&
      [...lots.values()].every((item) => item.stock_distribution_source === 'human_confirmed'),
  };
}

export function describeReceivingProducts(summary: ReturnType<typeof summarizeReceivingProducts>) {
  return `${summary.sourceLots} source ${summary.sourceLots === 1 ? 'lot' : 'lots'} → ${summary.products} POS ${summary.products === 1 ? 'product' : 'products'} · ${summary.units} ${summary.confirmed ? 'confirmed' : 'recorded'} units`;
}
