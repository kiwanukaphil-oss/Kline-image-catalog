'use client';
import { WorkspaceSelect } from '@/components/workspace-select';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  PackagePlus,
  Plus,
  Sparkles,
  Tag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ApiError,
  requestPos,
  postPos,
  formatMoney,
  type CatalogItem,
  type Session,
} from '@/lib/catalog-api';
import { Modal, Photo, SearchField, Pagination, usePosRead } from './workspace-ui';
import { UploadDelivery, type Category } from './upload-delivery';
import { DraftEditor } from './draft-editor';
import { AiFill } from './ai-fill';
import { useWorkspaceTool } from '@/lib/webmcp';
import { useReceivingScope } from '@/lib/receiving-inventory';
import { readPendingPhotos } from '@/lib/upload-queue';
type Batch = {
  id: string;
  title: string;
  created_at: string;
  item_count: number;
  total_units: number;
  cancelled_count?: number;
  received_count: number;
};
export type CategoryField = {
  category_id: string;
  key: string;
  label: string;
  type: string;
  options: string[] | null;
  required: boolean;
  inherit: boolean;
  sort: number;
};
type References = { categories: Category[]; fields: CategoryField[] };
type Receipt = {
  id: string;
  item_id: string;
  product_id: string;
  name: string;
  batch_title: string;
  published_at: string;
  total_units: number;
  variant_count: number;
  variants: { variant_attributes: Record<string, string>; quantity: number; price: number; sku: string }[];
};
const lotCount = (count: number) => `${count} ${count === 1 ? 'lot' : 'lots'}`;
const nextTask = (item: CatalogItem) =>
  /* Give each lot one next task while leaving the complete blocker list in its details. */ item.is_cancelled
    ? 'Cancelled'
    : item.is_published
      ? item.requires_pos_reconciliation
        ? 'Check POS link'
        : 'Received'
      : !item.blockers.length
        ? 'Ready for POS'
        : item.blockers.some((b) => b.includes('name'))
          ? 'Name this lot'
          : item.blockers.some((b) => b.includes('stock breakdown'))
            ? 'Count sizes'
            : item.blockers.some((b) => b.includes('retail'))
              ? 'Set selling price'
              : item.blockers.some((b) => b.includes('cost'))
                ? 'Cost needed'
                : 'Complete details';

