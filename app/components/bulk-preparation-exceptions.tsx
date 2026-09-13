'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from './workspace-ui';
import { requestPos, postPos, type Session } from '@/lib/catalog-api';
import { mapPreparation, type PreparationRow } from '@/lib/bulk-preparation';
import { useWorkspaceProtection } from '@/lib/workspace-protection';
import type { ProductMatch } from './product-matching';

type Mapping = { id: string; name: string; pos_category_id: string | null; revision: string };
type Target = { id: string; name: string };
type PhotoAssignment = { id: string; file: File; itemId: string; result: string; saved: boolean };

/** Resolve exceptional requirements for the selected batch without opening individual product editors. */
export function BulkPreparationExceptions({
  rows,
  branch,
  session,
  onClose,
}: {
  rows: PreparationRow[];
  branch: string;
  session: Session;
  onClose: () => void;
}) {
  const [mappings, setMappings] = useState<Mapping[]>([]),
    [targets, setTargets] = useState<Target[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<PhotoAssignment[]>([]);
  const [groups, setGroups] = useState<ProductMatch[]>([]),
    [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  const [confirmUngroup, setConfirmUngroup] = useState(false);
  const [discard, setDiscard] = useState(false);
  const dirty = photos.some((photo) => !photo.saved) || Object.keys(choices).length > 0;
  useWorkspaceProtection(dirty, busy);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      session.can_manage_categories
        ? requestPos<{ categories: Mapping[]; pos_categories: Target[] }>(
            '/catalog-workspace/category-mappings',
            branch,
            { signal: controller.signal },
          )
        : Promise.resolve({ categories: [], pos_categories: [] }),
      requestPos<ProductMatch[]>('/catalog-workspace/product-matches', branch, { signal: controller.signal }),
    ])
      .then(([mappingData, matchData]) => {
        if (controller.signal.aborted) return;
        setMappings(
          mappingData.categories.filter((mapping) => rows.some((row) => row.category === mapping.id)),
        );
        setTargets(mappingData.pos_categories);
        const relevant = matchData.filter((group) =>
          group.item_ids.some((id) => rows.some((row) => row.id === id)),
        );
        setGroups(relevant);
        setSelectedGroups(
          relevant
            .filter((group) => group.item_ids.every((id) => rows.some((row) => row.id === id)))
            .map((group) => group.id),
        );
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [branch, rows, session.can_manage_categories]);

  /** Save changed mappings once per category and retain each failed mapping's proposed destination. */
  async function saveMappings() {
    setBusy(true);
    const changed = mappings.filter(
      (mapping) => choices[mapping.id] && choices[mapping.id] !== mapping.pos_category_id,
    );
    const outcomes = await mapPreparation(changed, async (mapping) => {
      await requestPos(`/catalog-workspace/category-mappings/${mapping.id}`, branch, {
        method: 'PUT',
        body: JSON.stringify({ pos_category_id: choices[mapping.id], expected_revision: mapping.revision }),
      });
      return mapping.id;
    });
    outcomes.forEach((outcome, index) => {
      const id = changed[index].id;
      setResults((prior) => ({
        ...prior,
        [id]:
          outcome.status === 'fulfilled'
            ? 'Category connected'
            : String(outcome.reason?.message || outcome.reason),
      }));
      if (outcome.status === 'fulfilled')
        setMappings((prior) =>
          prior.map((mapping) =>
            mapping.id === id ? { ...mapping, pos_category_id: choices[id] } : mapping,
          ),
        );
      if (outcome.status === 'fulfilled')
        setChoices((prior) => {
          const next = { ...prior };
          delete next[id];
          return next;
        });
    });
    if (outcomes.some((outcome) => outcome.status === 'fulfilled')) {
      try {
        const refreshed = await requestPos<{ categories: Mapping[] }>(
          '/catalog-workspace/category-mappings',
          branch,
        );
        const savedIds = changed
          .filter((_, index) => outcomes[index].status === 'fulfilled')
          .map((mapping) => mapping.id);
        setMappings((prior) =>
          prior.map((mapping) =>
            savedIds.includes(mapping.id)
              ? refreshed.categories.find((fresh) => fresh.id === mapping.id) || mapping
              : mapping,
          ),
        );
      } catch {
        setError('Connections saved. Reopen this panel before changing those connections again.');
      }
    }
    setBusy(false);
  }

  /** Every replacement has an explicit lot assignment; retries skip uploads already acknowledged as saved. */
  async function attachPhotos() {
    setBusy(true);
    const pending = photos.filter((photo) => !photo.saved);
    const outcomes = await mapPreparation(
      pending,
      async (photo) => {
        const row = rows.find((row) => row.id === photo.itemId);
        if (!row?.detail) throw new Error('Choose a product for this photo.');
        if (pending.filter((other) => other.itemId === photo.itemId).length > 1)
          throw new Error('Assign only one replacement photo to each lot.');
        const form = new FormData();
        form.set('image', photo.file);
        form.set('expected_revision', row.detail.revision);
        await requestPos(`/catalog-workspace/items/${photo.itemId}/source-photo`, branch, {
          method: 'POST',
          body: form,
        });
      },
      2,
    );
    setPhotos((prior) =>
      prior.map((photo) => {
        const index = pending.findIndex((entry) => entry.id === photo.id);
        if (index < 0) return photo;
        const outcome = outcomes[index];
        return {
          ...photo,
          saved: outcome.status === 'fulfilled',
          result:
            outcome.status === 'fulfilled'
              ? 'Photo attached'
              : String(outcome.reason?.message || outcome.reason),
        };
      }),
    );
    setBusy(false);
  }

  /** Checking groups is read-only; ungrouping requires a separate batch confirmation and retains all source stock. */
  async function operateGroups(ungroup = false) {
    setConfirmUngroup(false);
    setBusy(true);
    const chosen = groups.filter(
      (group) =>
        selectedGroups.includes(group.id) && group.item_ids.every((id) => rows.some((row) => row.id === id)),
    );
    const outcomes = await mapPreparation(chosen, async (group) =>
      postPos(
        `/catalog-workspace/product-matches/${group.id}/${ungroup ? 'unmatch' : 'review'}`,
        branch,
        ungroup ? { expected_revision: group.revision } : {},
      ),
    );
    outcomes.forEach((outcome, index) =>
      setResults((prior) => ({
        ...prior,
        [chosen[index].id]:
          outcome.status === 'fulfilled'
            ? ungroup
              ? 'Returned to separate lots; regroup or receive separately.'
              : 'Group is ready for receipt'
            : String(outcome.reason?.message || outcome.reason),
      })),
    );
    if (ungroup)
      setGroups((prior) =>
        prior.filter(
          (group) =>
            !chosen.some((entry, index) => entry.id === group.id && outcomes[index].status === 'fulfilled'),
        ),
      );
    setBusy(false);
  }

  function closeExceptions() {
    if (!busy) {
      if (dirty) setDiscard(true);
      else onClose();
    }
  }
  return (
    <Modal title="Resolve batch requirements" wide onClose={closeExceptions}>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p>Changes apply to the selected source lots. Prices and costs remain in bulk Pricing.</p>
      <h2>Category connections</h2>
      <p>Connect each category once for every product using it. These mappings apply across branches.</p>
      {!session.can_manage_categories ? (
        <p>An account with category-management permission can connect all affected categories here.</p>
      ) : (
        <>
          {mappings.map((mapping) => (
            <label key={mapping.id}>
              {mapping.name}
              <select
                aria-label={`POS category ${mapping.name}`}
                disabled={busy}
                value={choices[mapping.id] ?? mapping.pos_category_id ?? ''}
                onChange={(event) =>
                  setChoices((prior) => {
                    const next = { ...prior };
                    if (!event.target.value || event.target.value === mapping.pos_category_id)
                      delete next[mapping.id];
                    else next[mapping.id] = event.target.value;
                    return next;
                  })
                }
              >
                <option value="">Choose POS category</option>
                {targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.name}
                  </option>
                ))}
              </select>
              {results[mapping.id] && <span role="status">{results[mapping.id]}</span>}
            </label>
          ))}
          <Button disabled={busy || !Object.keys(choices).length} onClick={() => void saveMappings()}>
            Save category connections
          </Button>
        </>
      )}
      <h2>Missing or incorrect photos</h2>
      <p>
        Choose multiple JPG, PNG or WEBP files (up to 5 MB each), assign each to its product, then attach them
        together. Previous photo files are retained.
      </p>
      {session.can_upload && session.can_edit ? (
        <>
          <input
            aria-label="Batch replacement photos"
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              setPhotos((prior) => [
                ...prior,
                ...files.map((file) => ({
                  id: crypto.randomUUID(),
                  file,
                  itemId: '',
                  result: '',
                  saved: false,
                })),
              ]);
              event.target.value = '';
            }}
          />
          {photos.map((photo) => (
            <div className="bulk-preparation-actions" key={photo.id}>
              <span>{photo.file.name}</span>
              <select
                aria-label={`Product for ${photo.file.name}`}
                disabled={busy || photo.saved}
                value={photo.itemId}
                onChange={(event) =>
                  setPhotos((prior) =>
                    prior.map((entry) =>
                      entry.id === photo.id ? { ...entry, itemId: event.target.value } : entry,
                    ),
                  )
                }
              >
                <option value="">Assign product</option>
                {rows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} · {String(row.detail?.item.attributes.size || 'No size')} ·{' '}
                    {row.id.slice(0, 8)}
                  </option>
                ))}
              </select>
              <span role="status">{photo.result}</span>
              {!photo.saved && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setPhotos((prior) => prior.filter((entry) => entry.id !== photo.id))}
                >
                  Remove pending file
                </Button>
              )}
            </div>
          ))}
          <Button
            disabled={busy || !photos.some((photo) => !photo.saved)}
            onClick={() => void attachPhotos()}
          >
            Attach assigned photos
          </Button>
        </>
      ) : (
        <p>An account with upload and edit permission can attach photos for this batch.</p>
      )}
      <h2>Matched product groups</h2>
      <p>
        Check all complete groups together. Resolve material or required-detail differences in the batch
        table. A partial group requires selecting all its source lots.
      </p>
      {groups.map((group) => (
        <div key={group.id}>
          <label className="bulk-check">
            <input
              type="checkbox"
              disabled={busy || !group.item_ids.every((id) => rows.some((row) => row.id === id))}
              checked={selectedGroups.includes(group.id)}
              onChange={(event) =>
                setSelectedGroups((prior) =>
                  event.target.checked ? [...prior, group.id] : prior.filter((id) => id !== group.id),
                )
              }
            />
            {group.product_name} — {group.item_ids.length} source lots
          </label>
          <p>
            {group.item_ids
              .map((id) => {
                const row = rows.find((row) => row.id === id);
                return row
                  ? `${row.name}: ${String(row.detail?.item.attributes.material || 'material not set')}, ${String(row.detail?.item.attributes.size || 'size not set')}`
                  : 'Lot outside selection';
              })
              .join(' / ')}
          </p>
          {results[group.id] && <p role="status">{results[group.id]}</p>}
        </div>
      ))}
      <Button
        variant="outline"
        disabled={busy || !selectedGroups.length || !session.can_publish}
        onClick={() => void operateGroups()}
      >
        Check selected groups
      </Button>
      <Button
        variant="outline"
        disabled={busy || !selectedGroups.length || !session.can_publish || !session.can_open_pos_product}
        onClick={() => setConfirmUngroup(true)}
      >
        Return selected groups to separate lots
      </Button>
      <Button variant="ghost" disabled={busy} onClick={closeExceptions}>
        Back to batch preparation
      </Button>
      {confirmUngroup && (
        <Modal title="Return groups to separate lots?" onClose={() => setConfirmUngroup(false)}>
          <p>
            This retires the selected grouping decisions. It keeps every source lot, quantity and photo. These
            lots can then be matched again together or received separately. No stock is received by this
            action.
          </p>
          <Button onClick={() => void operateGroups(true)}>Confirm ungrouping selected groups</Button>
        </Modal>
      )}
      {discard && (
        <Modal title="Discard pending assignments?" onClose={() => setDiscard(false)}>
          <p>Saved photos and mappings remain. Unsaved assignments will be discarded.</p>
          <Button variant="outline" onClick={() => setDiscard(false)}>
            Keep editing
          </Button>
          <Button onClick={onClose}>Discard pending assignments</Button>
        </Modal>
      )}
    </Modal>
  );
}
