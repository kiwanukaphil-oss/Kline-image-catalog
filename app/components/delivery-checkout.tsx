'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ApiError, formatMoney, postPos, type Session } from '@/lib/catalog-api';
import {
  editableDeliveryItem,
  deliverySavePayload,
  type DeliveryItem,
  type DeliveryReview,
} from '@/lib/delivery-checkout';
import { useWorkspaceProtection } from '@/lib/workspace-protection';
import { Photo, Pagination } from './workspace-ui';

/** Keep one delivery in a pricing page and a read-only summary, with durable drafts and idempotent send retries. */
export function DeliveryCheckout({
  ids,
  branch,
  session,
  onBack,
  onStock,
}: {
  ids: string[];
  branch: string;
  session: Session;
  onBack: () => void;
  onStock: () => void;
}) {
  const [items, setItems] = useState<DeliveryItem[]>([]);
  const [review, setReview] = useState<DeliveryReview[] | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [sharedPrice, setSharedPrice] = useState(''),
    [sharedCost, setSharedCost] = useState(''),
    [sharedQuantity, setSharedQuantity] = useState('');
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1);
  const [groups, setGroups] = useState<string[][]>([]);
  const draftKey = `kline.delivery:${session.id}:${branch}:${[...ids].sort().join(',')}`;
  const selected = items.filter((item) => item.selected && !item.is_published && !item.is_cancelled);
  const dirty = items.some((item) => item.dirty);
  const branchName = session.branches.find((value) => value.id === branch)?.name || branch;
  useWorkspaceProtection(dirty, busy);

  useEffect(() => {
    // Restore only drafts whose server revision still matches; changed records require a fresh decision.
    let active = true;
    async function load() {
      try {
        const response = await postPos<{
          results: { id: string; item?: DeliveryItem; error?: string }[];
          groups: string[][];
          expanded: number;
        }>('/catalog-workspace/delivery/read', branch, { item_ids: ids });
        let drafts: DeliveryItem[] = [];
        try {
          drafts = JSON.parse(sessionStorage.getItem(draftKey) || '[]');
        } catch {
          /* A corrupt local draft must not hide saved merchandise. */
        }
        if (!active) return;
        setItems(
          response.results.flatMap((result) => {
            if (!result.item) return [];
            const item = editableDeliveryItem(result.item),
              draft = drafts.find((value) => value.id === item.id && value.revision === item.revision);
            return [{ ...item, ...(draft && !item.is_published ? draft : {}) }];
          }),
        );
        if (!session.can_view_cost)
          setItems((previous) =>
            previous.map((item) => ({
              ...item,
              lines: item.lines.map((line) => {
                const { cost: _cost, ...safe } = line;
                return safe;
              }),
            })),
          );
        setGroups(response.groups || []);
        setError(
          response.results
            .filter((result) => result.error)
            .map((result) => result.error)
            .join(' '),
        );
        if (
          drafts.some(
            (draft) =>
              !response.results.some(
                (result) => result.item?.id === draft.id && result.item.revision === draft.revision,
              ),
          )
        )
          setNotice('Some saved items changed since your local draft. Their latest saved values are shown.');
        if (response.expanded)
          setNotice(`${response.expanded} linked items included so this product is received together.`);
      } catch (cause) {
        if (active) setError((cause as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [branch, ids, draftKey, session.can_view_cost]);
  useEffect(() => {
    if (loading) return;
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(items.filter((item) => item.dirty)));
    } catch {
      setNotice('Your browser could not keep a local draft. Save before leaving this page.');
    }
  }, [items, draftKey, loading]);

  function edit(id: string, patch: Partial<DeliveryItem>) {
    setItems((previous) =>
      previous.map((item) => (item.id === id ? { ...item, ...patch, dirty: true, error: '' } : item)),
    );
  }
  function select(id: string, checked: boolean) {
    const members = groups.find((group) => group.includes(id)) || [id];
    setItems((previous) =>
      previous.map((item) => (members.includes(item.id) ? { ...item, selected: checked } : item)),
    );
  }
  function editLine(item: DeliveryItem, index: number, patch: Partial<DeliveryItem['lines'][number]>) {
    edit(item.id, { lines: item.lines.map((line, n) => (n === index ? { ...line, ...patch } : line)) });
  }
  function applyShared() {
    // A shared quantity applies to single-size products only, so a total is never multiplied across sizes.
    setItems((previous) =>
      previous.map((item) =>
        item.selected && !item.is_published && !item.is_cancelled
          ? {
              ...item,
              dirty: true,
              error: '',
              lines: item.lines.map((line) => ({
                ...line,
                ...(sharedPrice.trim() ? { price: sharedPrice } : {}),
                ...(session.can_view_cost && sharedCost.trim() ? { cost: sharedCost } : {}),
                ...(sharedQuantity.trim() && item.lines.length === 1 ? { quantity: sharedQuantity } : {}),
              })),
            }
          : item,
      ),
    );
    setNotice('Values applied to selected items. Shared quantity applies only to items with one size.');
  }

  async function saveAndReview(openReview: boolean) {
    // Save bounded chunks, retain failures inline, and never silently exclude an unsaved selected item.
    setBusy(true);
    setError('');
    let updated = [...items];
    try {
      const changed = selected.filter((item) => item.dirty);
      for (let offset = 0; offset < changed.length; offset += 10) {
        const response = await postPos<{ results: { id: string; item?: DeliveryItem; error?: string }[] }>(
          '/catalog-workspace/delivery/save',
          branch,
          { rows: changed.slice(offset, offset + 10).map(deliverySavePayload) },
        );
        updated = updated.map((item) => {
          const result = response.results.find((row) => row.id === item.id);
          return result?.item
            ? { ...editableDeliveryItem(result.item), selected: item.selected, dirty: false }
            : result
              ? { ...item, error: result.error || 'Save response missing.' }
              : item;
        });
        setItems(updated);
      }
      if (updated.some((item) => item.selected && (item.dirty || item.error)))
        throw Error(
          'Some selected items could not be saved. Correct the highlighted rows or reload their saved values.',
        );
      if (openReview) {
        const response = await postPos<{ results: DeliveryReview[] }>(
          '/catalog-workspace/delivery/review',
          branch,
          { item_ids: selected.map((item) => item.id) },
        );
        setNotice('');
        setReview(response.results);
        setOutcomes({});
        window.scrollTo({ top: 0 });
      } else setNotice('Selected items saved. Quantities will be confirmed when you send to POS.');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Reload only the failed item, leaving the rest of the delivery draft intact. */
  async function reloadItem(id: string) {
    setBusy(true);
    try {
      const response = await postPos<{ results: { id: string; item?: DeliveryItem; error?: string }[] }>(
        '/catalog-workspace/delivery/read',
        branch,
        { item_ids: [id] },
      );
      const result = response.results.find((row) => row.id === id);
      if (!result?.item) throw Error(result?.error || 'Item could not be reloaded.');
      setItems((previous) =>
        previous.map((item) => (item.id === id ? editableDeliveryItem(result.item!) : item)),
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    // Retry the exact signed review after an uncertain response; the server returns existing receipts without adding stock again.
    setBusy(true);
    setError('');
    const next = { ...outcomes };
    for (const product of review || []) {
      if (product.error || product.already_received || next[product.unit.id] === 'Sent') continue;
      try {
        const result = await postPos<{ photo_pending?: number }>('/catalog-workspace/delivery/send', branch, {
          review: product,
        });
        if (result.photo_pending)
          setNotice(
            'Stock received. Some photos are still pending; their status is available in the receipt.',
          );
        next[product.unit.id] = 'Sent';
        setItems((previous) =>
          previous.map((item) =>
            product.item_ids.includes(item.id)
              ? { ...item, is_published: true, selected: false, dirty: false }
              : item,
          ),
        );
      } catch (cause) {
        next[product.unit.id] =
          cause instanceof ApiError
            ? cause.message
            : 'Connection interrupted. Retry sending to check the receipt safely.';
      }
      setOutcomes({ ...next });
    }
    setBusy(false);
  }

  const visible = items.filter((item) =>
    `${item.name} ${item.lines.map((line) => line.size).join(' ')}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const eligible = review?.filter((product) => !product.error && !product.already_received) || [];
  const sent = eligible.filter((product) => outcomes[product.unit.id] === 'Sent');
  const excluded = review?.filter((product) => product.error) || [];
  const complete = !!eligible.length && eligible.length === sent.length;
  return (
    <section className="delivery-checkout" aria-label="Delivery to POS">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{branchName}</span>
          <h1>{review ? (complete ? 'Sent to POS' : 'Review for POS') : 'Price items'}</h1>
          <p>
            {review
              ? 'Check the items, sizes, quantities and prices below.'
              : 'Set prices, check quantities, then send this delivery to POS.'}
          </p>
        </div>
        {!review && (
          <Button variant="outline" disabled={busy} onClick={onBack}>
            Back to delivery
          </Button>
        )}
      </div>
      <p className="delivery-steps">
        Upload → AI fill → <strong>{review ? 'Prices saved → Review → Send to POS' : 'Price items'}</strong>
      </p>
      {loading && <p role="status">Loading selected items…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!review && !loading && (
        <>
          {!session.can_view_cost && items.some((item) => item.lines.some((line) => line.cost_missing)) && (
            <p role="alert">
              Some costs are missing. A colleague with cost access must enter them before these items can be
              sent. Other complete items can continue.
            </p>
          )}
          <div className="delivery-bulk">
            <label>
              Selling price / UGX
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={sharedPrice}
                onChange={(e) => setSharedPrice(e.target.value)}
              />
            </label>
            {session.can_view_cost && (
              <label>
                Cost / UGX
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={sharedCost}
                  onChange={(e) => setSharedCost(e.target.value)}
                />
              </label>
            )}
            <label>
              Quantity per single-size item
              <Input
                type="number"
                min="1"
                step="1"
                value={sharedQuantity}
                onChange={(e) => setSharedQuantity(e.target.value)}
              />
            </label>
            <Button
              variant="outline"
              disabled={busy || !selected.length || !session.can_edit}
              onClick={applyShared}
            >
              Apply to selected
            </Button>
          </div>
          <div className="bulk-preparation-actions">
            <Input
              aria-label="Find delivery items"
              placeholder="Find an item or size"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
            <Button
              variant="ghost"
              onClick={() =>
                setItems((previous) =>
                  previous.map((item) => ({ ...item, selected: !item.is_published && !item.is_cancelled })),
                )
              }
            >
              Select all
            </Button>
            <Button
              variant="ghost"
              onClick={() => setItems((previous) => previous.map((item) => ({ ...item, selected: false })))}
            >
              Clear selection
            </Button>
            <span>{selected.length} selected</span>
          </div>
          {visible.slice((page - 1) * 24, page * 24).map((item) => (
            <article className="delivery-price-item" key={item.id}>
              <div className="delivery-item-heading">
                <Checkbox
                  aria-label={`Select ${item.name || item.id}`}
                  checked={item.selected}
                  disabled={busy || item.is_published || item.is_cancelled}
                  onCheckedChange={(value) => select(item.id, !!value)}
                />
                <Photo url={item.image_url} name={item.name} />
                <label>
                  Item
                  <Input
                    aria-label={`Name ${item.id}`}
                    value={item.name}
                    disabled={busy || item.is_published || item.is_cancelled || !session.can_edit}
                    onChange={(e) => edit(item.id, { name: e.target.value })}
                  />
                </label>
                <span>
                  {item.is_published
                    ? 'Sent to POS'
                    : item.count_source === 'human_confirmed'
                      ? 'Quantities previously confirmed'
                      : item.count_source === 'intake_default'
                        ? 'Quantity defaults to 1 — check before sending'
                        : 'Check suggested quantities'}
                </span>
              </div>
              <div className="delivery-required">
                {item.required_fields.map((field) => (
                  <label key={field.key}>
                    {field.label}
                    <Input
                      value={String(item.attributes[field.key] || '')}
                      disabled={busy || !session.can_edit}
                      onChange={(e) =>
                        edit(item.id, { attributes: { ...item.attributes, [field.key]: e.target.value } })
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {item.has_size && <th>Size</th>}
                      <th>Quantity</th>
                      <th>Selling price / UGX</th>
                      {session.can_view_cost && <th>Cost / UGX</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {item.lines.map((line, n) => (
                      <tr key={line.id || n}>
                        {item.has_size && (
                          <td>
                            <Input
                              aria-label={`Size ${item.id} ${n + 1}`}
                              value={line.size}
                              disabled={busy || item.is_published || item.is_cancelled || !session.can_edit}
                              onChange={(e) => editLine(item, n, { size: e.target.value })}
                            />
                          </td>
                        )}
                        <td>
                          <Input
                            aria-label={`Quantity ${item.id} ${n + 1}`}
                            type="number"
                            min="1"
                            step="1"
                            value={line.quantity}
                            disabled={busy || item.is_published || item.is_cancelled || !session.can_edit}
                            onChange={(e) => editLine(item, n, { quantity: e.target.value })}
                          />
                        </td>
                        <td>
                          <Input
                            aria-label={`Price ${item.id} ${n + 1}`}
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={line.price}
                            disabled={busy || item.is_published || item.is_cancelled || !session.can_edit}
                            onChange={(e) => editLine(item, n, { price: e.target.value })}
                          />
                        </td>
                        {session.can_view_cost && (
                          <td>
                            <Input
                              aria-label={`Cost ${item.id} ${n + 1}`}
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={line.cost || ''}
                              disabled={busy || item.is_published || item.is_cancelled || !session.can_edit}
                              onChange={(e) => editLine(item, n, { cost: e.target.value })}
                            />
                          </td>
                        )}
                        <td>
                          {!line.id && (
                            <Button
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                edit(item.id, { lines: item.lines.filter((_, index) => index !== n) })
                              }
                            >
                              Remove added row
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {item.has_size && !item.is_published && !item.is_cancelled && (
                <Button
                  variant="ghost"
                  disabled={busy || !session.can_edit || item.lines.length >= 100}
                  onClick={() =>
                    edit(item.id, {
                      lines: [
                        ...item.lines,
                        {
                          size: '',
                          quantity: '1',
                          price: '',
                          ...(session.can_view_cost ? { cost: '' } : {}),
                        },
                      ],
                    })
                  }
                >
                  Add size
                </Button>
              )}
              {item.error && (
                <p role="alert" className="error">
                  {item.error}{' '}
                  <Button variant="outline" disabled={busy} onClick={() => void reloadItem(item.id)}>
                    Reload saved item (discard its edits)
                  </Button>
                </p>
              )}
              {!item.dirty &&
                item.issues.map((issue) => (
                  <p className="error" key={issue}>
                    {issue}
                  </p>
                ))}
            </article>
          ))}
          <Pagination page={page} total={visible.length} limit={24} onChange={setPage} />
          <div className="delivery-actions">
            <Button
              variant="outline"
              disabled={busy || !selected.length || !session.can_edit}
              onClick={() => void saveAndReview(false)}
            >
              Save progress
            </Button>
            <Button
              disabled={busy || !selected.length || !session.can_publish || !session.can_edit}
              onClick={() => void saveAndReview(true)}
            >
              {busy ? 'Saving…' : 'Review for POS'}
            </Button>
          </div>
        </>
      )}
      {review && (
        <>
          <p>
            <strong>
              {complete ? sent.length : eligible.length} products /{' '}
              {(complete ? sent : eligible).reduce(
                (total, product) =>
                  total + (product.rows || []).reduce((count, row) => count + row.quantity, 0),
                0,
              )}{' '}
              units
            </strong>{' '}
            · {branchName}
          </p>
          {!complete && (
            <p>
              Sending confirms these quantities and adds the stock to POS. Items without an existing confirmed
              link will become new products.
            </p>
          )}
          {eligible.map((product) => (
            <article className="delivery-price-item" key={product.unit.id}>
              <div className="delivery-item-heading">
                <Photo url={product.image_url || null} name={product.name || ''} />
                <strong>{product.name}</strong>
                <span>{product.outcome}</span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Size</th>
                      <th>Quantity</th>
                      <th>Selling price / UGX</th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.rows?.map((row, n) => (
                      <tr key={n}>
                        <td>{row.size || 'Standard'}</td>
                        <td>{row.quantity}</td>
                        <td>{formatMoney(row.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {outcomes[product.unit.id] && <p role="status">{outcomes[product.unit.id]}</p>}
            </article>
          ))}
          {!!excluded.length && (
            <section role="status">
              <h2>
                {excluded.reduce((total, product) => total + product.item_ids.length, 0)} items will not be
                sent
              </h2>
              <p>They remain in this delivery. Go back to pricing to correct them.</p>
              {excluded.map((product) => (
                <p key={product.unit.id} className="error">
                  {product.error}
                </p>
              ))}
            </section>
          )}
          <div className="delivery-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setReview(null);
                setError('');
              }}
            >
              Back to pricing
            </Button>
            {complete ? (
              <>
                <Button variant="outline" onClick={onBack}>
                  Back to deliveries
                </Button>
                <Button onClick={onStock}>View stock</Button>
              </>
            ) : (
              <Button disabled={busy || !eligible.length} onClick={() => void send()}>
                {busy
                  ? 'Sending…'
                  : sent.length || Object.keys(outcomes).length
                    ? `Retry ${eligible.length - sent.length} remaining products`
                    : `Send ${eligible.length} products to POS`}
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
