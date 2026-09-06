import type { CatalogItem } from '@/lib/catalog-api';

/** Keep uncertainty next to its field and reveal the observation only when requested. */
export function AiFieldHint({
  item,
  field,
  value,
}: {
  item: CatalogItem;
  field: string;
  value: string | number | boolean | null | undefined;
}) {
  const confidence = item.confidence?.[field];
  const savedValue = field === 'name' ? item.name : field === 'brand' ? item.brand : item.attributes[field];
  if (!confidence || String(value ?? '') !== String(savedValue ?? '')) return null;
  const evidence = item.ai_field_evidence?.[field];
  return (
    <details className="ai-field-hint">
      <summary>{confidence === 'High' ? 'From photo' : 'Check suggestion'}</summary>
      <span>
        {confidence} confidence{evidence?.source === 'printed_label' ? ' · Printed label' : ''}
      </span>
      {evidence?.observation && <p>{evidence.observation}</p>}
    </details>
  );
}
