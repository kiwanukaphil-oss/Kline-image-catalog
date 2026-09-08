'use client';
import { WorkspaceSelect } from '@/components/workspace-select';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { requestPos } from '@/lib/catalog-api';
import { Modal, SearchField, usePosRead } from './workspace-ui';
type Category = { id: string; name: string; parent_id: string | null };
type Mapping = Category & { pos_category_id: string | null; revision: string };
/** Show category ancestry where identical leaf names would otherwise make mapping ambiguous. */
function categoryPath(category: Category, categories: Category[]) {
  const names = [category.name],
    seen = new Set([category.id]);
  let parent = category.parent_id;
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const row = categories.find((entry) => entry.id === parent);
    if (!row) break;
    names.unshift(row.name);
    parent = row.parent_id;
  }
  return names.join(' / ');
}
/** Edit one global mapping at a time; save validates both permission and the reviewed mapping revision. */
export function CategoryMappings({
  branch,
  onClose,
  onSaved,
  categoryId,
}: {
  branch: string;
  onClose: () => void;
  onSaved?: () => void;
  categoryId?: string;
}) {
  const data = usePosRead<{ categories: Mapping[]; pos_categories: Category[] }>(
    '/catalog-workspace/category-mappings',
    branch,
  );
  const categories = data.data?.categories || [],
    posCategories = data.data?.pos_categories || [];
  const [search, setSearch] = useState(''),
    [editing, setEditing] = useState<Mapping | null>(null);
  const [target, setTarget] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function saveMapping() {
    // A failed or stale write leaves the current choice visible and requires deliberate reload or correction.
    if (!editing) return;
    setBusy(true);
    setError('');
    try {
      await requestPos(`/catalog-workspace/category-mappings/${editing.id}`, branch, {
        method: 'PUT',
        body: JSON.stringify({ pos_category_id: target, expected_revision: editing.revision }),
      });
      setEditing(null);
      data.refresh();
      onSaved?.();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Category mappings"
      description="Choose where catalog categories are received in POS. Applies across branches."
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      {(error || data.error) && (
        <p role="alert" className="error">
          {error || data.error}
        </p>
      )}
      {editing ? (
        <>
          <h2>{categoryPath(editing, categories)}</h2>
          <label>
            POS category
            <WorkspaceSelect
              aria-label="POS category"
              value={target}
              disabled={busy}
              onValueChange={(event) => setTarget(event)}
            >
              <option value="">Choose category</option>
              {posCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {categoryPath(category, posCategories)}
                </option>
              ))}
            </WorkspaceSelect>
          </label>
          <div className="dialog-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                data.refresh();
                setError('');
              }}
            >
              Reload mappings
            </Button>
            <Button disabled={busy || !target} onClick={saveMapping}>
              {busy ? 'Saving…' : 'Save mapping'}
            </Button>
          </div>
        </>
      ) : (
        <>
          <SearchField value={search} onChange={setSearch} placeholder="Find catalog category" />
          {data.loading ? (
            <p role="status">Loading mappings…</p>
          ) : (
            categories
              .filter(
                (category) =>
                  (!categoryId || category.id === categoryId) &&
                  categoryPath(category, categories).toLowerCase().includes(search.toLowerCase()),
              )
              .map((category) => {
                const linked = posCategories.find((row) => row.id === category.pos_category_id);
                return (
                  <Button
                    key={category.id}
                    variant="outline"
                    className="justify-between min-h-12 h-auto gap-3 py-3 whitespace-normal text-left"
                    onClick={() => {
                      setEditing(category);
                      setTarget(category.pos_category_id || '');
                      setError('');
                    }}
                  >
                    <span>{categoryPath(category, categories)}</span>
                    <span>{linked ? categoryPath(linked, posCategories) : 'Not connected'}</span>
                  </Button>
                );
              })
          )}
        </>
      )}
    </Modal>
  );
}
