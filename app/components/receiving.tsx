'use client';
import { useEffect, useRef, useState } from 'react';
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
  active = true,
}: {
  branch: string;
  session: Session;
  onPrice: (ids: string[]) => void;
  active?: boolean;
}) {
  const [tab, setTab] = useState('deliveries'),
    [batch, setBatch] = useState<Batch | null>(null),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]),
    [editing, setEditing] = useState<string | null>(null),
    [uploading, setUploading] = useState(false),
    [receiving, setReceiving] = useState(false);
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
  const query = new URLSearchParams({
    page: String(page),
    search,
    task,
    sort,
    ...(categoryFilter ? { category_id: categoryFilter } : {}),
    ...(batch ? { batch_id: batch.id } : {}),
  }).toString();
  const inventory = usePosRead<{
    items: CatalogItem[];
    total: number;
    total_units: number;
    page: number;
    limit: number;
  }>(`/catalog-workspace/items?${query}`, branch);
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
  const selectedItems = inventory.data?.items.filter((item) => selected.includes(item.id)) || [];
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
    inventory.refresh();
    batches.refresh();
    receipts.refresh();
    setSelected([]);
  }
  function openBatch(value: Batch) {
    setReceiptPage(1);
    setBatch(value);
    setTab('lots');
    setSearch('');
    setPage(1);
    setSelected([]);
  }
  function changeTab(value: string) {
    initialViewChosen.current = true;
    setTab(value);
    setSelected([]);
    setPage(1);
  }
  useEffect(() => setSelected([]), [query]);
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
      setSelected([]);
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
      <Tabs value={tab} onValueChange={(value) => changeTab(String(value))}>
        <TabsList variant="line">
          {!batch && <TabsTrigger value="deliveries">Deliveries</TabsTrigger>}
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
      {tab === 'lots' && (
        <>
          <div className="toolbar mt-6">
            <SearchField
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
                setSelected([]);
              }}
              placeholder="Find incoming merchandise"
            />
            <span className="muted">
              {inventory.data?.total?.toLocaleString() ?? '—'} lots /{' '}
              {inventory.data?.total_units?.toLocaleString() ?? '—'} units
            </span>
          </div>
          <div className="flex flex-wrap gap-3 mb-4">
            <label className="flex-1 min-w-36">
              Task
              <select
                aria-label="Receiving task"
                className="w-full min-w-0"
                value={task}
                onChange={(event) => {
                  setTask(event.target.value);
                  setPage(1);
                  setSelected([]);
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
              </select>
            </label>
            <label className="flex-1 min-w-36">
              Category
              <select
                aria-label="Receiving category"
                className="w-full min-w-0"
                value={categoryFilter}
                onChange={(event) => {
                  setCategoryFilter(event.target.value);
                  setPage(1);
                  setSelected([]);
                }}
              >
                <option value="">All categories</option>
                {refs.data?.data.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex-1 min-w-36">
              Sort
              <select
                aria-label="Receiving sort"
                className="w-full min-w-0"
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value);
                  setPage(1);
                  setSelected([]);
                }}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name">Name A–Z</option>
              </select>
            </label>
          </div>
          {inventory.error ? (
            <p role="alert" className="error">
              {inventory.error}
            </p>
          ) : inventory.loading ? (
            <p role="status" className="loading">
              Loading merchandise…
            </p>
          ) : !inventory.data?.items.length ? (
            <div className="empty-state">
              <h2>
                {search || task !== 'all' || categoryFilter
                  ? 'No merchandise matches.'
                  : 'No merchandise here yet.'}
              </h2>
              {search || task !== 'all' || categoryFilter ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch('');
                    setTask('all');
                    setCategoryFilter('');
                    setPage(1);
                    setSelected([]);
                  }}
                >
                  Clear filters
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
                        setSelected((prior) =>
                          checked ? [...prior, item.id] : prior.filter((id) => id !== item.id),
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
                    onClick={() => setEditing(item.id)}
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
              <Button variant="ghost" onClick={() => setSelected([])}>
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
                <Button onClick={() => setReceiving(true)}>
                  <ArrowDownToLine size={16} />
                  Review receipt
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
          ids={selected}
          branch={branch}
          branchName={session.branches.find((b) => b.id === branch)?.name || ''}
          onClose={() => setReceiving(false)}
          onComplete={refreshReceiving}
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

/** Reconcile per-lot outcomes and retry stable publication IDs after partial or uncertain responses. */
function ReceiveReview({
  ids,
  branch,
  branchName,
  onClose,
  onComplete,
}: {
  ids: string[];
  branch: string;
  branchName: string;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [items, setItems] = useState<(CatalogItem & { publication_revision: string })[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [results, setResults] = useState<Record<string, string>>({}),
    [finished, setFinished] = useState(false);
  const [reviewVersion, setReviewVersion] = useState(0),
    [needsReview, setNeedsReview] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    /* Reread all selected lots before showing the receipt summary and readiness blockers. */

    let cancelled = false;
    active.current = true;
    setLoading(true);
    setError('');
    Promise.all(
      ids.map((id) =>
        requestPos<{ item: CatalogItem; blockers: string[]; publication_revision: string }>(
          `/catalog-workspace/items/${id}`,
          branch,
        ),
      ),
    )
      .then((rows) => {
        if (!cancelled && active.current) {
          setItems(
            rows.map((row) => ({
              ...row.item,
              blockers: row.blockers,
              publication_revision: row.publication_revision,
            })),
          );
          setNeedsReview(false);
          setResults((previous) =>
            Object.fromEntries(Object.entries(previous).filter(([, outcome]) => outcome === 'Received')),
          );
        }
      })
      .catch((cause) => {
        if (!cancelled && active.current) setError(cause.message);
      })
      .finally(() => {
        if (!cancelled && active.current) setLoading(false);
      });
    return () => {
      cancelled = true;
      active.current = false;
    };
  }, [ids, branch, reviewVersion]);
  async function receiveSelected() {
    /* Publish stable lot IDs individually so partial success can be reconciled and retried. */

    setBusy(true);
    setError('');
    const token = sessionStorage.getItem('kline.session');
    const outcomes = { ...results };
    for (const item of items) {
      if (!active.current || sessionStorage.getItem('kline.session') !== token) break;
      if (outcomes[item.id] === 'Received' || item.is_published) continue;
      try {
        await postPos(`/catalog-workspace/items/${item.id}/receive`, branch, {
          expected_revision: item.publication_revision,
        });
        outcomes[item.id] = 'Received';
      } catch (cause) {
        outcomes[item.id] = (cause as Error).message;
        if (cause instanceof ApiError && cause.status === 409) setNeedsReview(true);
      }
      if (active.current) setResults({ ...outcomes });
    }
    if (active.current) {
      setBusy(false);
      setFinished(items.every((item) => item.is_published || outcomes[item.id] === 'Received'));
    }
  }
  return (
    <Modal
      title={finished ? 'Delivery received' : 'Receive into POS'}
      description={branchName}
      wide
      onClose={() => {
        if (!busy) {
          if (Object.values(results).includes('Received')) onComplete();
          onClose();
        }
      }}
    >
      {loading ? (
        <p role="status">Checking saved merchandise…</p>
      ) : (
        <>
          <div className="receipt-summary">
            <strong>
              {items.reduce((sum, item) => sum + Number(item.stock_quantity), 0)} <small>units</small>
            </strong>
            <span>
              {items.length} lots · {items.reduce((sum, item) => sum + item.variant_lines.length, 0)} sizes
            </span>
          </div>
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
                {items.flatMap((item) =>
                  /* Expand photographed lots into the exact sellable sizes shown in the receiving review. */ item.variant_lines.map(
                    (line) => (
                      /* Label each receiving line with its product, size, unit count and current saved price. */ <tr
                        key={line.id}
                      >
                        <td>
                          <strong>{item.name || 'Unnamed lot'}</strong>
                          <small className="block">
                            {Object.values(line.variant_attributes).join(' / ') || 'Standard'}
                          </small>
                        </td>
                        <td>{line.quantity}</td>
                        <td>{formatMoney(line.effective_price)}</td>
                      </tr>
                    ),
                  ),
                )}
              </tbody>
            </table>
          </div>
          {items.map((item) => (
            /* Display completed, blocked and failed lots independently after a partial batch attempt. */ <div
              key={item.id}
              className="receipt-outcome"
            >
              <strong>{item.name || 'Unnamed lot'}</strong>
              {item.is_published || results[item.id] === 'Received' ? (
                <span className="ready">Received</span>
              ) : results[item.id] ? (
                <span className="error">{results[item.id]}</span>
              ) : item.blockers.length ? (
                <span>{item.blockers.join(' ')}</span>
              ) : (
                <span className="muted">Ready</span>
              )}
            </div>
          ))}
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            if (Object.values(results).includes('Received')) onComplete();
            onClose();
          }}
        >
          {finished ? 'Done' : 'Back'}
        </Button>
        {!finished && needsReview ? (
          <Button disabled={busy || loading} onClick={() => setReviewVersion((version) => version + 1)}>
            Review changed lots
          </Button>
        ) : (
          !finished && (
            <Button
              disabled={
                busy || loading || !!error || !items.length || items.some((item) => item.blockers.length > 0)
              }
              onClick={receiveSelected}
            >
              {busy
                ? 'Receiving…'
                : Object.keys(results).length
                  ? 'Retry unresolved lots'
                  : 'Receive into POS'}
            </Button>
          )
        )}
      </div>
    </Modal>
  );
}
