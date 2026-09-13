'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal, Photo } from './workspace-ui';
import { useWorkspaceProtection } from '@/lib/workspace-protection';
import {
  countEntries,
  readPreparationBatch,
  savePreparationBatch,
  type PreparationRow,
} from '@/lib/bulk-preparation';
import type { CatalogItem, Session } from '@/lib/catalog-api';
import type { CategoryField } from './receiving';
import type { Category } from './upload-delivery';
import { BulkPreparationExceptions } from './bulk-preparation-exceptions';

/** Resolve fields for shared and inline category changes using the same nearest-definition rule as individual editing. */
function preparationFields(
  category: string,
  references: { categories: Category[]; fields: CategoryField[] },
) {
  const result = new Map<string, CategoryField>();
  const seen = new Set<string>();
  let id: string | null = category;
  while (id && !seen.has(id)) {
    seen.add(id);
    for (const field of references.fields.filter(
      (field) => field.category_id === id && (id === category || field.inherit),
    )) {
      if (!result.has(field.key)) result.set(field.key, field);
    }
    id = references.categories.find((entry) => entry.id === id)?.parent_id || null;
  }
  return [...result.values()].filter((field) => field.key !== 'size').sort((a, b) => a.sort - b.sort);
}

/** Batch editing keeps every lot visible and recoverable; no product dialog or per-row approval is required. */
export function BulkPreparation({
  items,
  branch,
  session,
  references,
  onClose,
  onSaved,
  onPrice,
  onReceive,
}: {
  items: CatalogItem[];
  branch: string;
  session: Session;
  references: { categories: Category[]; fields: CategoryField[] };
  onClose: () => void;
  onSaved: () => void;
  onPrice: (ids: string[]) => void;
  onReceive: (ids: string[]) => void;
}) {
  const [rows, setRows] = useState<PreparationRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [progress, setProgress] = useState('Loading selected products…');
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('all');
  const [sharedField, setSharedField] = useState('brand');
  const [sharedValue, setSharedValue] = useState('');
  const [commonQuantity, setCommonQuantity] = useState('1');
  const [includeConfirmed, setIncludeConfirmed] = useState(false);
  const [reviewCounts, setReviewCounts] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [exceptions, setExceptions] = useState(false);
  const [reloadFailures, setReloadFailures] = useState(false);
  const [continueAction, setContinueAction] = useState<(() => void) | null>(null);
  const initialIds = useRef(items.map((item) => item.id));
  const dirty = rows.some((row) => row.detailsChanged || row.countsChanged);
  useWorkspaceProtection(dirty, busy);
  const selected = rows.filter(
    (row) => row.selected && row.detail && !row.detail.item.is_published && !row.detail.item.is_cancelled,
  );
  const countTargets = selected.filter(
    (row) => row.countsChanged || row.detail?.item.stock_distribution_source !== 'human_confirmed',
  );
  const ready = selected.filter((row) => !row.error && !row.detail?.blockers.length);
  const priceable = selected.filter(
    (row) =>
      !row.error &&
      !row.detailsChanged &&
      !row.countsChanged &&
      row.detail?.item.stock_distribution_source === 'human_confirmed',
  );
  const filtered = rows.filter((row) => filter !== 'exceptions' || row.error || row.detail?.blockers.length);
  const visible = filtered.slice((page - 1) * 20, page * 20);
  const sharedFields = [
    ...new Map(
      selected
        .flatMap((row) => preparationFields(row.category, references))
        .map((field) => [field.key, field]),
    ).values(),
  ];

  useEffect(() => {
    const controller = new AbortController();
    void readPreparationBatch(initialIds.current, branch, controller.signal).then((results) => {
      if (controller.signal.aborted) return;
      setRows(
        results.map((result, index) =>
          result.status === 'fulfilled'
            ? result.value
            : {
                id: initialIds.current[index],
                selected: false,
                name: items[index]?.name || 'Unavailable product',
                brand: '',
                category: '',
                attributes: {},
                changedAttributes: [],
                counts: [],
                detailsChanged: false,
                countsChanged: false,
                resolveFlag: false,
                error: String(result.reason?.message || result.reason),
                result: '',
              },
        ),
      );
      setBusy(false);
      setProgress('Choose shared actions or edit the table, then save the batch.');
    });
    return () => controller.abort();
    // Freeze the selection for the lifetime of this preparation screen.
  }, [branch, items]);

  function editRow(id: string, update: (row: PreparationRow) => PreparationRow) {
    setRows((prior) => prior.map((row) => (row.id === id ? { ...update(row), result: '', error: '' } : row)));
  }

  /** Apply common values only to explicitly selected lots and compatible category fields. */
  function applySharedValue() {
    setRows((prior) =>
      prior.map((row) => {
        if (!row.selected || !row.detail) return row;
        if (sharedField === 'brand' || sharedField === 'name')
          return { ...row, [sharedField]: sharedValue, detailsChanged: true, result: '' };
        if (sharedField === 'category')
          return sharedValue ? { ...row, category: sharedValue, detailsChanged: true, result: '' } : row;
        const field = preparationFields(row.category, references).find((field) => field.key === sharedField);
        if (!field) return row;
        const value =
          field.type === 'boolean' ? (sharedValue === '' ? null : sharedValue === 'true') : sharedValue;
        return {
          ...row,
          attributes: { ...row.attributes, [sharedField]: value },
          changedAttributes: [...new Set([...row.changedAttributes, sharedField])],
          detailsChanged: true,
          result: '',
        };
      }),
    );
  }

  /** Preserve confirmed counts unless the operator explicitly includes them; multi-size quantities remain separate. */
  function applyCommonQuantity() {
    if (!Number.isSafeInteger(Number(commonQuantity)) || Number(commonQuantity) < 1) {
      setProgress('Enter a positive whole quantity.');
      return;
    }
    setRows((prior) =>
      prior.map((row) =>
        row.selected &&
        row.counts.length === 1 &&
        (includeConfirmed || row.detail?.item.stock_distribution_source !== 'human_confirmed')
          ? {
              ...row,
              counts: [{ ...row.counts[0], quantity: commonQuantity }],
              countsChanged: true,
              result: '',
            }
          : row,
      ),
    );
    setProgress(
      'Quantity applied to single-size lots only. Multi-size rows and protected confirmed counts were kept.',
    );
  }

  /** Save independent revision-checked edits with per-lot outcomes; successful rows are not resubmitted on retry. */
  async function saveBatch(mode: 'details' | 'counts') {
    setReviewCounts(false);
    setBusy(true);
    const targets = mode === 'counts' ? countTargets : selected.filter((row) => row.detailsChanged);
    setProgress(`Saving ${targets.length} products in batches…`);
    const results = await savePreparationBatch(targets, branch, mode);
    const updates = new Map(
      targets.map((row, index) => {
        const result = results[index];
        return [
          row.id,
          result.status === 'fulfilled'
            ? result.value
            : {
                ...row,
                error: String(result.reason?.message || result.reason),
                result: 'Not confirmed. Check saved state before retrying.',
              },
        ] as const;
      }),
    );
    setRows((prior) => prior.map((row) => updates.get(row.id) || row));
    setProgress(
      `${results.filter((result) => result.status === 'fulfilled').length} saved; ${results.filter((result) => result.status === 'rejected').length} need attention. Successful products can continue.`,
    );
    setBusy(false);
    onSaved();
  }

  /** Reload only explicit selections and require discarding pending work first; this avoids silently rebasing stale writes. */
  async function reloadSelected() {
    if (dirty) {
      setProgress('Save changes first, or close and discard before reloading.');
      return;
    }
    setBusy(true);
    const targets = rows.filter((row) => row.selected || !row.detail);
    const results = await readPreparationBatch(
      targets.map((row) => row.id),
      branch,
    );
    setRows((prior) =>
      prior.map((row) => {
        const index = targets.findIndex((target) => target.id === row.id);
        if (index < 0) return row;
        const result = results[index];
        return result.status === 'fulfilled'
          ? result.value
          : { ...row, error: String(result.reason?.message || result.reason) };
      }),
    );
    setBusy(false);
    onSaved();
    setProgress('Readiness refreshed.');
  }

  /** Discard only failed rows after explicit confirmation, retaining successful work and other pending edits. */
  async function reloadFailedRows() {
    setReloadFailures(false);
    setBusy(true);
    const failed = rows.filter((row) => row.error);
    const outcomes = await readPreparationBatch(
      failed.map((row) => row.id),
      branch,
    );
    setRows((prior) =>
      prior.map((row) => {
        const index = failed.findIndex((entry) => entry.id === row.id);
        if (index < 0) return row;
        const outcome = outcomes[index];
        return outcome.status === 'fulfilled'
          ? outcome.value
          : { ...row, error: String(outcome.reason?.message || outcome.reason) };
      }),
    );
    setBusy(false);
    setProgress('Failed products reloaded from saved data. Other edits were kept.');
    onSaved();
  }

  function closePreparation() {
    if (!busy) {
      if (dirty) setDiscard(true);
      else onClose();
    }
  }
  function continueWithSavedProducts(action: () => void) {
    if (dirty) setContinueAction(() => action);
    else action();
  }
  const sharedDefinition = sharedFields.find((field) => field.key === sharedField);
  return (
    <Modal
      title="Prepare selected products"
      description={`${items.length} selected source lots. Complete the batch here; individual review is optional.`}
      wide
      onClose={closePreparation}
    >
      <div className="bulk-preparation">
        <p role="status">{progress}</p>
        <fieldset disabled={busy} className="bulk-preparation-actions">
          <legend>Apply to selected products</legend>
          <label>
            Field
            <select
              aria-label="Shared preparation field"
              value={sharedField}
              onChange={(event) => {
                setSharedField(event.target.value);
                setSharedValue('');
              }}
            >
              <option value="brand">Brand</option>
              <option value="name">Product name</option>
              <option value="category">Category</option>
              {sharedFields.map((field) => (
                <option key={field.key} value={field.key}>
                  {field.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Value
            {sharedField === 'category' ? (
              <select
                aria-label="Shared preparation value"
                value={sharedValue}
                onChange={(event) => setSharedValue(event.target.value)}
              >
                <option value="">Choose category</option>
                {references.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            ) : sharedDefinition?.type === 'boolean' || sharedDefinition?.type === 'select' ? (
              <select
                aria-label="Shared preparation value"
                value={sharedValue}
                onChange={(event) => setSharedValue(event.target.value)}
              >
                <option value="">Not set</option>
                {(sharedDefinition.type === 'boolean'
                  ? ['true', 'false']
                  : sharedDefinition.options || []
                ).map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            ) : (
              <Input
                aria-label="Shared preparation value"
                value={sharedValue}
                onChange={(event) => setSharedValue(event.target.value)}
              />
            )}
          </label>
          <Button variant="outline" onClick={applySharedValue} disabled={!selected.length}>
            Apply value to selected
          </Button>
          <label>
            Units per single-size lot
            <Input
              aria-label="Common quantity"
              inputMode="numeric"
              value={commonQuantity}
              onChange={(event) => setCommonQuantity(event.target.value)}
            />
          </label>
          <label className="bulk-check">
            <input
              type="checkbox"
              checked={includeConfirmed}
              onChange={(event) => setIncludeConfirmed(event.target.checked)}
            />
            Include already confirmed counts in quantity changes
          </label>
          <Button variant="outline" onClick={applyCommonQuantity}>
            Apply quantity to selected
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              setRows((prior) =>
                prior.map((row) =>
                  row.selected && row.detail?.item.status === 'flag'
                    ? { ...row, resolveFlag: true, detailsChanged: true }
                    : row,
                ),
              )
            }
          >
            Resolve selected problem flags
          </Button>
        </fieldset>
        <div className="bulk-preparation-actions">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              setRows((prior) =>
                prior.map((row) => ({
                  ...row,
                  selected: !!row.detail && !row.detail.item.is_published && !row.detail.item.is_cancelled,
                })),
              )
            }
          >
            Select all loaded products
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setRows((prior) => prior.map((row) => ({ ...row, selected: false })))}
          >
            Clear selection
          </Button>
          <label>
            Show
            <select
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All products</option>
              <option value="exceptions">Remaining requirements</option>
            </select>
          </label>
        </div>
        <div className="bulk-preparation-table">
          <table>
            <caption>Batch sizes, quantities and details</caption>
            <thead>
              <tr>
                <th>Select</th>
                <th>Product</th>
                <th>Sizes and quantities</th>
                <th>Required and shared details</th>
                <th>Next action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row, index) => (
                <tr key={row.id} data-preparation-id={row.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.name} ${row.id}`}
                      disabled={
                        busy || !row.detail || row.detail.item.is_published || row.detail.item.is_cancelled
                      }
                      checked={row.selected}
                      onChange={(event) =>
                        editRow(row.id, (current) => ({ ...current, selected: event.target.checked }))
                      }
                    />
                  </td>
                  <td>
                    <Photo url={row.detail?.item.image_url || null} name={row.name} />
                    <small>Label size: {String(row.detail?.item.attributes.size || 'Not available')}</small>
                    <label>
                      Name
                      <Input
                        aria-label={`Product name ${row.id}`}
                        disabled={busy || !row.detail}
                        value={row.name}
                        onChange={(event) =>
                          editRow(row.id, (current) => ({
                            ...current,
                            name: event.target.value,
                            detailsChanged: true,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Brand
                      <Input
                        aria-label={`Brand ${row.id}`}
                        disabled={busy || !row.detail}
                        value={row.brand}
                        onChange={(event) =>
                          editRow(row.id, (current) => ({
                            ...current,
                            brand: event.target.value,
                            detailsChanged: true,
                          }))
                        }
                      />
                    </label>
                  </td>
                  <td>
                    <p>
                      {row.detail?.item.stock_distribution_source === 'human_confirmed'
                        ? 'Count confirmed'
                        : 'Proposed count — confirm physical units'}
                    </p>
                    {row.counts.map((count, countIndex) => (
                      <div className="bulk-count-row" key={countIndex}>
                        <Input
                          aria-label={`Size ${row.id} ${countIndex + 1}`}
                          disabled={busy || !row.detail?.fields.some((field) => field.key === 'size')}
                          value={count.size}
                          placeholder="Size"
                          onChange={(event) =>
                            editRow(row.id, (current) => ({
                              ...current,
                              countsChanged: true,
                              counts: current.counts.map((entry, i) =>
                                i === countIndex ? { ...entry, size: event.target.value } : entry,
                              ),
                            }))
                          }
                        />
                        <Input
                          aria-label={`Quantity ${row.id} ${countIndex + 1}`}
                          disabled={busy}
                          inputMode="numeric"
                          value={count.quantity}
                          onChange={(event) =>
                            editRow(row.id, (current) => ({
                              ...current,
                              countsChanged: true,
                              counts: current.counts.map((entry, i) =>
                                i === countIndex ? { ...entry, quantity: event.target.value } : entry,
                              ),
                            }))
                          }
                        />
                        <Button
                          variant="ghost"
                          disabled={busy || row.counts.length === 1}
                          aria-label={`Remove size row ${row.id} ${countIndex + 1}`}
                          onClick={() =>
                            editRow(row.id, (current) => ({
                              ...current,
                              countsChanged: true,
                              counts: current.counts.filter((_, i) => i !== countIndex),
                            }))
                          }
                        >
                          −
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="ghost"
                      disabled={busy || !row.detail || row.counts.length >= 100}
                      onClick={() =>
                        editRow(row.id, (current) => ({
                          ...current,
                          countsChanged: true,
                          counts: [...current.counts, { size: '', quantity: '' }],
                        }))
                      }
                    >
                      Add size
                    </Button>
                  </td>
                  <td>
                    <label>
                      Category
                      <select
                        aria-label={`Category ${row.id}`}
                        disabled={busy || !row.detail}
                        value={row.category}
                        onChange={(event) =>
                          editRow(row.id, (current) => ({
                            ...current,
                            category: event.target.value,
                            detailsChanged: true,
                          }))
                        }
                      >
                        {references.categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {preparationFields(row.category, references).map((field) => (
                      <label key={field.key}>
                        {field.label}
                        {field.required ? ' *' : ''}
                        {field.type === 'boolean' || field.type === 'select' ? (
                          <select
                            aria-label={`${field.label} ${row.id}`}
                            disabled={busy}
                            value={String(row.attributes[field.key] ?? '')}
                            onChange={(event) =>
                              editRow(row.id, (current) => ({
                                ...current,
                                detailsChanged: true,
                                changedAttributes: [...new Set([...current.changedAttributes, field.key])],
                                attributes: {
                                  ...current.attributes,
                                  [field.key]:
                                    field.type === 'boolean'
                                      ? event.target.value === ''
                                        ? null
                                        : event.target.value === 'true'
                                      : event.target.value,
                                },
                              }))
                            }
                          >
                            <option value="">Not set</option>
                            {[
                              ...new Set([
                                String(row.attributes[field.key] ?? ''),
                                ...(field.type === 'boolean' ? ['true', 'false'] : field.options || []),
                              ]),
                            ]
                              .filter(Boolean)
                              .map((option) => (
                                <option key={option}>{option}</option>
                              ))}
                          </select>
                        ) : (
                          <Input
                            aria-label={`${field.label} ${row.id}`}
                            disabled={busy}
                            value={String(row.attributes[field.key] ?? '')}
                            onChange={(event) =>
                              editRow(row.id, (current) => ({
                                ...current,
                                detailsChanged: true,
                                changedAttributes: [...new Set([...current.changedAttributes, field.key])],
                                attributes: { ...current.attributes, [field.key]: event.target.value },
                              }))
                            }
                          />
                        )}
                      </label>
                    ))}
                    {row.resolveFlag && <p>Problem flag will be resolved with this batch.</p>}
                  </td>
                  <td>
                    {row.result && <p>{row.result}</p>}
                    {row.error && (
                      <p role="alert" className="error">
                        {row.error}
                      </p>
                    )}
                    {row.detail?.blockers.map((blocker, i) => (
                      <p key={i}>{blocker}</p>
                    ))}
                    {row.detail && !row.detail.blockers.length && <strong>Ready for POS</strong>}
                    <small>Lot {(page - 1) * 20 + index + 1}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="bulk-preparation-actions">
          <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span>
            Page {page} of {Math.max(1, Math.ceil(filtered.length / 20))}
          </span>
          <Button variant="ghost" disabled={page * 20 >= filtered.length} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
        <div className="bulk-preparation-actions">
          <Button
            disabled={busy || !selected.some((row) => row.detailsChanged)}
            onClick={() => void saveBatch('details')}
          >
            Save selected details
          </Button>
          <Button
            disabled={busy || !countTargets.length || selected.some((row) => row.detailsChanged)}
            onClick={() => setReviewCounts(true)}
          >
            Confirm selected counts
          </Button>
          <Button variant="outline" disabled={busy || dirty} onClick={() => void reloadSelected()}>
            Refresh selected readiness
          </Button>
          {rows.some((row) => row.error) && (
            <Button variant="outline" disabled={busy} onClick={() => setReloadFailures(true)}>
              Reload failed products
            </Button>
          )}
          <Button variant="outline" disabled={busy || dirty} onClick={() => setExceptions(true)}>
            Resolve photos, categories and groups
          </Button>
          <Button
            variant="outline"
            disabled={busy || !priceable.length}
            onClick={() => continueWithSavedProducts(() => onPrice(priceable.map((row) => row.id)))}
          >
            Set selected prices and costs
          </Button>
          {session.can_publish && (
            <Button
              disabled={busy || !ready.length}
              onClick={() => continueWithSavedProducts(() => onReceive(ready.map((row) => row.id)))}
            >
              Receive {ready.length} ready lots
            </Button>
          )}
        </div>
        {selected.some((row) => row.detailsChanged) && (
          <p>Save details first, then confirm counts together.</p>
        )}
      </div>
      {continueAction && (
        <Modal title="Continue with saved products?" onClose={() => setContinueAction(null)}>
          <p>
            Successfully saved products can continue. Unsaved table edits will be discarded when leaving this
            screen; unfinished products remain in preparation.
          </p>
          <Button variant="outline" onClick={() => setContinueAction(null)}>
            Keep editing
          </Button>
          <Button
            onClick={() => {
              const action = continueAction;
              setContinueAction(null);
              action();
            }}
          >
            Continue with saved products
          </Button>
        </Modal>
      )}
      {reviewCounts && (
        <Modal title="Confirm batch counts" onClose={() => setReviewCounts(false)}>
          <p>
            Confirm the physical incoming stock for {countTargets.length} lots. Default and photo-derived
            quantities are proposals until you confirm this batch.
          </p>
          <p>
            {countTargets.reduce(
              (sum, row) =>
                sum + row.counts.reduce((total, count) => total + (Number(count.quantity) || 0), 0),
              0,
            )}{' '}
            total proposed units.
          </p>
          <ul>
            {countTargets.flatMap((row) => {
              try {
                countEntries(row);
                return [];
              } catch (cause) {
                return [
                  <li key={row.id}>
                    {row.name}: {(cause as Error).message} This lot will remain unconfirmed.
                  </li>,
                ];
              }
            })}
          </ul>
          <Button onClick={() => void saveBatch('counts')}>Confirm batch quantities</Button>
        </Modal>
      )}
      {discard && (
        <Modal title="Discard batch edits?" onClose={() => setDiscard(false)}>
          <p>Saved changes are retained. Unsaved table edits will be discarded.</p>
          <Button variant="outline" onClick={() => setDiscard(false)}>
            Keep editing
          </Button>
          <Button onClick={onClose}>Discard and close</Button>
        </Modal>
      )}
      {reloadFailures && (
        <Modal title="Reload failed products?" onClose={() => setReloadFailures(false)}>
          <p>
            Reload saved values for failed products only. Their unsaved edits will be discarded; successful
            saves and other table edits are kept.
          </p>
          <Button onClick={() => void reloadFailedRows()}>Reload failed rows from saved data</Button>
        </Modal>
      )}
      {exceptions && (
        <BulkPreparationExceptions
          rows={selected}
          branch={branch}
          session={session}
          onClose={() => {
            setExceptions(false);
            void reloadSelected();
          }}
        />
      )}
    </Modal>
  );
}
