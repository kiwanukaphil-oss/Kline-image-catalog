'use client';
import { useEffect, useState } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { requestPos, formatMoney, type Variant } from '@/lib/catalog-api';
import { Modal, Pagination, Photo, SearchField, usePosRead } from './workspace-ui';
import { useWorkspaceTool } from '@/lib/webmcp';
import { posProductLink } from '@/lib/pos-navigation';
type StockLine = Variant & { stock_state: string };
type StockChoice = { id: string; label: string };
type Product = {
  product_id: string;
  name: string;
  brand: string;
  master_sku: string;
  category_name: string;
  quantity: number;
  image_url: string | null;
  variants: StockLine[];
};
type StockResult = {
  products: Product[];
  total: number;
  page: number;
  limit: number;
  updated_at: string;
  sizes: string[];
  categories: StockChoice[];
  brands: StockChoice[];
};
type Movement = {
  id: string;
  created_at: string;
  movement_type: string;
  quantity_change: number;
  new_quantity: number;
  sku: string;
  variant_attributes: Record<string, string>;
};
const states = [
  ['all', 'All stock'],
  ['low', 'Low sizes'],
  ['out', 'Out of stock'],
  ['negative', 'Discrepancies'],
] as const;
const labelState = (state: string) =>
  ({ low: 'Low stock', out: 'Out of stock', negative: 'Negative stock', in: 'In stock' })[state] || state;

