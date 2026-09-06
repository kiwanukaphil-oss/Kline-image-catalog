const sizeOrder = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'];
const numericOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
/** Keep familiar size order even when the POS snapshot is sorted by internal identifiers. */
export function compareVariants(
  left: { variant_attributes: Record<string, string> },
  right: { variant_attributes: Record<string, string> },
) {
  const a = String(left.variant_attributes.size || ''),
    b = String(right.variant_attributes.size || '');
  const aIndex = sizeOrder.indexOf(a.toUpperCase()),
    bIndex = sizeOrder.indexOf(b.toUpperCase());
  return aIndex >= 0 && bIndex >= 0 ? aIndex - bIndex : numericOrder.compare(a, b);
}
