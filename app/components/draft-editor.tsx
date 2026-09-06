'use client';
import { useEffect, useState } from 'react';
import { Plus, Sparkles, Tag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { requestPos, postPos, formatMoney, type CatalogItem, type Session } from '@/lib/catalog-api';
import { Modal, Photo, usePosRead } from './workspace-ui';
import { AiFieldHint } from './ai-field-hint';
import type { Category } from './upload-delivery';
import type { CategoryField } from './receiving';
type Detail = { item: CatalogItem; fields: CategoryField[]; revision: string; blockers: string[] };
type CountRow = { id: string; size: string; quantity: string };

/** Resolve inherited fields in the same nearest-category order used by the POS. */
function effectiveFields(categoryId: string, categories: Category[], definitions: CategoryField[]) {
  const result = new Map<string, CategoryField>();
  let id: string | null = categoryId;
  for (let depth = 0; id && depth < 20; depth++) {
    for (const field of definitions.filter(
      (field) => field.category_id === id && (depth === 0 || field.inherit),
    )) {
      if (!result.has(field.key)) result.set(field.key, field);
    }
    id = categories.find((category) => category.id === id)?.parent_id || null;
  }
  return [...result.values()].sort((a, b) => a.sort - b.sort);
}

/** Identity and size counts save independently, each against a fresh, server-signed revision. */
export function DraftEditor({
  itemId,
  branch,
  session,
  references,
  onClose,
  onSaved,
  onPrice,
}: {
  itemId: string;
  branch: string;
  session: Session;
  references: { categories: Category[]; fields: CategoryField[] };
  onClose: () => void;
  onSaved: () => void;
  onPrice: () => void;
}) {
  const detail = usePosRead<Detail>(`/catalog-workspace/items/${itemId}`, branch);
  const [tab, setTab] = useState('details'),
    [name, setName] = useState(''),
    [brand, setBrand] = useState(''),
    [category, setCategory] = useState('');
  const [attributes, setAttributes] = useState<CatalogItem['attributes']>({}),
    [rows, setRows] = useState<CountRow[]>([]);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(''),
    [dirty, setDirty] = useState(false),
    [discard, setDiscard] = useState(false),
    [resolveFlag, setResolveFlag] = useState(false);
  const [extracting, setExtracting] = useState(false),
    [checkAiProgress, setCheckAiProgress] = useState(false);
  const item = detail.data?.item,
    editable = session.can_edit && !item?.is_published;
  useEffect(() => {
    /* Populate editable fields from the same snapshot that supplied the revision token. */

    if (!detail.data) return;
    const current = detail.data.item;
    setName(current.name || '');
    setBrand(current.brand || '');
    setCategory(current.category_id);
    setAttributes(current.attributes || {});
    setRows(
      current.variant_lines.map((line) => ({
        id: line.id,
        size: String(line.variant_attributes.size || ''),
        quantity: String(line.quantity),
      })),
    );
    setDirty(false);
  }, [detail.data]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const fields = effectiveFields(category, references.categories, references.fields);
  const reviewAiFields = [
    'name',
    'brand',
    ...fields.filter((field) => field.key !== 'size').map((field) => field.key),
  ].filter((key) => !!item?.confidence?.[key]);
  const quantity = rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
  function edit(update: () => void) {
    update();
    setDirty(true);
    setSaved('');
  }
  function closeEditor() {
    if (busy) return;
    if (dirty) setDiscard(true);
    else onClose();
  }
  async function saveDetails() {
    /* Save only category-defined identity values against the revision the operator reviewed. */

    if (!detail.data) return;
    setBusy(true);
    setError('');
    try {
      const values = Object.fromEntries(
        fields
          .filter((field) => field.key !== 'size')
          .map((field) => [field.key, attributes[field.key] ?? null]),
      );
      await requestPos(`/catalog-workspace/items/${itemId}`, branch, {
        method: 'PATCH',
        body: JSON.stringify({
          expected_revision: detail.data.revision,
          name,
          brand,
          category_id: category,
          attributes: values,
          resolve_flag: resolveFlag,
          review_ai_fields: reviewAiFields,
        }),
      });
      setDirty(false);
      setSaved('Details saved');
      detail.refresh();
      onSaved();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirmSizes() {
    /* Validate physical counts before submitting a revision-checked size distribution. */

    if (!detail.data) return;
    setBusy(true);
    setError('');
    try {
      if (
        rows.some(
          (row) =>
            !row.quantity.trim() || !Number.isInteger(Number(row.quantity)) || Number(row.quantity) < 1,
        )
      )
        throw new Error('Enter a whole number of units for each size.');
      const entries = rows.map((row) => ({
        variant_attributes: row.size.trim() ? { size: row.size.trim() } : {},
        quantity: Number(row.quantity),
      }));
      await requestPos(`/catalog-workspace/items/${itemId}/count`, branch, {
        method: 'PATCH',
        body: JSON.stringify({ expected_revision: detail.data.revision, entries }),
      });
      setDirty(false);
      setSaved('Size quantities confirmed');
      detail.refresh();
      onSaved();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function extractPhoto() {
    /* Ask the existing POS extraction service to fill empty fields, then reread its saved result. */

    setBusy(true);
    setExtracting(true);
    setError('');
    try {
      const result = await postPos<{ data: { applied_fields: string[] } }>(
        `/catalog/items/${itemId}/ai-extract`,
        branch,
        { only_empty: true },
      );
      setSaved(
        result.data.applied_fields.length
          ? 'Photo details filled. Review the suggestions below.'
          : 'No new details found. Existing values were kept.',
      );
      setTab('details');
      setCheckAiProgress(false);
      detail.refresh();
      onSaved();
    } catch (cause) {
      setError((cause as Error).message);
      setCheckAiProgress(true);
    } finally {
      setBusy(false);
      setExtracting(false);
    }
  }
  return (
    <Modal
      title={item?.name || 'Prepare merchandise'}
      description={item?.is_published ? 'Received into POS · historical lot' : undefined}
      wide
      onClose={closeEditor}
    >
      {detail.loading ? (
        <p role="status">Opening merchandise…</p>
      ) : detail.error ? (
        <p className="error" role="alert">
          {detail.error}
        </p>
      ) : (
        item && (
          <div className="draft-layout">
            <div className="draft-evidence">
              <Photo url={item.image_url} name={item.name || 'Photographed merchandise'} />
              {item.image_url && (
                <a className="text-link" href={item.image_url} target="_blank" rel="noreferrer">
                  View full photo
                </a>
              )}
              {editable &&
                session.can_ai_extract &&
                (checkAiProgress || item.ai_run?.status === 'running' ? (
                  <Button
                    variant="outline"
                    disabled={busy || dirty}
                    onClick={() => {
                      setCheckAiProgress(false);
                      setError('');
                      detail.refresh();
                    }}
                  >
                    Check saved progress
                  </Button>
                ) : (
                  <Button variant="outline" disabled={busy || dirty} onClick={extractPhoto}>
                    <Sparkles size={15} />
                    {extracting ? 'Reading photo…' : 'AI fill'}
                  </Button>
                ))}
              <div className="lot-caption">
                {item.ai_run?.status === 'running' && <small role="status">Analysis is still running.</small>}
                {dirty && session.can_ai_extract && <small>Save your edits before AI fill.</small>}
                {item.ai_visible_text && (
                  <details className="ai-visible-text">
                    <summary>Text read from photo</summary>
                    <p>{item.ai_visible_text}</p>
                  </details>
                )}
                <span className="eyebrow">PHOTOGRAPHED LOT</span>
                <strong>{item.stock_quantity ?? 0} units</strong>
                <small>
                  {item.stock_distribution_source === 'human_confirmed'
                    ? 'Count confirmed'
                    : 'Count not confirmed'}
                </small>
              </div>
            </div>
            <div className="draft-form">
              <Tabs
                value={tab}
                onValueChange={(value) => {
                  if (busy) return;
                  if (dirty) {
                    setError('Save your edits before switching tasks.');
                    return;
                  }
                  setTab(String(value));
                  setError('');
                }}
              >
                <TabsList variant="line">
                  <TabsTrigger value="details">Details</TabsTrigger>
                  <TabsTrigger value="sizes">Sizes & quantities</TabsTrigger>
                  <TabsTrigger value="prices">Prices</TabsTrigger>
                </TabsList>
              </Tabs>
              {tab === 'details' && (
                <div className="detail-fields">
                  <label>
                    Product name
                    <Input
                      value={name}
                      disabled={!editable || busy}
                      maxLength={250}
                      onChange={(e) => edit(() => setName(e.target.value))}
                      placeholder="e.g. Straight-leg trousers"
                    />
                  </label>
                  <AiFieldHint item={item} field="name" value={name} />
                  <div className="field-pair">
                    <label>
                      Brand
                      <Input
                        value={brand}
                        disabled={!editable || busy}
                        maxLength={150}
                        onChange={(e) => edit(() => setBrand(e.target.value))}
                      />
                    </label>
                    <label>
                      Category
                      <select
                        value={category}
                        disabled={!editable || busy}
                        onChange={(e) => edit(() => setCategory(e.target.value))}
                      >
                        {references.categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <AiFieldHint item={item} field="brand" value={brand} />
                  {fields
                    .filter((field) => field.key !== 'size')
                    .map((field) => (
                      /* Render the configured category field with a matching input type and accessible label. */ <div
                        key={field.key}
                      >
                        <label>
                          {field.label}
                          {field.required ? ' *' : ''}
                          {field.type === 'select' || field.type === 'boolean' ? (
                            <select
                              aria-label={field.label}
                              disabled={!editable || busy}
                              value={String(attributes[field.key] ?? '')}
                              onChange={(e) =>
                                /* Preserve unknown booleans as null instead of silently turning them into false. */ edit(
                                  () =>
                                    setAttributes((prior) => ({
                                      ...prior,
                                      [field.key]:
                                        field.type === 'boolean'
                                          ? e.target.value === ''
                                            ? null
                                            : e.target.value === 'true'
                                          : e.target.value,
                                    })),
                                )
                              }
                            >
                              <option value="">Not set</option>
                              {(field.type === 'boolean' ? ['true', 'false'] : field.options || []).map(
                                (option) => (
                                  <option key={option} value={option}>
                                    {field.type === 'boolean' ? (option === 'true' ? 'Yes' : 'No') : option}
                                  </option>
                                ),
                              )}
                            </select>
                          ) : (
                            <Input
                              aria-label={field.label}
                              value={String(attributes[field.key] ?? '')}
                              disabled={!editable || busy}
                              inputMode={field.type === 'number' ? 'decimal' : 'text'}
                              onChange={(e) =>
                                edit(() =>
                                  setAttributes((prior) => ({ ...prior, [field.key]: e.target.value })),
                                )
                              }
                            />
                          )}
                        </label>
                        <AiFieldHint item={item} field={field.key} value={attributes[field.key]} />
                      </div>
                    ))}
                  {item.status === 'flag' && editable && (
                    <label className="inline-check">
                      <Checkbox
                        checked={resolveFlag}
                        disabled={busy}
                        onCheckedChange={(value) => edit(() => setResolveFlag(value))}
                      />
                      I have resolved this item&apos;s problem flag
                    </label>
                  )}
                  {editable && (
                    <Button disabled={busy} onClick={saveDetails}>
                      {busy
                        ? extracting
                          ? 'Reading photo…'
                          : 'Saving…'
                        : reviewAiFields.length
                          ? 'Save reviewed details'
                          : 'Save details'}
                    </Button>
                  )}
                </div>
              )}
              {tab === 'sizes' && (
                <div className="count-editor">
                  {item.stock_distribution_source === 'ai_suggested' && (
                    <p className="muted">
                      Suggested from the photo. Confirm the physical sizes and quantities.
                    </p>
                  )}
                  <div className="count-columns">
                    <span>SIZE</span>
                    <span>UNITS</span>
                  </div>
                  {rows.map((row, index) => (
                    /* Keep each editable size row tied to its stable local or server line identity. */ <div
                      className="count-row"
                      key={row.id}
                    >
                      <Input
                        aria-label={`Size ${index + 1}`}
                        value={row.size}
                        disabled={!editable || busy || !fields.some((field) => field.key === 'size')}
                        placeholder="Standard"
                        onChange={(e) =>
                          edit(() =>
                            setRows((prior) =>
                              prior.map((entry) =>
                                entry.id === row.id ? { ...entry, size: e.target.value } : entry,
                              ),
                            ),
                          )
                        }
                      />
                      <Input
                        aria-label={`Quantity ${index + 1}`}
                        inputMode="numeric"
                        value={row.quantity}
                        disabled={!editable || busy}
                        onChange={(e) =>
                          edit(() =>
                            setRows((prior) =>
                              prior.map((entry) =>
                                entry.id === row.id ? { ...entry, quantity: e.target.value } : entry,
                              ),
                            ),
                          )
                        }
                      />
                      {editable && (
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={busy || rows.length === 1}
                          aria-label={`Remove size ${index + 1}`}
                          onClick={() =>
                            edit(() => setRows((prior) => prior.filter((entry) => entry.id !== row.id)))
                          }
                        >
                          <X size={16} />
                        </Button>
                      )}
                    </div>
                  ))}
                  {editable && (
                    <Button
                      variant="ghost"
                      disabled={busy || rows.length >= 100}
                      onClick={() =>
                        edit(() =>
                          setRows((prior) => [
                            ...prior,
                            { id: crypto.randomUUID(), size: '', quantity: '1' },
                          ]),
                        )
                      }
                    >
                      <Plus size={16} />
                      Add size
                    </Button>
                  )}
                  <div className="count-total">
                    <span>Total photographed stock</span>
                    <strong>{quantity} units</strong>
                  </div>
                  {editable && (
                    <Button disabled={busy} className="h-11" onClick={confirmSizes}>
                      {busy ? 'Confirming…' : `Confirm ${quantity} units`}
                    </Button>
                  )}
                </div>
              )}
              {tab === 'prices' && (
                <div className="detail-prices">
                  {item.variant_lines.map((line) => (
                    /* Show saved effective retail prices without exposing cost values in item details. */ <div
                      key={line.id}
                    >
                      <span>
                        {Object.values(line.variant_attributes).join(' / ') || 'Standard'}{' '}
                        <small>× {line.quantity}</small>
                      </span>
                      <strong>
                        {line.effective_price == null
                          ? 'Not priced'
                          : `UGX ${formatMoney(line.effective_price)}`}
                      </strong>
                    </div>
                  ))}
                  {editable && (
                    <Button disabled={busy || dirty} onClick={onPrice}>
                      <Tag size={15} />
                      Set prices
                    </Button>
                  )}
                </div>
              )}
              {!!detail.data?.blockers.length && (
                <details className="readiness-details">
                  <summary>{detail.data.blockers.length} things to complete</summary>
                  <ul>
                    {detail.data.blockers.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </details>
              )}
              {saved && (
                <p role="status" className="saved-message">
                  {saved}
                </p>
              )}
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
            </div>
          </div>
        )
      )}
      {discard && (
        <Modal
          title="Discard unsaved changes?"
          description="Your last saved version will be kept."
          onClose={() => setDiscard(false)}
        >
          <div className="dialog-actions">
            <Button variant="outline" onClick={() => setDiscard(false)}>
              Keep editing
            </Button>
            <Button onClick={onClose}>Discard changes</Button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