/** Refresh authoritative POS snapshots while visible; retain a timestamped snapshot after transient failures. */
export function Stock({ branch, canOpenPos }: { branch: string; canOpenPos: boolean }) {
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [brand, setBrand] = useState(''),
    [size, setSize] = useState(''),
    [state, setState] = useState('all'),
    [page, setPage] = useState(1);
  const [data, setData] = useState<StockResult | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [version, setVersion] = useState(0);
  const [product, setProduct] = useState<Product | null>(null);
  const [choices, setChoices] = useState<{
    sizes: string[];
    categories: StockChoice[];
    brands: StockChoice[];
  }>({ sizes: [], categories: [], brands: [] });
  const query = new URLSearchParams({
    search,
    size,
    state,
    category_id: category,
    brand_id: brand,
    page: String(page),
  }).toString();
  useWorkspaceTool({
    name: 'read_visible_stock',
    title: 'Read visible stock',
    description:
      'Read the current branch, filters, freshness and POS quantities shown in Stock. Does not receive or adjust inventory.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: (input) => {
      /* Read the same branch-scoped snapshot and freshness state visible to the operator. */

      if (!input || typeof input !== 'object' || Object.keys(input).length)
        throw new Error('This tool takes an empty object.');
      if (!data) throw new Error('Stock has not loaded successfully.');
      return {
        branch_id: branch,
        filters: { search, size, state, category_id: category, brand_id: brand, page },
        updated_at: data.updated_at,
        stale: !!error,
        total: data.total,
        products: data.products.map(({ image_url: _imageUrl, ...product }) => product),
      };
    },
  });
  useEffect(() => {
    setData(null);
    setProduct(null);
  }, [query, branch]);
  useEffect(() => {
    /* Cancel obsolete filter requests while preserving a successful snapshot on refresh failures. */

    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      /* Debounce search requests and replace the visible snapshot only after a successful POS read. */

      requestPos<StockResult>(`/catalog-workspace/stock?${query}`, branch, { signal: controller.signal })
        .then((result) => {
          setData(result);
          setChoices({ sizes: result.sizes, categories: result.categories, brands: result.brands });
          setError('');
          setProduct((previous) =>
            previous ? result.products.find((p) => p.product_id === previous.product_id) || null : null,
          );
        })
        .catch((cause) => {
          if (cause.name !== 'AbortError') setError(cause.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [branch, query, version]);
  useEffect(() => {
    /* Refresh visible stock every thirty seconds and when the operator returns to this page. */

    const refresh = () => {
      if (document.visibilityState === 'visible') setVersion((v) => v + 1);
    };
    const interval = setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  function changeFilter(update: () => void) {
    update();
    setPage(1);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ON THE SHOP FLOOR</span>
          <h1>Stock</h1>
          <p className="muted">Current availability, straight from POS.</p>
        </div>
        <Button variant="outline" disabled={loading} onClick={() => setVersion((v) => v + 1)}>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>
      <div className="toolbar stock-toolbar">
        <SearchField
          value={search}
          onChange={(value) => changeFilter(() => setSearch(value))}
          placeholder="Search product, brand, SKU or barcode"
        />
        <select
          aria-label="Filter by category"
          value={category}
          onChange={(e) => changeFilter(() => setCategory(e.target.value))}
        >
          <option value="">All categories</option>
          {choices.categories.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by brand"
          value={brand}
          onChange={(e) => changeFilter(() => setBrand(e.target.value))}
        >
          <option value="">All brands</option>
          {choices.brands.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by size"
          value={size}
          onChange={(e) => changeFilter(() => setSize(e.target.value))}
        >
          <option value="">All sizes</option>
          {choices.sizes.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </div>
      <div className="stock-filters">
        {states.map(([value, label]) => (
          <Button
            key={value}
            variant={state === value ? 'default' : 'ghost'}
            onClick={() => changeFilter(() => setState(value))}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="result-line">
        <span>
          {data
            ? `${data.total} products${size ? ` · size ${size}` : ''}`
            : loading
              ? 'Loading stock…'
              : 'Stock unavailable'}
        </span>
        <span>
          {data
            ? `${error ? 'Update failed · ' : ''}Updated ${new Date(data.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
            : ''}
        </span>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
          {data ? ' Showing the last successful update.' : ''}
        </p>
      )}
      {data && data.products.length === 0 ? (
        <div className="empty-state">
          <h2>No matching stock.</h2>
          <p>Try another search or filter.</p>
          <Button
            variant="outline"
            onClick={() =>
              changeFilter(() => {
                setSearch('');
                setCategory('');
                setBrand('');
                setSize('');
                setState('all');
              })
            }
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="stock-grid">
          {data?.products.map((item) => (
            /* Render products from POS identities with size-level shortages and linked evidence imagery. */ <button
              className="stock-card"
              key={item.product_id}
              onClick={() => setProduct(item)}
            >
              <div className="stock-image">
                <Photo url={item.image_url} name={item.name} />
                <span className="category-label">{item.category_name || 'Merchandise'}</span>
              </div>
              <div className="stock-card-body">
                <span className="eyebrow">{item.brand || 'UNBRANDED'}</span>
                <h2>{item.name}</h2>
                <div className="stock-card-count">
                  <strong>
                    {item.quantity}
                    <small> units{size ? ' in this size' : ''}</small>
                  </strong>
                  <span>
                    {new Set(item.variants.map((line) => formatMoney(line.effective_price))).size > 1
                      ? 'From '
                      : ''}
                    UGX {formatMoney(Math.min(...item.variants.map((line) => Number(line.effective_price))))}
                  </span>
                </div>
                <div className="size-chips">
                  {item.variants.slice(0, 6).map((line) => (
                    <span key={line.id} className={`size-chip ${line.stock_state}`}>
                      <b>{Object.values(line.variant_attributes).join(' / ') || 'Standard'}</b>
                      <span>{line.quantity}</span>
                    </span>
                  ))}
                  {item.variants.length > 6 && <small>+{item.variants.length - 6} sizes</small>}
                </div>
                <div className="card-bottom">
                  <small>
                    {item.variants.some((line) => line.stock_state === 'negative')
                      ? 'Negative stock needs review'
                      : item.variants.some((line) => line.stock_state === 'out')
                        ? 'Some sizes out of stock'
                        : item.variants.some((line) => line.stock_state === 'low')
                          ? 'Some sizes running low'
                          : 'In stock'}
                  </small>
                  <ArrowUpRight size={15} />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {data && <Pagination page={page} total={data.total} limit={data.limit} onChange={setPage} />}
      {product && (
        <StockDetail
          canOpenPos={canOpenPos}
          key={product.product_id}
          product={product}
          branch={branch}
          updated={data?.updated_at || ''}
          onClose={() => setProduct(null)}
        />
      )}
    </>
  );
}

/** Movement balances belong to the named variant; receiving history is never substituted for availability. */
function StockDetail({
  canOpenPos,
  product,
  branch,
  updated,
  onClose,
}: {
  canOpenPos: boolean;
  product: Product;
  branch: string;
  updated: string;
  onClose: () => void;
}) {
  const movements = usePosRead<Movement[]>(
    `/catalog-workspace/stock/${product.product_id}/movements`,
    branch,
  );
  const posUrl = canOpenPos ? posProductLink(product.product_id, branch, 'product') : null;
  return (
    <Modal
      title={product.name}
      description={`${product.brand || 'Unbranded'} · ${product.master_sku || ''}`}
      wide
      onClose={onClose}
    >
      <div className="stock-detail">
        <Photo url={product.image_url} name={product.name} />
        <div>
          <span className="eyebrow">CURRENT POS STOCK</span>
          <h2 className="stock-total">
            {product.quantity}
            <small> units</small>
          </h2>
          <p className="muted">Updated {new Date(updated).toLocaleTimeString()}</p>
          {posUrl && (
            <a className="pos-link" href={posUrl} target="_blank" rel="noreferrer">
              Open product in POS <ArrowUpRight size={15} />
            </a>
          )}
          {posUrl && (
            <div className="flex flex-wrap gap-4">
              <a
                className="pos-link"
                href={posProductLink(product.product_id, branch, 'prices')!}
                target="_blank"
                rel="noreferrer"
              >
                Prices in POS <ArrowUpRight size={15} />
              </a>
              <a
                className="pos-link"
                href={posProductLink(product.product_id, branch, 'stock')!}
                target="_blank"
                rel="noreferrer"
              >
                Stock in POS <ArrowUpRight size={15} />
              </a>
            </div>
          )}
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Size / SKU</th>
              <th>Available</th>
              <th>Price / UGX</th>
              <th>Stock state</th>
            </tr>
          </thead>
          <tbody>
            {product.variants.map((line) => (
              /* Show each variant balance and its configured reorder threshold without inventing a threshold. */ <tr
                key={line.id}
              >
                <td>
                  <strong>{Object.values(line.variant_attributes).join(' / ') || 'Standard'}</strong>
                  <small className="block">{line.sku}</small>
                </td>
                <td>
                  <strong>{line.quantity}</strong>
                </td>
                <td>{formatMoney(line.effective_price)}</td>
                <td>
                  <span className={`stock-badge ${line.stock_state}`}>{labelState(line.stock_state)}</span>
                  <small className="block">
                    {line.reorder_level == null
                      ? 'Reorder level not configured'
                      : `Reorder at ${line.reorder_level}`}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Recent movements</h2>
      {movements.loading ? (
        <p role="status">Loading movements…</p>
      ) : movements.error ? (
        <p role="alert" className="error">
          {movements.error}
        </p>
      ) : movements.data?.length ? (
        <div className="movement-list">
          {movements.data.map((row) => (
            /* Keep movement changes and resulting balances attached to the corresponding POS variant. */ <div
              key={row.id}
            >
              <span className="movement-sign">
                {row.quantity_change > 0 ? '+' : ''}
                {row.quantity_change}
              </span>
              <div>
                <strong>{row.movement_type.replaceAll('_', ' ')}</strong>
                <small>
                  {Object.values(row.variant_attributes).join(' / ')} · balance {row.new_quantity}
                </small>
              </div>
              <time>{new Date(row.created_at).toLocaleString()}</time>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">No recorded movements for this product at this branch.</p>
      )}
    </Modal>
  );
}
