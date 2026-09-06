/** Build a non-secret POS handoff; the destination rechecks identity, branch access and permissions. */
export function posProductLink(productId: string, branchId: string, action: 'product' | 'prices' | 'stock') {
  const configured =
    process.env.NEXT_PUBLIC_POS_URL ||
    (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:3000' : '');
  if (!configured) return null;
  try {
    const base = new URL(configured);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) return null;
    const url = new URL('/catalog-handoff', base.origin);
    url.search = new URLSearchParams({ product_id: productId, branch_id: branchId, action }).toString();
    return url.toString();
  } catch {
    return null;
  }
}
