'use client';
import { WorkspaceSelect } from '@/components/workspace-select';
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatMoney, postPos, type Session } from '@/lib/catalog-api';
import { compilePriceProposal, type PriceItem, type PricePlan } from '@/lib/pricing';
import { Modal, Pagination, Photo, SearchField } from './workspace-ui';
import { compareVariants } from '@/lib/variant-order';
import {
  brandKey,
  eligiblePriceLine,
  emptyPricingFilters,
  filterPricingItems,
  lineSize,
  pricingKey,
  resolveGroupExceptions,
  summarizePricePlan,
  validateGroupExceptions,
  type PriceExceptionRule,
  type PricingFilters,
} from '@/lib/pricing-groups';
import { PricingChoiceField, PricingExceptionRules } from './pricing-group-controls';
import { PricingHistory } from './pricing-history';
import { useWorkspaceProtection } from '@/lib/workspace-protection';
import { loadPricingWorkspace } from '@/lib/pricing-workspace';

/** Pricing has one explicit commercial intent per plan; the server owns the exact review and save. */
export function Pricing({
  branch,
  session,
  scope,
  onDone,
}: {
  branch: string;
  session: Session;
  scope: string[];
  onDone: () => void;
}) {
  const [items, setItems] = useState<PriceItem[]>([]),
    [selected, setSelected] = useState<string[]>([]);
  const [field, setField] = useState<'retail' | 'cost'>('retail'),
    [intent, setIntent] = useState<'fill' | 'revise'>('fill');
  const [shared, setShared] = useState(''),
    [exceptions, setExceptions] = useState<Record<string, string>>({});
  const [filters, setFilters] = useState<PricingFilters>(emptyPricingFilters);
  const [rules, setRules] = useState<PriceExceptionRule[]>([]);
  const [page, setPage] = useState(1),
    [reviewPage, setReviewPage] = useState(1);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<PricePlan | null>(null),
    [receipt, setReceipt] = useState<PricePlan | null>(null);
  const [version, setVersion] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  useWorkspaceProtection(!!shared || !!rules.length || !!Object.keys(exceptions).length || !!plan, busy);
  useEffect(() => {
    /* Reset plans when scope changes and ignore responses from an abandoned workspace. */

    let active = true;
    setLoading(true);
    setError('');
    setSelected([]);
    setPlan(null);
    setShared('');
    setExceptions({});
    setRules([]);
    setFilters(emptyPricingFilters);
    setPage(1);
    setItems([]);
    // Fetch every workspace page before local filtering so unseen gaps cannot disappear.
    async function loadPricing() {
      /* Read every pricing page before filtering, retaining only unpublished merchandise. */

      try {
        const all = await loadPricingWorkspace(
          scope,
          async (body) => {
            const { data } = await postPos<{ data: { items: PriceItem[]; total: number; limit: number } }>(
              '/catalog/pricing/workspace',
              branch,
              body,
            );
            return data;
          },
          () => active,
        );
        if (active) {
          setItems(
            all
              .filter((item) => !item.is_published)
              .map((item) => ({ ...item, lines: [...item.lines].sort(compareVariants) })),
          );
          if (scope.length)
            setSelected(
              all.filter((item) => !item.is_published).flatMap((item) => item.lines.map((line) => line.id)),
            );
        }
      } catch (cause) {
        if (active) setError((cause as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    }
    if (session.can_edit) void loadPricing();
    else setLoading(false);
    return () => {
      active = false;
    };
  }, [branch, scope, version, session.can_edit]);
  const current = (line: PriceItem['lines'][number]) =>
    field === 'retail' ? line.effective_price : line.effective_cost;
  const visible = filterPricingItems(items, filters, field, intent);
  const selectedIds = new Set(selected);
  const selectedItems = items.filter((item) => item.lines.some((line) => selectedIds.has(line.id)));
  const selectedLines = selectedItems
    .flatMap((item) => item.lines)
    .filter((line) => selectedIds.has(line.id));
  const eligibleIds = (item: PriceItem) =>
    item.lines.filter((line) => eligiblePriceLine(line, filters.size, field, intent)).map((line) => line.id);
  const categories = [
    ...new Map(
      items
        .filter((item) => item.category_id)
        .map((item) => [
          item.category_id!,
          { value: item.category_id!, label: item.category_name || 'Uncategorized' },
        ]),
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label));
  const brands = [
    ...new Map(
      items.map((item) => [brandKey(item), { value: brandKey(item), label: item.brand || 'Unbranded' }]),
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label));
  const sizes = [
    ...new Map(
      items
        .flatMap((item) => item.lines)
        .sort(compareVariants)
        .filter((line) => lineSize(line))
        .map((line) => [
          pricingKey(lineSize(line)),
          { value: pricingKey(lineSize(line)), label: lineSize(line) },
        ]),
    ).values(),
  ];
  const resolved = resolveGroupExceptions(items, selected, rules, exceptions);
  function changeFilters(patch: Partial<PricingFilters>) {
    setFilters((prior) => ({ ...prior, ...patch }));
    setSelected([]);
    setPage(1);
    setError('');
  }
  function changeTask(nextField: 'retail' | 'cost', nextIntent: 'fill' | 'revise') {
    setField(nextField);
    setIntent(nextIntent);
    setSelected([]);
    setShared('');
    setExceptions({});
    setRules([]);
    setPage(1);
    setPlan(null);
    setError('');
  }
  function toggleLines(ids: string[], checked: boolean) {
    setSelected((prior) =>
      checked ? [...new Set([...prior, ...ids])] : prior.filter((id) => !ids.includes(id)),
    );
  }
  async function reviewPrices() {
    /* Compile the visible selection into one authoritative, persisted POS price review. */

    setBusy(true);
    setError('');
    try {
      validateGroupExceptions(rules, resolved);
      const payload = compilePriceProposal(items, selected, shared, resolved.exceptions, field, intent);
      const { data } = await postPos<{ data: PricePlan }>('/catalog/pricing/preview', branch, payload);
      setReviewPage(1);
      setPlan(data);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveReviewedPlan(operation: 'apply' | 'undo', target: PricePlan) {
    /* Retry the same plan identity and display the actual applied or undone receipt. */

    setBusy(true);
    setError('');
    try {
      const { data } = await postPos<{ data: PricePlan }>(
        `/catalog/pricing/plans/${target.id}/${operation}`,
        branch,
        {},
      );
      setPlan(null);
      setReceipt(data);
      setVersion((v) => v + 1);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!session.can_edit)
    return (
      <div className="empty-state">
        <h1>Pricing</h1>
        <p>Your POS account has viewing access. A colleague with catalog editing access can set prices.</p>
      </div>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PRICE TOGETHER</span>
          <h1>Pricing</h1>
          <p className="muted">
            {scope.length
              ? `${scope.length} selected lots`
              : 'One group. A shared price. Exceptions where needed.'}
          </p>
        </div>
        <Button variant="outline" onClick={() => setHistoryOpen(true)}>
          History
        </Button>
        <Button variant="outline" onClick={onDone}>
          <ArrowLeft size={16} />
          Receiving
        </Button>
      </div>
      <div className="pricing-tasks">
        <Tabs value={field} onValueChange={(value) => changeTask(value as 'retail' | 'cost', intent)}>
          <TabsList variant="line">
            <TabsTrigger value="retail">Selling prices</TabsTrigger>
            {session.can_view_cost && <TabsTrigger value="cost">Costs</TabsTrigger>}
          </TabsList>
        </Tabs>
        <WorkspaceSelect
          aria-label="Pricing task"
          value={intent}
          onValueChange={(e) => changeTask(field, e as 'fill' | 'revise')}
        >
          <option value="fill">Fill missing {field === 'retail' ? 'prices' : 'costs'}</option>
          <option value="revise">Change existing {field === 'retail' ? 'prices' : 'costs'}</option>
        </WorkspaceSelect>
      </div>
      <div className="pricing-group-filters">
        <SearchField
          value={filters.search}
          onChange={(search) => changeFilters({ search })}
          placeholder="Find merchandise"
        />
        <PricingChoiceField
          label="Category"
          value={filters.category}
          choices={categories}
          allLabel="All categories"
          onChange={(category) => changeFilters({ category })}
        />
        <PricingChoiceField
          label="Brand"
          value={filters.brand}
          choices={brands}
          allLabel="All brands"
          onChange={(brand) => changeFilters({ brand })}
        />
        <PricingChoiceField
          label="Size"
          value={filters.size}
          choices={sizes}
          allLabel="All sizes"
          onChange={(size) => changeFilters({ size })}
        />
      </div>
      <div className="toolbar pricing-group-selection">
        <span className="muted">
          {visible.length.toLocaleString()} matching lots /{' '}
          {visible
            .reduce(
              (sum, item) =>
                sum +
                item.lines
                  .filter((line) => eligiblePriceLine(line, filters.size, field, intent))
                  .reduce((units, line) => units + Number(line.quantity || 0), 0),
              0,
            )
            .toLocaleString()}{' '}
          units
        </span>
        <Button
          variant="outline"
          disabled={loading || !visible.length}
          onClick={() => toggleLines(visible.flatMap(eligibleIds), true)}
        >
          Select all {visible.length} matches
        </Button>
      </div>
      <div className="pricing-layout pricing-groups-layout">
        <section className="pricing-merchandise">
          {loading ? (
            <p role="status" className="loading">
              Loading merchandise…
            </p>
          ) : visible.length === 0 ? (
            <div className="empty-state">
              <Tag size={30} />
              <h2>{items.length ? 'No matching merchandise.' : 'No merchandise to price.'}</h2>
              <p>
                {intent === 'fill'
                  ? 'Try another group, or change the pricing task to include existing prices.'
                  : 'New merchandise appears here after receiving photos.'}
              </p>
            </div>
          ) : (
            <div className="price-list">
              {visible.slice((page - 1) * 48, page * 48).map((item) => {
                /* Keep lot selection, current prices and expandable size exceptions together. */

                const ids = eligibleIds(item),
                  checked = ids.length > 0 && ids.every((id) => selectedIds.has(id));
                return (
                  <article className={`price-item ${checked ? 'selected' : ''}`} key={item.id}>
                    <div className="price-item-head">
                      <Checkbox
                        aria-label={`Select ${item.name || 'unnamed lot'}`}
                        checked={checked}
                        indeterminate={!checked && ids.some((id) => selected.includes(id))}
                        onCheckedChange={(value) => toggleLines(ids, value)}
                      />
                      <Photo url={item.image_url} name={item.name} />
                      <div className="item-name">
                        <strong>{item.name || 'Unnamed lot'}</strong>
                        <small>
                          {item.brand || 'Unbranded'} ·{' '}
                          {item.lines.reduce((sum, line) => sum + line.quantity, 0)} units
                        </small>
                      </div>
                      <div className="price-range">
                        <small>Current / UGX</small>
                        <strong>
                          {[
                            ...new Set(
                              item.lines.map((line) =>
                                current(line) == null ? 'Not set' : formatMoney(current(line)),
                              ),
                            ),
                          ].join(' · ')}
                        </strong>
                      </div>
                      <Button
                        variant="ghost"
                        className="expand-sizes"
                        aria-expanded={expanded.includes(item.id)}
                        aria-label={`Sizes and exceptions for ${item.name}`}
                        onClick={() =>
                          setExpanded((prior) =>
                            prior.includes(item.id)
                              ? prior.filter((id) => id !== item.id)
                              : [...prior, item.id],
                          )
                        }
                      >
                        <ChevronDown size={16} />
                        <span>Sizes</span>
                      </Button>
                    </div>
                    {expanded.includes(item.id) && (
                      <div className="price-sizes">
                        <div className="size-heading">
                          <span>SIZE / UNITS</span>
                          <span>NOW</span>
                          <span>EXCEPTION / UGX</span>
                        </div>
                        {item.lines.map((line) => {
                          /* Protect existing values in fill mode while allowing deliberate selected-size exceptions. */

                          const locked = intent === 'fill' && current(line) != null;
                          return (
                            <div className="price-size-row" key={line.id}>
                              <label className="size-selection">
                                <Checkbox
                                  aria-label={`Include ${Object.values(line.variant_attributes).join(' / ')}`}
                                  disabled={!eligiblePriceLine(line, filters.size, field, intent)}
                                  checked={selected.includes(line.id)}
                                  onCheckedChange={(value) => toggleLines([line.id], value)}
                                />
                                <span>
                                  {Object.values(line.variant_attributes).join(' / ') || 'Standard'}{' '}
                                  <small>× {line.quantity}</small>
                                </span>
                              </label>
                              <span className="tabular">{formatMoney(current(line))}</span>
                              <div>
                                <Input
                                  aria-label={`Exception for ${item.name} ${Object.values(line.variant_attributes).join(' / ')}`}
                                  inputMode="decimal"
                                  disabled={locked || !selected.includes(line.id)}
                                  value={exceptions[line.id] === 'shared' ? '' : exceptions[line.id] || ''}
                                  placeholder={
                                    locked
                                      ? 'Kept'
                                      : (resolved.exceptions[line.id] === 'shared'
                                          ? shared
                                          : resolved.exceptions[line.id]) ||
                                        shared ||
                                        'Shared price'
                                  }
                                  onChange={(e) =>
                                    setExceptions((prior) => ({ ...prior, [line.id]: e.target.value }))
                                  }
                                />
                                {!locked &&
                                  (field === 'retail' ? line.price_override : line.cost_override) != null && (
                                    <button
                                      className="text-link"
                                      onClick={() =>
                                        setExceptions((prior) => ({ ...prior, [line.id]: 'shared' }))
                                      }
                                    >
                                      {exceptions[line.id] === 'shared'
                                        ? 'Will use shared price'
                                        : 'Use shared price'}
                                    </button>
                                  )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          <Pagination page={page} total={visible.length} limit={48} onChange={setPage} />
        </section>
        <aside className="price-editor">
          <span className="eyebrow">{selectedLines.length ? 'YOUR SELECTION' : 'SET ONE PRICE'}</span>
          <h2>{selectedItems.length ? `${selectedItems.length} lots` : 'Price together.'}</h2>
          <p className="muted">
            {selectedLines.length
              ? `${selectedLines.length} sizes · ${selectedLines.reduce((sum, line) => sum + line.quantity, 0)} units selected`
              : 'Select similar merchandise.'}
          </p>
          <label className="shared-price">
            {field === 'retail' ? 'Selling price' : 'Cost per unit'}
            <div className="money-input">
              <span>UGX</span>
              <Input
                aria-label="Shared price"
                inputMode="decimal"
                value={shared}
                onChange={(e) => {
                  setShared(e.target.value);
                  setError('');
                }}
                placeholder="0"
              />
            </div>
          </label>
          <small>
            {intent === 'fill'
              ? 'Existing values are kept.'
              : 'Individual size prices are kept unless edited.'}
          </small>
          <PricingExceptionRules
            rules={rules}
            brands={brands}
            sizes={sizes}
            counts={resolved.counts}
            onChange={(next) => {
              setRules(next);
              setError('');
            }}
          />
          {resolved.conflicts.length > 0 && (
            <p className="error" role="alert">
              {resolved.conflicts.length} sizes have conflicting exceptions.
            </p>
          )}
          <>
            {error && !plan && !receipt && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </>
          <Button
            className="h-11 w-full"
            disabled={loading || busy || !selected.length || resolved.conflicts.length > 0}
            onClick={reviewPrices}
          >
            Review {field === 'retail' ? 'prices' : 'costs'}
            <ArrowRight size={16} />
          </Button>
          {selected.length > 0 && (
            <Button variant="ghost" onClick={() => setSelected([])}>
              Clear selection
            </Button>
          )}
        </aside>
      </div>
      {plan && (
        <Modal
          title="Review prices"
          description={`${plan.summary.item_count} lots · ${plan.summary.variant_count} sizes · ${plan.summary.total_units} units`}
          wide
          onClose={() => {
            if (!busy) setPlan(null);
          }}
        >
          <div className="price-review-groups">
            {summarizePricePlan(plan, field).map((group) => (
              <div className="price-review-group" key={`${group.price}:${group.changed}`}>
                <strong>UGX {formatMoney(group.price)}</strong>
                <span>
                  {group.lots.size} lots · {group.sizes} sizes · {group.units} units
                </span>
                <small>{group.changed ? 'New price' : 'Kept'}</small>
              </div>
            ))}
          </div>
          <details className="price-review-details">
            <summary>Inspect individual changes</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Merchandise / size</th>
                    <th>Units</th>
                    <th>Before / UGX</th>
                    <th>After / UGX</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.slice((reviewPage - 1) * 48, reviewPage * 48).map((row) => (
                    /* Show exact server-returned before and after values for each reviewed size. */ <tr
                      key={row.line_id}
                    >
                      <td>
                        <strong>{row.name}</strong>
                        <small className="block">{Object.values(row.variant_attributes).join(' / ')}</small>
                      </td>
                      <td>{row.quantity}</td>
                      <td>{formatMoney(field === 'retail' ? row.price_before : row.cost_before)}</td>
                      <td>
                        <strong>{formatMoney(field === 'retail' ? row.price_after : row.cost_after)}</strong>
                        {!row.changed && <small className="block">Kept</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={reviewPage} total={plan.rows.length} limit={48} onChange={setReviewPage} />
          </details>
          <p className="muted">
            {plan.summary.changed_count} sizes changing · {plan.summary.protected_count} protected
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button variant="outline" disabled={busy} onClick={() => setPlan(null)}>
              Back to editing
            </Button>
            <Button disabled={busy} onClick={() => saveReviewedPlan('apply', plan)}>
              {busy ? 'Saving…' : 'Save prices'}
            </Button>
          </div>
        </Modal>
      )}
      {historyOpen && (
        <PricingHistory
          branch={branch}
          session={session}
          onClose={() => setHistoryOpen(false)}
          onChanged={() => setVersion((v) => v + 1)}
        />
      )}
      {receipt && (
        <Modal
          title={receipt.status === 'undone' ? 'Prices restored' : 'Prices saved'}
          description="Stock is still in Receiving until you receive it into POS."
          onClose={() => setReceipt(null)}
        >
          <div className="success-mark">
            <Check size={30} />
          </div>
          <p>
            {receipt.summary.changed_count} sizes · {receipt.summary.total_units} units
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button variant="outline" onClick={() => setReceipt(null)}>
              Price another group
            </Button>
            {receipt.status === 'applied' && (
              <Button variant="outline" disabled={busy} onClick={() => saveReviewedPlan('undo', receipt)}>
                Undo these prices
              </Button>
            )}
            <Button
              onClick={() => {
                setReceipt(null);
                onDone();
              }}
            >
              Return to Receiving
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