/** Keep persistent delivery groups, individual preparation and historical receipts in one receiving workspace. */
export function Receiving({
  branch,
  session,
  onPrice,
  onStock,
  active = true,
}: {
  branch: string;
  session: Session;
  onPrice: (ids: string[]) => void;
  onStock: () => void;
  active?: boolean;
}) {
  const [tab, setTab] = useState('deliveries'),
    [batch, setBatch] = useState<Batch | null>(null),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1);
  const [selectedItems, setSelectedItems] = useState<CatalogItem[]>([]),
    [editing, setEditing] = useState<string | null>(null),
    [uploading, setUploading] = useState(false),
    [receiving, setReceiving] = useState<string[] | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [task, setTask] = useState('all'),
    [categoryFilter, setCategoryFilter] = useState(''),
    [sort, setSort] = useState('newest');
  const [deliverySearch, setDeliverySearch] = useState(''),
    [deliveryPage, setDeliveryPage] = useState(1);
  const [receiptSearch, setReceiptSearch] = useState(''),
    [receiptPage, setReceiptPage] = useState(1);
  const [aiItems, setAiItems] = useState<CatalogItem[] | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const initialViewChosen = useRef(false);
  const refs = usePosRead<{ data: References }>('/catalog/reference-data', branch);
  const batches = usePosRead<{ items: Batch[]; total: number; limit: number }>(
    `/catalog-workspace/history/deliveries?page=${deliveryPage}&search=${encodeURIComponent(deliverySearch)}`,
    branch,
  );
  const [brandFilter, setBrandFilter] = useState('');
  const [deliveryFilter, setDeliveryFilter] = useState('');
  const selected = useMemo(() => selectedItems.map((item) => item.id), [selectedItems]);
  const query = new URLSearchParams({
    search,
    task: tab === 'ready' || tab === 'preparing' ? 'incoming' : task,
    sort,
    ...(categoryFilter ? { category_id: categoryFilter } : {}),
    ...(batch ? { batch_id: batch.id } : {}),
  }).toString();
  const scope = useReceivingScope(query, branch);
  const matchingItems = scope.items.filter(
    (item) =>
      (tab !== 'ready' || (!item.is_published && !item.is_cancelled && !item.blockers.length)) &&
      (tab !== 'preparing' || (!item.is_published && !item.is_cancelled && item.blockers.length > 0)) &&
      (!brandFilter || item.brand === brandFilter) &&
      (!deliveryFilter ||
        (deliveryFilter === 'ungrouped' ? !item.batch_id : item.batch_id === deliveryFilter)),
  );
  const selectableItems = matchingItems.filter((item) => !item.is_published && !item.is_cancelled);
  const pageItems = matchingItems.slice((page - 1) * 48, page * 48);
  const selectablePage = pageItems.filter((item) => !item.is_published && !item.is_cancelled);
  const inventory = {
    ...scope,
    data:
      scope.loading || scope.error
        ? null
        : {
            items: pageItems,
            total: matchingItems.length,
            total_units: matchingItems.reduce((sum, item) => sum + Number(item.stock_quantity || 0), 0),
            limit: 48,
          },
  };
  const receipts = usePosRead<{ items: Receipt[]; total: number; limit: number }>(
    `/catalog-workspace/history/receipts?page=${receiptPage}&search=${encodeURIComponent(receiptSearch)}${batch ? `&batch_id=${batch.id}` : ''}`,
    branch,
  );
  useEffect(() => {
    // Existing catalogs have real merchandise but no delivery groups; show that stock immediately.
    if (initialViewChosen.current || !batches.data || !inventory.data) return;
    initialViewChosen.current = true;
    if (!batches.data.total && inventory.data.total > 0 && !batch && !deliverySearch && !search) {
      setTab('lots');
    }
  }, [batches.data, inventory.data, batch, deliverySearch, search]);
  useEffect(() => {
    if (session.can_upload && new URLSearchParams(location.search).has('share')) setUploading(true);
  }, [session.can_upload]);
  const refreshInventory = inventory.refresh,
    refreshBatches = batches.refresh,
    refreshReceipts = receipts.refresh;
  useWorkspaceTool({
    name: 'read_receiving_selection',
    title: 'Read receiving selection',
    description:
      'Read the selected photographed lots and their next tasks. These are incoming quantities, not current POS availability.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: (input) => {
      /* Return only the current branch selection; photographed counts are not POS availability. */

      if (!input || typeof input !== 'object' || Object.keys(input).length)
        throw new Error('This tool takes an empty object.');
      if (!inventory.data) throw new Error('Receiving has not loaded successfully.');
      return {
        branch_id: branch,
        items: selectedItems.map((item) => ({
          id: item.id,
          name: item.name,
          units: item.stock_quantity,
          next_task: nextTask(item),
          blockers: item.blockers,
        })),
      };
    },
  });
  function refreshReceiving() {
    setPage(1);
    inventory.refresh();
    batches.refresh();
    receipts.refresh();
    setSelectedItems([]);
  }
  function openBatch(value: Batch) {
    setReceiptPage(1);
    setBatch(value);
    setTab('preparing');
    setBrandFilter('');
    setDeliveryFilter('');
    setSearch('');
    setPage(1);
    setSelectedItems([]);
  }
  function changeTab(value: string) {
    initialViewChosen.current = true;
    setTab(value);
    setSelectedItems([]);
    setPage(1);
  }
  useEffect(() => {
    setSelectedItems([]);
    setPage(1);
  }, [query, brandFilter, deliveryFilter, tab]);
  useEffect(() => {
    let current = true;
    if (active)
      void readPendingPhotos(session.id, branch)
        .then((photos) => {
          if (current) setPendingCount(photos.length);
        })
        .catch(() => {});
    return () => {
      current = false;
    };
  }, [active, session.id, branch, uploading]);
  useEffect(() => {
    if (active) {
      refreshInventory();
      refreshBatches();
      refreshReceipts();
      setSelectedItems([]);
    }
  }, [active, refreshInventory, refreshBatches, refreshReceipts]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">FROM ARRIVAL TO READY</span>
          <h1>{batch ? batch.title : 'Receiving'}</h1>
          <p className="muted">
            {batch
              ? new Date(batch.created_at).toLocaleDateString([], {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })
              : 'New deliveries, ready for their next step.'}
          </p>
        </div>
        {session.can_upload && refs.data && (
          <div className="heading-actions">
            {pendingCount > 0 && (
              <Button variant="outline" className="h-11" onClick={() => setUploading(true)}>
                Resume {pendingCount} uploads
              </Button>
            )}
            <Button className="h-11" onClick={() => setUploading(true)}>
              <Plus size={17} />
              New delivery
            </Button>
          </div>
        )}
      </div>
      {batch && (
        <Button
          variant="ghost"
          className="mb-4"
          onClick={() => {
            setBatch(null);
            changeTab('deliveries');
          }}
        >
          <ArrowLeft size={15} />
          All deliveries
        </Button>
      )}
      <Tabs className="receiving-tabs" value={tab} onValueChange={(value) => changeTab(String(value))}>
        <TabsList variant="line">
          {!batch && <TabsTrigger value="deliveries">Deliveries</TabsTrigger>}
          <TabsTrigger value="preparing">Preparation</TabsTrigger>
          <TabsTrigger value="ready">Ready for POS</TabsTrigger>
          <TabsTrigger value="lots">{batch ? 'Merchandise' : 'All merchandise'}</TabsTrigger>
          <TabsTrigger value="receipts">Receipts</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'deliveries' && (
        <section className="delivery-section">
          <SearchField
            value={deliverySearch}
            onChange={(value) => {
              setDeliverySearch(value);
              setDeliveryPage(1);
            }}
            placeholder="Search deliveries"
          />
          {batches.error ? (
            <p role="alert" className="error">
              {batches.error}
            </p>
          ) : batches.loading ? (
            <p role="status">Loading deliveries…</p>
          ) : !batches.data?.items.length ? (
            <div className="empty-state">
              <PackagePlus size={32} />
              <h2>{deliverySearch ? 'No matching deliveries.' : 'Your next delivery starts here.'}</h2>
              {deliverySearch ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setDeliverySearch('');
                    setDeliveryPage(1);
                  }}
                >
                  Clear search
                </Button>
              ) : (
                <p>Add photos, confirm the sizes, then set prices.</p>
              )}
              {session.can_upload && <Button onClick={() => setUploading(true)}>New delivery</Button>}
            </div>
          ) : (
            <div className="delivery-list">
              {batches.data.items.map((row) => (
                /* Present persistent deliveries with unique lot counts and receipt progress. */ <button
                  className="delivery-card"
                  key={row.id}
                  onClick={() => openBatch(row)}
                >
                  <span className="delivery-icon">
                    <ArrowDownToLine size={22} />
                  </span>
                  <div>
                    <h2>{row.title}</h2>
                    <small>
                      {new Date(row.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })} ·{' '}
                      {row.item_count} {row.item_count === 1 ? 'lot' : 'lots'}
                      {' / '}
                      {row.total_units?.toLocaleString() ?? '—'} units
                      {row.cancelled_count ? ` · ${row.cancelled_count} cancelled` : ''}
                    </small>
                  </div>
                  <span
                    className={`delivery-status ${row.item_count > 0 && row.received_count === row.item_count ? 'complete' : ''}`}
                  >
                    {row.item_count > 0 && row.received_count === row.item_count ? (
                      <>
                        <Check size={14} />
                        Received
                      </>
                    ) : row.received_count ? (
                      `${row.received_count} of ${row.item_count} received`
                    ) : row.item_count === 0 && row.cancelled_count ? (
                      'Cancelled'
                    ) : (
                      'Preparing'
                    )}
                  </span>
                  <ArrowRight size={17} />
                </button>
              ))}
            </div>
          )}
          {batches.data && (
            <Pagination
              page={deliveryPage}
              total={batches.data.total}
              limit={batches.data.limit}
              onChange={setDeliveryPage}
            />
          )}
        </section>
      )}
      {['lots', 'ready', 'preparing'].includes(tab) && (
        <>
          <div className="toolbar mt-6">
            <SearchField
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
                setSelectedItems([]);
              }}
              placeholder="Find incoming merchandise"
            />
            <span className="muted">
              {inventory.data?.total?.toLocaleString() ?? '—'} lots /{' '}
              {inventory.data?.total_units?.toLocaleString() ?? '—'} units
            </span>
          </div>
          <div className="flex flex-wrap gap-3 mb-4">
            {tab === 'lots' && (
              <label htmlFor="receiving-task" className="flex-1 min-w-36">
                Task
                <WorkspaceSelect
                  id="receiving-task"
                  aria-label="Receiving task"
                  className="w-full min-w-0"
                  value={task}
                  onValueChange={(event) => {
                    setTask(event);
                    setPage(1);
                    setSelectedItems([]);
                  }}
                >
                  <option value="all">All merchandise</option>
                  <option value="incoming">Not received</option>
                  <option value="count">Confirm counts</option>
                  <option value="price">Retail price needed</option>
                  <option value="flagged">Flagged photos</option>
                  <option value="reconcile">Check POS link</option>
                  <option value="received">Received</option>
                  <option value="cancelled">Cancelled intake</option>
                </WorkspaceSelect>
              </label>
            )}
            <label htmlFor="receiving-category" className="flex-1 min-w-36">
              Category
              <WorkspaceSelect
                id="receiving-category"
                aria-label="Receiving category"
                className="w-full min-w-0"
                value={categoryFilter}
                onValueChange={(event) => {
                  setCategoryFilter(event);
                  setPage(1);
                  setSelectedItems([]);
                }}
              >
                <option value="">All categories</option>
                {refs.data?.data.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </WorkspaceSelect>
            </label>
            <label htmlFor="receiving-sort" className="flex-1 min-w-36">
              Sort
              <WorkspaceSelect
                id="receiving-sort"
                aria-label="Receiving sort"
                className="w-full min-w-0"
                value={sort}
                onValueChange={(event) => {
                  setSort(event);
                  setPage(1);
                  setSelectedItems([]);
                }}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name">Name A–Z</option>
              </WorkspaceSelect>
            </label>
          </div>
          <div className="receiving-scope-filters">
            <label>
              Brand
              <WorkspaceSelect
                aria-label="Receiving brand"
                value={brandFilter}
                onValueChange={setBrandFilter}
              >
                <option value="">All brands</option>
                {[...new Set(scope.items.map((item) => item.brand).filter(Boolean))].sort().map((brand) => (
                  <option key={brand} value={brand}>
                    {brand}
                  </option>
                ))}
              </WorkspaceSelect>
            </label>
            {!batch && (
              <label>
                Delivery
                <WorkspaceSelect
                  aria-label="Receiving delivery"
                  value={deliveryFilter}
                  onValueChange={setDeliveryFilter}
                >
                  <option value="">All deliveries</option>
                  <option value="ungrouped">Ungrouped</option>
                  {[
                    ...new Map(
                      scope.items
                        .filter((item) => item.batch_id)
                        .map((item) => [item.batch_id!, item.batch_title || 'Delivery']),
                    ).entries(),
                  ].map(([id, title]) => (
                    <option key={id} value={id}>
                      {title}
                    </option>
                  ))}
                </WorkspaceSelect>
              </label>
            )}
          </div>
          {!inventory.loading && !inventory.error && (
            <div className="receiving-bulk-toolbar" aria-label="Bulk receiving actions">
              <div className="receiving-page-selection">
                <Checkbox
                  id="receiving-select-page"
                  aria-label="Select this page"
                  disabled={!selectablePage.length}
                  checked={
                    !!selectablePage.length && selectablePage.every((item) => selected.includes(item.id))
                  }
                  indeterminate={
                    selectablePage.some((item) => selected.includes(item.id)) &&
                    !selectablePage.every((item) => selected.includes(item.id))
                  }
                  onCheckedChange={(checked) =>
                    setSelectedItems((previous) =>
                      checked
                        ? [
                            ...new Map(
                              [...previous, ...selectablePage].map((item) => [item.id, item]),
                            ).values(),
                          ]
                        : previous.filter((item) => !selectablePage.some((row) => row.id === item.id)),
                    )
                  }
                />
                <label htmlFor="receiving-select-page">Select this page</label>
              </div>
              {!!selectableItems.length && (
                <Button variant="ghost" onClick={() => setSelectedItems(selectableItems)}>
                  Select all {selectableItems.length} matching lots
                </Button>
              )}
              {tab === 'ready' && session.can_publish && (
                <Button
                  disabled={!selectableItems.length}
                  onClick={() => setReceiving(selectableItems.map((item) => item.id))}
                >
                  <ArrowDownToLine size={16} />
                  Receive all ready
                </Button>
              )}
            </div>
          )}
          {inventory.error ? (
            <p role="alert" className="error">
              {inventory.error}
              <Button variant="outline" onClick={inventory.refresh}>
                Reload merchandise
              </Button>
            </p>
          ) : inventory.loading ? (
            <p role="status" className="loading">
              Loading merchandise…
            </p>
          ) : !inventory.data?.items.length ? (
            <div className="empty-state">
              <h2>
                {search || categoryFilter || brandFilter || deliveryFilter
                  ? 'No merchandise matches.'
                  : tab === 'ready'
                    ? 'Nothing ready for POS yet.'
                    : tab === 'preparing'
                      ? 'No lots need preparation.'
                      : 'No merchandise here yet.'}
              </h2>
              {search || task !== 'all' || categoryFilter || brandFilter || deliveryFilter ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch('');
                    setTask('all');
                    setCategoryFilter('');
                    setBrandFilter('');
                    setDeliveryFilter('');
                    setPage(1);
                    setSelectedItems([]);
                  }}
                >
                  Clear filters
                </Button>
              ) : tab === 'ready' ? (
                <Button variant="outline" onClick={() => changeTab('preparing')}>
                  View preparation
                </Button>
              ) : tab === 'preparing' ? (
                <Button variant="outline" onClick={() => changeTab('ready')}>
                  View ready lots
                </Button>
              ) : (
                <p>Add photos to start this delivery.</p>
              )}
            </div>
          ) : (
            <div className="receiving-list">
              {inventory.data.items.map((item) => (
                /* Keep evidence, physical units and the next preparation task on one merchandise row. */ <article
                  key={item.id}
                  className="receiving-row"
                >
                  {!item.is_published && !item.is_cancelled ? (
                    <Checkbox
                      aria-label={`Select ${item.name || 'unnamed lot'}`}
                      checked={selected.includes(item.id)}
                      onCheckedChange={(checked) =>
                        setSelectedItems((prior) =>
                          checked ? [...prior, item] : prior.filter((row) => row.id !== item.id),
                        )
                      }
                    />
                  ) : item.is_cancelled ? (
                    <span className="muted">?</span>
                  ) : (
                    <Check size={16} className="muted" />
                  )}
                  <button className="receiving-identity" onClick={() => setEditing(item.id)}>
                    <Photo url={item.image_url} name={item.name || 'Incoming lot'} />
                    <div>
                      <strong>{item.name || 'Unnamed lot'}</strong>
                      <small>
                        {item.brand || 'Brand not set'} · {item.batch_title || 'Ungrouped'}
                      </small>
                    </div>
                  </button>
                  <div className="receiving-quantity">
                    <strong>{item.stock_quantity ?? '—'} units</strong>
                    <small>{item.variant_lines.length} sizes</small>
                  </div>
                  <button
                    onClick={() =>
                      session.can_publish && nextTask(item) === 'Ready for POS'
                        ? setReceiving([item.id])
                        : setEditing(item.id)
                    }
                    className={`task-status ${item.is_published ? 'received' : item.blockers.length ? 'preparing' : 'ready'}`}
                  >
                    {nextTask(item)}
                    <ArrowRight size={14} />
                  </button>
                </article>
              ))}
            </div>
          )}
          {inventory.data && (
            <Pagination
              page={page}
              total={inventory.data.total}
              limit={inventory.data.limit}
              onChange={setPage}
            />
          )}
          {selectedItems.length > 0 && (
            <div className="selection-bar">
              <span>
                {selectedItems.length} lots /{' '}
                {selectedItems
                  .reduce((sum, item) => sum + Number(item.stock_quantity || 0), 0)
                  .toLocaleString()}{' '}
                units selected
              </span>
              <Button variant="ghost" onClick={() => setSelectedItems([])}>
                Clear
              </Button>
              {session.can_edit && (
                <Button variant="outline" onClick={() => onPrice(selected)}>
                  <Tag size={16} />
                  Price
                </Button>
              )}
              {session.can_ai_extract && (
                <Button variant="outline" onClick={() => setAiItems([...selectedItems])}>
                  <Sparkles size={16} />
                  AI fill
                </Button>
              )}
              {session.can_publish && (
                <Button onClick={() => setReceiving(selected)}>
                  <ArrowDownToLine size={16} />
                  Receive selected into POS
                </Button>
              )}
            </div>
          )}
        </>
      )}
      {tab === 'receipts' && (
        <div className="receipt-list">
          <SearchField
            value={receiptSearch}
            onChange={(value) => {
              setReceiptSearch(value);
              setReceiptPage(1);
            }}
            placeholder="Search receipts or deliveries"
          />
          {receipts.error ? (
            <p className="error" role="alert">
              {receipts.error}
            </p>
          ) : receipts.loading ? (
            <p role="status">Loading receipts…</p>
          ) : !receipts.data?.items.length ? (
            <div className="empty-state">
              <h2>{receiptSearch ? 'No matching receipts.' : 'No receipts yet.'}</h2>
              {receiptSearch ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setReceiptSearch('');
                    setReceiptPage(1);
                  }}
                >
                  Clear search
                </Button>
              ) : (
                <p>Completed POS receipts will appear here.</p>
              )}
            </div>
          ) : (
            <>
              <p className="muted mb-4">
                Historical deliveries · quantities received, before any sales or transfers
              </p>
              {receipts.data.items.map((row) => (
                /* Link each immutable historical receipt to its original delivery and received quantity. */ <button
                  className="receipt-row"
                  key={row.id}
                  onClick={() => setReceipt(row)}
                >
                  <span className="receipt-check">
                    <Check size={18} />
                  </span>
                  <div>
                    <strong>{row.name}</strong>
                    <small>
                      {row.batch_title || 'Ungrouped receipt'} ·{' '}
                      {new Date(row.published_at).toLocaleDateString()}
                    </small>
                  </div>
                  <strong>{row.total_units} units</strong>
                  <ArrowRight size={16} />
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {tab === 'receipts' && receipts.data && (
        <Pagination
          page={receiptPage}
          total={receipts.data.total}
          limit={receipts.data.limit}
          onChange={setReceiptPage}
        />
      )}
      {refs.error && (
        <p className="error" role="alert">
          {refs.error}
        </p>
      )}
      {uploading && refs.data && (
        <UploadDelivery
          canCancel={!!session.can_cancel_intake}
          branch={branch}
          userId={session.id}
          categories={refs.data.data.categories}
          onClose={() => setUploading(false)}
          onComplete={(id, title) => {
            setUploading(false);
            setTab('lots');
            setBatch({
              id,
              title,
              created_at: new Date().toISOString(),
              item_count: 0,
              total_units: 0,
              received_count: 0,
            });
            refreshReceiving();
          }}
        />
      )}
      {editing && refs.data && (
        <DraftEditor
          itemId={editing}
          branch={branch}
          session={session}
          references={refs.data.data}
          onClose={() => setEditing(null)}
          onSaved={refreshReceiving}
          onPrice={() => {
            setEditing(null);
            onPrice([editing]);
          }}
        />
      )}
      {aiItems && (
        <AiFill
          items={aiItems}
          branch={branch}
          onClose={() => {
            setAiItems(null);
            refreshReceiving();
          }}
          onReview={(id) => {
            setAiItems(null);
            refreshReceiving();
            setEditing(id);
          }}
        />
      )}
      {receiving && (
        <ReceiveReview
          ids={receiving}
          branch={branch}
          branchName={session.branches.find((b) => b.id === branch)?.name || ''}
          onClose={() => setReceiving(null)}
          onComplete={refreshReceiving}
          onReviewLot={(id) => {
            refreshReceiving();
            setReceiving(null);
            setEditing(id);
          }}
          onStock={() => {
            refreshReceiving();
            setReceiving(null);
            onStock();
          }}
          onReceipts={() => {
            refreshReceiving();
            setReceiving(null);
            changeTab('receipts');
          }}
        />
      )}
      {receipt && (
        <Modal
          title={receipt.name}
          description={`Received ${new Date(receipt.published_at).toLocaleString()}`}
          wide
          onClose={() => setReceipt(null)}
        >
          <p className="receipt-total">
            {receipt.total_units} <small>units received into POS</small>
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Size</th>
                  <th>Received</th>
                  <th>Unit price / UGX</th>
                </tr>
              </thead>
              <tbody>
                {receipt.variants.map((line, index) => (
                  <tr key={index}>
                    <td>{Object.values(line.variant_attributes).join(' / ') || 'Standard'}</td>
                    <td>{line.quantity}</td>
                    <td>{formatMoney(line.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <small>Receipt {receipt.id}</small>
          <Button
            variant="outline"
            onClick={() => {
              setEditing(receipt.item_id);
              setReceipt(null);
            }}
          >
            View lot and photo
          </Button>
        </Modal>
      )}
    </>
  );
}

/** Revalidate a whole selection, show grouped quantities, and receive only eligible lots with safe retries. */
function ReceiveReview({
  ids,
  branch,
  branchName,
  onClose,
  onComplete,
  onStock,
  onReceipts,
  onReviewLot,
}: {
  ids: string[];
  branch: string;
  branchName: string;
  onClose: () => void;
  onComplete: () => void;
  onStock: () => void;
  onReceipts: () => void;
  onReviewLot: (id: string) => void;
}) {
  const [items, setItems] = useState<(CatalogItem & { publication_revision: string })[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<Record<string, string>>({});
  const [reviewVersion, setReviewVersion] = useState(0);
  const [needsReview, setNeedsReview] = useState(false);
  const active = useRef(true);
  const done = (item: CatalogItem) => item.is_published || results[item.id] === 'Received';
  const eligible = items.filter((item) => !done(item) && !item.is_cancelled && !item.blockers.length);
  const exceptions = items.filter((item) => !done(item) && (item.is_cancelled || item.blockers.length));
  const received = items.filter(done);
  const failed = eligible.filter((item) => results[item.id]);
  const finished = !loading && !error && !!received.length && !eligible.length;
  const units = (rows: CatalogItem[]) =>
    rows.reduce((sum, item) => sum + Number(item.stock_quantity || 0), 0);
  const groups = new Map<string, CatalogItem[]>();
  for (const item of eligible) {
    const title = item.batch_title || 'Ungrouped merchandise';
    groups.set(title, [...(groups.get(title) || []), item]);
  }
  useEffect(() => {
    // Bound concurrent review requests so a thousand-lot selection does not flood the POS.
    const controller = new AbortController();
    active.current = true;
    setLoading(true);
    setError('');
    let cursor = 0;
    const rows: (CatalogItem & { publication_revision: string })[] = [];
    async function readReviewWorker() {
      while (cursor < ids.length && !controller.signal.aborted) {
        const index = cursor++;
        const row = await requestPos<{ item: CatalogItem; blockers: string[]; publication_revision: string }>(
          `/catalog-workspace/items/${ids[index]}`,
          branch,
          { signal: controller.signal },
        );
        rows[index] = { ...row.item, blockers: row.blockers, publication_revision: row.publication_revision };
      }
    }
    Promise.all(Array.from({ length: Math.min(4, ids.length) }, readReviewWorker))
      .then(() => {
        if (!controller.signal.aborted) {
          setItems(rows);
          setNeedsReview(false);
          setResults((previous) =>
            Object.fromEntries(Object.entries(previous).filter(([, outcome]) => outcome === 'Received')),
          );
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      active.current = false;
    };
  }, [ids, branch, reviewVersion]);

  /** Keep publication revisions and stable IDs pinned; only retry lots without a successful receipt. */
  async function receiveEligible() {
    setBusy(true);
    setError('');
    const token = sessionStorage.getItem('kline.session');
    const outcomes = { ...results };
    try {
      for (const item of eligible) {
        if (!active.current || sessionStorage.getItem('kline.session') !== token) break;
        try {
          await postPos(`/catalog-workspace/items/${item.id}/receive`, branch, {
            expected_revision: item.publication_revision,
          });
          outcomes[item.id] = 'Received';
        } catch (cause) {
          outcomes[item.id] = (cause as Error).message;
          if (cause instanceof ApiError && cause.status === 409) setNeedsReview(true);
          if (cause instanceof ApiError && [401, 403].includes(cause.status)) {
            setError(cause.message);
            break;
          }
        }
        if (active.current) setResults({ ...outcomes });
      }
    } finally {
      if (active.current) {
        setResults({ ...outcomes });
        setBusy(false);
      }
    }
  }
  function closeReview() {
    if (busy) return;
    if (Object.values(results).includes('Received')) onComplete();
    onClose();
  }
  return (
    <Modal
      title={finished ? 'Stock received' : 'Receive into POS'}
      description={branchName}
      wide
      onClose={closeReview}
    >
      {loading ? (
        <p role="status">Checking {ids.length} selected lots...</p>
      ) : (
        <>
          <div className="receipt-summary" aria-live="polite">
            <strong>
              {units(finished ? received : eligible).toLocaleString()}{' '}
              <small>units {finished ? 'received' : 'to receive'}</small>
            </strong>
            <span>
              {(finished ? received : eligible).length} lots / {branchName}
            </span>
          </div>
          {!!received.length && !finished && (
            <p role="status">
              {received.length} lots / {units(received)} units received
            </p>
          )}
          {!finished &&
            [...groups.entries()].map(([title, rows]) => (
              <details className="receiving-review-group" key={title}>
                <summary>
                  <strong>{title}</strong>
                  <span>
                    {rows.length} lots / {units(rows)} units
                  </span>
                </summary>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Merchandise / size</th>
                        <th>Units</th>
                        <th>Price / UGX</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.flatMap((item) =>
                        item.variant_lines.map((line) => (
                          <tr key={`${item.id}:${line.id}`}>
                            <td>
                              <strong>{item.name || 'Unnamed lot'}</strong>
                              <small className="block">
                                {Object.values(line.variant_attributes).join(' / ') || 'Standard'}
                              </small>
                            </td>
                            <td>{line.quantity}</td>
                            <td>{formatMoney(line.effective_price)}</td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          {!!exceptions.length && (
            <details className="receiving-review-group" open>
              <summary>
                <strong>
                  {exceptions.length} {exceptions.length === 1 ? 'lot needs' : 'lots need'} attention
                </strong>
                <span>{units(exceptions)} units excluded</span>
              </summary>
              {exceptions.map((item) => (
                <div className="receipt-outcome" key={item.id}>
                  <div>
                    <strong>{item.name || 'Unnamed lot'}</strong>
                    <p>{item.is_cancelled ? 'Cancelled intake' : item.blockers.join(' ')}</p>
                  </div>
                  <Button variant="outline" disabled={busy} onClick={() => onReviewLot(item.id)}>
                    Resolve
                  </Button>
                </div>
              ))}
            </details>
          )}
          {!!failed.length && (
            <div role="alert">
              {failed.map((item) => (
                <p className="error" key={item.id}>
                  {item.name}: {results[item.id]}
                </p>
              ))}
            </div>
          )}
          {!eligible.length && !received.length && !exceptions.length && !error && (
            <p>No incoming lots remain in this selection.</p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="dialog-actions receiving-confirm-actions">
        <Button variant="outline" disabled={busy} onClick={closeReview}>
          {finished ? 'Done' : 'Back'}
        </Button>
        {finished ? (
          <>
            <Button variant="outline" onClick={onReceipts}>
              View receipts
            </Button>
            <Button onClick={onStock}>View stock</Button>
          </>
        ) : needsReview || error ? (
          <Button disabled={busy || loading} onClick={() => setReviewVersion((value) => value + 1)}>
            Review changed lots
          </Button>
        ) : (
          <Button disabled={busy || loading || !eligible.length} onClick={receiveEligible}>
            {busy
              ? `Receiving... ${received.length} of ${items.length - exceptions.length}`
              : failed.length
                ? 'Retry unresolved lots'
                : `Receive ${lotCount(eligible.length)} into ${branchName}`}
          </Button>
        )}
      </div>
    </Modal>
  );
}
