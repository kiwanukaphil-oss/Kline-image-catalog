const sizeOrder = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'];
const numericOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
/** Legacy labels sort beside their canonical equivalent without rewriting stored sizes. */
function alphaSizeRank(value: string) {
  const compact = value.trim().toUpperCase().replace(/[- ]/g, '');
  const alias = /^X{2,6}L$/.test(compact) ? `${compact.length - 1}XL` : compact;
  const words: Record<string, string> = { SMALL: 'S', MEDIUM: 'M', LARGE: 'L', EXTRALARGE: 'XL', EXTRASMALL: 'XS', EXTRAEXTRASMALL: 'XXS' };
  return sizeOrder.indexOf(words[alias] || alias);
}
/** Keep familiar size order even when the POS snapshot is sorted by internal identifiers. */
export function compareVariants(
  left: { variant_attributes: Record<string, string> },
  right: { variant_attributes: Record<string, string> },
) {
  const a = String(left.variant_attributes.size || ''),
    b = String(right.variant_attributes.size || '');
  const aIndex = alphaSizeRank(a),
    bIndex = alphaSizeRank(b);
  return aIndex >= 0 && bIndex >= 0 ? aIndex - bIndex : numericOrder.compare(a, b);
}
