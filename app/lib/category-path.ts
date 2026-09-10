export type CategoryNode = { id: string; name: string; parent_id: string | null };

/** Resolve the complete destination without looping on malformed category ancestry. */
export function categoryPath(categoryId: string, categories: CategoryNode[]): string {
  const names: string[] = [];
  const seen = new Set<string>();
  let current = categories.find((category) => category.id === categoryId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = categories.find((category) => category.id === current?.parent_id);
  }
  return names.join(' → ');
}
