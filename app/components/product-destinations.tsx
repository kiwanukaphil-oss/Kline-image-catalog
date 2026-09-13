'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal, Photo, Pagination } from './workspace-ui';
import { requestPos, type CatalogItem } from '@/lib/catalog-api';
import { useWorkspaceProtection } from '@/lib/workspace-protection';

type Product = {
  id: string;
  name: string;
  description: string | null;
  brand: string;
  category_id: string;
  version: string;
  master_sku: string;
  image_url: string | null;
  variants: Record<string, string>[] | null;
  previously_received: boolean;
};
type Lot = {
  id: string;
  name: string;
  brand: string;
  attributes: Record<string, string>;
  category_id: string;
  image_url: string | null;
  revision: string;
  error?: string;
  group: {
    id: string;
    item_ids: string[];
    target_product_id: string | null;
    product_name: string;
    revision: string;
  } | null;
};
type Mode = '' | 'new' | 'restock' | 'update';
type Destination = {
  key: string;
  lots: Lot[];
  selected: boolean;
  mode: Mode;
  target: string;
  name: string;
  brand: string;
  note: string;
  rename: boolean;
  description: boolean;
  descriptionText: string;
  photos: boolean;
  options: Product[];
  search: string;
  error: string;
  saved: boolean;
};
type Operation = {
  item_ids: string[];
  mode: Mode;
  target_product_id: string | null;
  name: string;
  brand: string;
  note: string;
  patch: { name?: string; description?: string; add_photos?: boolean };
  source_revisions: Record<string, string>;
  group_revisions: Record<string, string>;
  target_version?: string;
};
type Reviewed = {
  key: string;
  review?: {
    revision: string;
    operation: Operation;
    target_name: string | null;
    source_lots: number;
    effect: string;
    changes: { before: { name: string; description: string | null }; after: Operation['patch'] } | null;
  };
  error?: string;
  saved?: boolean;
};

/** Rank saved appearance and brand evidence for display only; every destination still needs explicit selection. */
function rankProduct(product: Product, lot: Lot) {
  let score = product.previously_received ? 1 : 0;
  if (product.brand?.toLowerCase() === lot.brand?.toLowerCase()) score += 5;
  for (const field of ['color', 'fit', 'sleeve'])
    if (
      product.variants?.some(
        (variant) => variant[field]?.toLowerCase() === lot.attributes[field]?.toLowerCase(),
      )
    )
      score += 2;
  return score;
}

/** One batch resolves different POS destinations while keeping stock receipt separate from metadata updates. */
export function ProductDestinations({
  items,
  branch,
  onClose,
  onSaved,
  onReceive,
  onPrepare,
}: {
  items: CatalogItem[];
  branch: string;
  onClose: () => void;
  onSaved: () => void;
  onReceive: (ids: string[]) => void;
  onPrepare: (ids: string[]) => void;
}) {
  const [rows, setRows] = useState<Destination[]>([]),
    [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  const [canUpdate, setCanUpdate] = useState(false),
    [page, setPage] = useState(1),
    [commonMode, setCommonMode] = useState<Mode>('');
  const [commonTarget, setCommonTarget] = useState(''),
    [reviews, setReviews] = useState<Reviewed[] | null>(null),
    [discard, setDiscard] = useState(false);
  const [commonField, setCommonField] = useState<'name' | 'description'>('description'),
    [commonValue, setCommonValue] = useState('');
  const [continuation, setContinuation] = useState<(() => void) | null>(null);
  const dirty = rows.some((row) => !row.saved && (row.mode !== '' || row.target !== ''));
  useWorkspaceProtection(dirty, busy);
  const selected = rows.filter((row) => row.selected && !row.saved);
  const savedStock = rows
    .filter((row) => row.saved && row.mode !== 'update')
    .flatMap((row) => row.lots.map((lot) => lot.id));
  const sharedProducts = [
    ...new Map(rows.flatMap((row) => row.options.map((product) => [product.id, product] as const))).values(),
  ];

  /** Read bounded source batches, preserve complete existing groups and reuse candidate searches across like categories/brands. */
  const loadDestinations = useCallback(
    async (signal?: AbortSignal) => {
      setBusy(true);
      setError('');
      try {
        const lots: Lot[] = [];
        let permitted = false;
        for (let start = 0; start < items.length; start += 50) {
          const result = await requestPos<{ rows: Lot[]; can_update: boolean }>(
            '/catalog-workspace/destinations/read',
            branch,
            {
              method: 'POST',
              body: JSON.stringify({ item_ids: items.slice(start, start + 50).map((item) => item.id) }),
              signal,
            },
          );
          lots.push(...result.rows);
          permitted = result.can_update;
        }
        const grouped = new Map<string, Lot[]>();
        for (const lot of lots) {
          const key = lot.group?.id || lot.id;
          grouped.set(key, [...(grouped.get(key) || []), lot]);
        }
        const cache = new Map<string, Product[]>();
        const loaded: Destination[] = [];
        for (const [key, members] of grouped) {
          const first = members[0],
            lookup = `${first.category_id}:${first.brand}`;
          let issue = first.error || '';
          if (first.group?.item_ids.some((id) => !members.some((lot) => lot.id === id)))
            issue = 'Select all source lots in this existing group, then reopen destinations.';
          if (!issue && !first.category_id) issue = 'Connect this category to POS in bulk preparation first.';
          if (!issue && !cache.has(lookup)) {
            try {
              cache.set(
                lookup,
                await requestPos<Product[]>(
                  `/catalog-workspace/destinations/products?category_id=${first.category_id}&search=${encodeURIComponent(first.brand || '')}`,
                  branch,
                  { signal },
                ),
              );
            } catch (cause) {
              issue = (cause as Error).message;
            }
          }
          const options = [...(cache.get(lookup) || [])].sort(
            (a, b) => rankProduct(b, first) - rankProduct(a, first),
          );
          loaded.push({
            key,
            lots: members,
            selected: !issue,
            mode: first.group ? (first.group.target_product_id ? 'restock' : 'new') : '',
            target: first.group?.target_product_id || '',
            name: first.group?.product_name || first.name || '',
            brand: first.brand || '',
            note: '',
            rename: false,
            description: false,
            descriptionText: '',
            photos: false,
            options,
            search: first.brand || '',
            error: issue,
            saved: false,
          });
        }
        if (!signal?.aborted) {
          setRows(loaded);
          setCanUpdate(permitted);
          setPage(1);
        }
      } catch (cause) {
        if (!signal?.aborted) setError((cause as Error).message);
      } finally {
        if (!signal?.aborted) setBusy(false);
      }
    },
    [branch, items],
  );
  useEffect(() => {
    const controller = new AbortController();
    void loadDestinations(controller.signal);
    return () => controller.abort();
  }, [loadDestinations]);

  function editRow(key: string, patch: Partial<Destination>) {
    setRows((prior) => prior.map((row) => (row.key === key ? { ...row, ...patch, error: '' } : row)));
    setReviews(null);
  }
  function close() {
    if (!busy) {
      if (dirty) setDiscard(true);
      else onClose();
    }
  }

  /** Search stays in the source's mapped category; refreshing clears a reviewed target's stale version. */
  async function findProducts(row: Destination) {
    setBusy(true);
    setReviews(null);
    try {
      const options = await requestPos<Product[]>(
        `/catalog-workspace/destinations/products?category_id=${row.lots[0].category_id}&search=${encodeURIComponent(row.search)}`,
        branch,
      );
      editRow(row.key, {
        options: options.sort((a, b) => rankProduct(b, row.lots[0]) - rankProduct(a, row.lots[0])),
        target: '',
      });
    } catch (cause) {
      editRow(row.key, { error: (cause as Error).message });
    } finally {
      setBusy(false);
    }
  }

  /** Combine sources going to one existing product, rejecting conflicting field edits before asking for a batch review. */
  function operationsForSelection() {
    const operations = new Map<string, Operation>();
    for (const row of selected) {
      if (!row.mode) throw new Error('Choose an action for every selected row, or clear its selection.');
      const product = row.options.find((product) => product.id === row.target);
      if (row.mode !== 'new' && !product)
        throw new Error('Choose an existing product for every restock or update row.');
      const key =
        row.mode === 'new'
          ? `new:${row.key}`
          : `${row.mode}:${row.lots[0].category_id}:${row.target}${row.mode === 'restock' ? `:${row.lots[0].group?.id || 'ungrouped'}` : ''}`;
      const patch =
        row.mode === 'update'
          ? {
              ...(row.rename ? { name: row.name } : {}),
              ...(row.description ? { description: row.descriptionText } : {}),
              ...(row.photos ? { add_photos: true } : {}),
            }
          : {};
      const operation: Operation = {
        item_ids: row.lots.map((lot) => lot.id),
        mode: row.mode,
        target_product_id: product?.id || null,
        name: row.mode === 'restock' ? product!.name : row.name,
        brand: row.mode === 'restock' ? product!.brand : row.brand,
        note:
          row.note ||
          'Staff reviewed the displayed photos, brand and design and explicitly selected this destination.',
        patch,
        source_revisions: Object.fromEntries(row.lots.map((lot) => [lot.id, lot.revision])),
        group_revisions: Object.fromEntries(
          row.lots.filter((lot) => lot.group).map((lot) => [lot.group!.id, lot.group!.revision]),
        ),
        target_version: product?.version,
      };
      const existing = operations.get(key);
      if (existing) {
        if (JSON.stringify(existing.patch) !== JSON.stringify(operation.patch))
          throw new Error('Rows updating the same product must propose the same details and photo action.');
        existing.item_ids.push(...operation.item_ids);
        Object.assign(existing.source_revisions, operation.source_revisions);
        Object.assign(existing.group_revisions, operation.group_revisions);
      } else operations.set(key, operation);
    }
    return [...operations].map(([key, operation]) => ({ key, operation }));
  }

  /** Review all destinations in bounded requests; good proposals remain actionable while errors stay beside their sources. */
  async function reviewDestinations() {
    setBusy(true);
    setError('');
    try {
      const operations = operationsForSelection(),
        results: Reviewed[] = [];
      for (let start = 0; start < operations.length; start += 10) {
        const result = await requestPos<{ results: Reviewed[] }>(
          '/catalog-workspace/destinations/review',
          branch,
          { method: 'POST', body: JSON.stringify({ operations: operations.slice(start, start + 10) }) },
        );
        results.push(...result.results);
      }
      setReviews(results);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Save only successful reviews; acknowledged successes are disabled and retries never silently repeat an uncertain operation. */
  async function applyDestinations() {
    if (!reviews) return;
    setBusy(true);
    setError('');
    try {
      const approved = reviews.filter((row) => row.review),
        results: Reviewed[] = [];
      for (let start = 0; start < approved.length; start += 10) {
        const chunk = approved.slice(start, start + 10);
        try {
          const result = await requestPos<{ results: Reviewed[] }>(
            '/catalog-workspace/destinations/apply',
            branch,
            {
              method: 'POST',
              body: JSON.stringify({
                operations: chunk.map((row) => ({
                  key: row.key,
                  operation: row.review!.operation,
                  expected_revision: row.review!.revision,
                })),
              }),
            },
          );
          results.push(...result.results);
        } catch (cause) {
          results.push(
            ...chunk.map((row) => ({
              key: row.key,
              error: `Save acknowledgement unavailable. Reload saved state before retrying. ${(cause as Error).message}`,
            })),
          );
        }
      }
      setRows((prior) =>
        prior.map((row) => {
          const proposal = approved.find((proposal) =>
            row.lots.some((lot) => proposal.review!.operation.item_ids.includes(lot.id)),
          );
          const result = results.find((result) => result.key === proposal?.key);
          return result
            ? { ...row, saved: !!result.saved, selected: !result.saved, error: result.error || '' }
            : row;
        }),
      );
      setReviews(null);
      onSaved();
      setError(
        `${results.filter((result) => result.saved).length} destinations saved; ${results.filter((result) => result.error).length} need attention.`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Choose product destinations" wide onClose={close}>
      <div className="product-destinations">
        <p>
          Decide what each upload represents. Several rows can use different existing POS products in one
          batch.
        </p>
        <p>
          Restock saves a destination for later count confirmation and receipt. Photo/details updates change
          the shared POS product and archive the upload as no incoming stock.
        </p>
        {error && <p role="status">{error}</p>}
        {busy && <p role="status">Working on batch destinations…</p>}
        <div className="bulk-preparation-actions">
          <label>
            Action for selected
            <select
              aria-label="Shared destination action"
              value={commonMode}
              disabled={busy}
              onChange={(event) => setCommonMode(event.target.value as Mode)}
            >
              <option value="">Choose action</option>
              <option value="restock">Restock existing product</option>
              <option value="update" disabled={!canUpdate}>
                Update photos/details only
              </option>
              <option value="new">Create new product on receipt</option>
            </select>
          </label>
          <Button
            disabled={busy || !commonMode || !selected.length}
            onClick={() => {
              setRows((prior) =>
                prior.map((row) =>
                  row.selected && !row.saved ? { ...row, mode: commonMode, error: '' } : row,
                ),
              );
              setReviews(null);
            }}
          >
            Apply action to selected
          </Button>
          <label>
            Same POS product for selected
            <select
              aria-label="Shared existing product"
              value={commonTarget}
              disabled={busy}
              onChange={(event) => setCommonTarget(event.target.value)}
            >
              <option value="">Choose existing product</option>
              {sharedProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} · {product.master_sku}
                </option>
              ))}
            </select>
          </label>
          <Button
            disabled={busy || !commonTarget || !selected.length}
            onClick={() => {
              const product = sharedProducts.find((product) => product.id === commonTarget)!;
              setRows((prior) =>
                prior.map((row) =>
                  row.selected && !row.saved && row.lots[0].category_id === product.category_id
                    ? {
                        ...row,
                        target: product.id,
                        options: [product, ...row.options.filter((option) => option.id !== product.id)],
                        error: '',
                      }
                    : row,
                ),
              );
              setReviews(null);
            }}
          >
            Assign compatible selected rows
          </Button>
        </div>
        <div className="bulk-preparation-actions">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              setRows((prior) =>
                prior.map((row) => ({ ...row, selected: !row.saved && !row.lots.some((lot) => lot.error) })),
              )
            }
          >
            Select all loaded rows
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setRows((prior) => prior.map((row) => ({ ...row, selected: false })))}
          >
            Clear selection
          </Button>
          <Button
            variant="outline"
            disabled={busy || !selected.length || !canUpdate}
            onClick={() =>
              setRows((prior) =>
                prior.map((row) => (row.selected && !row.saved ? { ...row, photos: true } : row)),
              )
            }
          >
            Add source photos for selected updates
          </Button>
        </div>
        {canUpdate && (
          <div className="bulk-preparation-actions">
            <label>
              Shared update field
              <select
                aria-label="Shared update field"
                value={commonField}
                disabled={busy}
                onChange={(event) => setCommonField(event.target.value as 'name' | 'description')}
              >
                <option value="description">Description</option>
                <option value="name">Product name</option>
              </select>
            </label>
            <label>
              Shared update value
              <input
                aria-label="Shared update value"
                value={commonValue}
                disabled={busy}
                onChange={(event) => setCommonValue(event.target.value)}
              />
            </label>
            <Button
              disabled={busy || !selected.length}
              onClick={() => {
                setRows((prior) =>
                  prior.map((row) =>
                    row.selected && !row.saved && row.mode === 'update'
                      ? {
                          ...row,
                          ...(commonField === 'name'
                            ? { rename: true, name: commonValue }
                            : { description: true, descriptionText: commonValue }),
                        }
                      : row,
                  ),
                );
                setReviews(null);
              }}
            >
              Apply field to selected updates
            </Button>
          </div>
        )}
        {rows.slice((page - 1) * 12, page * 12).map((row) => {
          const product = row.options.find((product) => product.id === row.target);
          return (
            <section className="destination-row" key={row.key} data-destination-id={row.key}>
              <label className="bulk-check">
                <input
                  type="checkbox"
                  checked={row.selected}
                  disabled={busy || row.saved || row.lots.some((lot) => !!lot.error)}
                  onChange={(event) => editRow(row.key, { selected: event.target.checked })}
                />
                <strong>
                  {row.lots[0].name || 'Unnamed upload'} · {row.lots.length} source{' '}
                  {row.lots.length === 1 ? 'lot' : 'lots'}
                </strong>
              </label>
              <div className="destination-evidence">
                {row.lots.map((lot) => (
                  <div key={lot.id}>
                    <Photo url={lot.image_url} name={lot.name || 'Source'} />
                    <small>
                      {Object.entries(lot.attributes || {})
                        .filter(([key]) =>
                          ['size', 'color', 'fit', 'sleeve', 'pattern', 'material'].includes(key),
                        )
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(' · ')}
                    </small>
                  </div>
                ))}
              </div>
              {row.saved ? (
                <p role="status">
                  {row.mode === 'update'
                    ? 'POS updated; source archived. No stock received.'
                    : 'Destination saved. Counts and receipt remain separate.'}
                </p>
              ) : (
                <>
                  {row.error && (
                    <p role="alert" className="error">
                      {row.error}
                    </p>
                  )}
                  <label>
                    Action
                    <select
                      aria-label={`Action ${row.key}`}
                      value={row.mode}
                      disabled={busy || row.lots.some((lot) => !!lot.error)}
                      onChange={(event) => editRow(row.key, { mode: event.target.value as Mode })}
                    >
                      <option value="">Choose explicitly</option>
                      <option value="restock">Restock existing product</option>
                      <option value="update" disabled={!canUpdate}>
                        Update photos/details only — no stock
                      </option>
                      <option value="new">Create new product on receipt</option>
                    </select>
                  </label>
                  {row.mode !== '' && row.mode !== 'new' && (
                    <>
                      <div className="bulk-preparation-actions">
                        <label>
                          Find existing product
                          <input
                            aria-label={`Search products ${row.key}`}
                            value={row.search}
                            disabled={busy}
                            onChange={(event) => editRow(row.key, { search: event.target.value })}
                          />
                        </label>
                        <Button disabled={busy} onClick={() => void findProducts(row)}>
                          Find products
                        </Button>
                      </div>
                      <label>
                        POS destination
                        <select
                          aria-label={`Existing product ${row.key}`}
                          value={row.target}
                          disabled={busy}
                          onChange={(event) => editRow(row.key, { target: event.target.value })}
                        >
                          <option value="">Choose matching design</option>
                          {row.options.map((product) => (
                            <option value={product.id} key={product.id}>
                              {product.name} · {product.brand} ·{' '}
                              {[
                                ...new Set(
                                  product.variants?.map((variant) => Object.values(variant).join('/')) || [],
                                ),
                              ].join(', ')}{' '}
                              · {product.master_sku}
                            </option>
                          ))}
                        </select>
                      </label>
                      {product && (
                        <div className="destination-target">
                          <Photo url={product.image_url} name={product.name} />
                          <p>
                            {product.previously_received
                              ? 'Previously received in this branch.'
                              : 'Existing shared POS product.'}{' '}
                            Confirm the design from its photo and attributes; a similar name alone is
                            insufficient.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                  {row.mode === 'new' && (
                    <>
                      <p>A new POS product will be created only when you later confirm receipt.</p>
                      <label>
                        Product name
                        <input
                          aria-label={`New name ${row.key}`}
                          value={row.name}
                          disabled={busy}
                          onChange={(event) => editRow(row.key, { name: event.target.value })}
                        />
                      </label>
                      <label>
                        Brand
                        <input
                          aria-label={`Brand ${row.key}`}
                          value={row.brand}
                          disabled={busy}
                          onChange={(event) => editRow(row.key, { brand: event.target.value })}
                        />
                      </label>
                    </>
                  )}
                  {row.mode === 'update' && (
                    <div className="space-y-3">
                      <label className="bulk-check">
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={row.photos}
                          onChange={(event) => editRow(row.key, { photos: event.target.checked })}
                        />
                        Add source photos to existing gallery
                      </label>
                      <label className="bulk-check">
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={row.rename}
                          onChange={(event) => editRow(row.key, { rename: event.target.checked })}
                        />
                        Update product name
                      </label>
                      {row.rename && (
                        <input
                          aria-label={`Updated name ${row.key}`}
                          value={row.name}
                          disabled={busy}
                          onChange={(event) => editRow(row.key, { name: event.target.value })}
                        />
                      )}
                      <label className="bulk-check">
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={row.description}
                          onChange={(event) => editRow(row.key, { description: event.target.checked })}
                        />
                        Update product description
                      </label>
                      {row.description && (
                        <textarea
                          aria-label={`Updated description ${row.key}`}
                          value={row.descriptionText}
                          disabled={busy}
                          onChange={(event) => editRow(row.key, { descriptionText: event.target.value })}
                        />
                      )}
                      <p>
                        Prices, costs, sizes and stock stay unchanged. Details and gallery updates are visible
                        across branches. The upload will be archived with a no-stock reason; its source photo
                        stays available.
                      </p>
                    </div>
                  )}
                  <label>
                    Match evidence / note
                    <input
                      aria-label={`Evidence ${row.key}`}
                      placeholder="Optional note about labels or visual design"
                      value={row.note}
                      disabled={busy}
                      onChange={(event) => editRow(row.key, { note: event.target.value })}
                    />
                  </label>
                </>
              )}
            </section>
          );
        })}
        <Pagination page={page} total={rows.length} limit={12} onChange={setPage} />
        <div className="bulk-preparation-actions">
          <Button disabled={busy || !selected.length} onClick={() => void reviewDestinations()}>
            Review selected destinations
          </Button>
          <Button
            disabled={busy || !savedStock.length}
            variant="outline"
            onClick={() =>
              dirty ? setContinuation(() => () => onPrepare(savedStock)) : onPrepare(savedStock)
            }
          >
            Prepare saved stock together
          </Button>
          <Button
            disabled={busy || !savedStock.length}
            variant="outline"
            onClick={() =>
              dirty ? setContinuation(() => () => onReceive(savedStock)) : onReceive(savedStock)
            }
          >
            Review receipt for saved stock
          </Button>
          <Button disabled={busy} variant="outline" onClick={() => setDiscard(true)}>
            Reload saved state
          </Button>
          <Button disabled={busy} variant="ghost" onClick={close}>
            Close
          </Button>
        </div>
      </div>
      {reviews && (
        <Modal
          title="Confirm batch destinations"
          wide
          onClose={() => {
            if (!busy) setReviews(null);
          }}
        >
          <p>
            Confirm only the successful proposals below. Saving stock destinations receives no stock.
            Photo/details updates are applied now and their source uploads are archived.
          </p>
          {reviews.map((row) => (
            <section key={row.key} className="destination-row">
              {row.error ? (
                <p role="alert">{row.error}</p>
              ) : (
                <>
                  <strong>
                    {row.review!.operation.mode === 'new'
                      ? 'New product'
                      : row.review!.operation.mode === 'restock'
                        ? 'Restock'
                        : 'Photo/details update'}{' '}
                    · {row.review!.target_name || row.review!.operation.name} · {row.review!.source_lots}{' '}
                    source lots
                  </strong>
                  <p>{row.review!.effect}</p>
                  {row.review!.changes && (
                    <>
                      <p>
                        Name: {row.review!.changes.before.name} →{' '}
                        {row.review!.changes.after.name ?? 'Keep existing'}
                      </p>
                      <p>
                        Description: {row.review!.changes.before.description || '(empty)'} →{' '}
                        {row.review!.changes.after.description ?? 'Keep existing'}
                      </p>
                      <p>
                        Photos:{' '}
                        {row.review!.changes.after.add_photos
                          ? 'Add source photos; retain existing gallery'
                          : 'Keep existing'}
                      </p>
                    </>
                  )}
                </>
              )}
            </section>
          ))}
          <Button
            disabled={busy || !reviews.some((row) => row.review)}
            onClick={() => void applyDestinations()}
          >
            Confirm reviewed destinations
          </Button>
        </Modal>
      )}
      {continuation && (
        <Modal title="Continue with saved destinations?" onClose={() => setContinuation(null)}>
          <p>
            Saved stock destinations can continue. Unsaved destination choices will be discarded; their source
            products remain unchanged.
          </p>
          <Button onClick={continuation}>Continue with saved stock</Button>
          <Button variant="outline" onClick={() => setContinuation(null)}>
            Keep editing
          </Button>
        </Modal>
      )}
      {discard && (
        <Modal title="Leave pending destination choices?" onClose={() => setDiscard(false)}>
          <p>Saved changes remain. Unsaved choices will be discarded.</p>
          <Button
            onClick={() => {
              setDiscard(false);
              void loadDestinations();
            }}
          >
            Discard choices and reload
          </Button>
          <Button variant="outline" onClick={onClose}>
            Discard choices and close
          </Button>
          <Button variant="ghost" onClick={() => setDiscard(false)}>
            Keep editing
          </Button>
        </Modal>
      )}
    </Modal>
  );
}
