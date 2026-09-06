'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { postPos, formatMoney, type CatalogItem } from '@/lib/catalog-api';
import { posProductLink } from '@/lib/pos-navigation';
import { Modal, SearchField, usePosRead } from './workspace-ui';
type Product = {
  id: string;
  name: string;
  master_sku: string;
  variants: { id: string; sku: string; attributes: Record<string, string>; price: number }[] | null;
};
type Review = {
  revision: string;
  product: { name: string };
  total_units: number;
  rows: {
    line_id: string;
    sku: string;
    attributes: Record<string, string>;
    pos_attributes: Record<string, string>;
    quantity: number;
    incoming_price: number;
    selling_price: number;
  }[];
};
/** Deliberate per-size matching precedes a signed review; existing POS prices and costs are retained. */
export function Restock({
  item,
  branch,
  onClose,
  onReceived,
}: {
  item: CatalogItem;
  branch: string;
  onClose: () => void;
  onReceived: () => void;
}) {
  const [search, setSearch] = useState(''),
    [product, setProduct] = useState<Product | null>(null),
    [matches, setMatches] = useState<Record<string, string>>({});
  const [review, setReview] = useState<Review | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const options = usePosRead<Product[]>(
    `/catalog-workspace/items/${item.id}/restock-options?search=${encodeURIComponent(search)}`,
    branch,
  );
  const link = product ? posProductLink(product.id, branch, 'stock') : null;
  async function submitRestock(apply: boolean) {
    // The same reviewed identities travel on retry; the server resolves an already committed receipt idempotently.
    if (!product) return;
    setBusy(true);
    setError('');
    try {
      const result = await postPos<Review>(
        `/catalog-workspace/items/${item.id}/restock/${apply ? 'receive' : 'review'}`,
        branch,
        {
          product_id: product.id,
          matches: item.variant_lines.map((line) => ({ line_id: line.id, variant_id: matches[line.id] })),
          expected_revision: review?.revision,
        },
      );
      if (apply) onReceived();
      else setReview(result);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Restock existing product"
      description={item.name}
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {(error || options.error) && (
        <p role="alert" className="error">
          {error || options.error}
        </p>
      )}
      {review ? (
        <>
          <h2>
            {review.product.name} · {review.total_units} units
          </h2>
          <p>POS selling prices and costs stay unchanged.</p>
          {review.rows.map((row) => (
            <div key={row.line_id} className="border rounded-lg p-3 space-y-1">
              <strong>
                {Object.values(row.attributes).join(' / ')} → {Object.values(row.pos_attributes).join(' / ')}{' '}
                · {row.sku}
              </strong>
              <p>
                {row.quantity} units · POS price {formatMoney(row.selling_price)}
              </p>
              {row.incoming_price !== row.selling_price && (
                <small>Incoming lot price: {formatMoney(row.incoming_price)}</small>
              )}
            </div>
          ))}
          <div className="dialog-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setReview(null);
                setError('');
                options.refresh();
              }}
            >
              Change match
            </Button>
            <Button disabled={busy} onClick={() => submitRestock(true)}>
              {busy ? 'Receiving…' : 'Confirm restock'}
            </Button>
          </div>
        </>
      ) : product ? (
        <>
          <h2>
            {product.name} · {product.master_sku}
          </h2>
          {item.variant_lines.map((line) => (
            <label key={line.id}>
              {Object.values(line.variant_attributes).join(' / ') || 'One size'} · {line.quantity} units
              <select
                aria-label={`POS variant for ${Object.values(line.variant_attributes).join(' / ') || 'One size'}`}
                disabled={busy}
                value={matches[line.id] || ''}
                onChange={(event) => setMatches({ ...matches, [line.id]: event.target.value })}
              >
                <option value="">Choose matching POS variant</option>
                {(product.variants || []).map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {Object.values(variant.attributes).join(' / ')} · {variant.sku}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {link && (
            <a href={link} target="_blank" rel="noreferrer">
              Add a missing size in POS
            </a>
          )}
          <div className="dialog-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setProduct(null);
                setMatches({});
                options.refresh();
              }}
            >
              Choose product
            </Button>
            <Button
              disabled={busy || item.variant_lines.some((line) => !matches[line.id])}
              onClick={() => submitRestock(false)}
            >
              Review restock
            </Button>
          </div>
        </>
      ) : (
        <>
          <SearchField value={search} onChange={setSearch} placeholder="Find POS product, SKU or barcode" />
          {options.loading ? (
            <p role="status">Finding products…</p>
          ) : options.data?.length ? (
            options.data.map((row) => (
              <Button
                key={row.id}
                variant="outline"
                className="min-h-12 h-auto whitespace-normal justify-between gap-3"
                onClick={() => {
                  setProduct(row);
                  setMatches({});
                  setError('');
                }}
              >
                <span>{row.name}</span>
                <small>{row.master_sku}</small>
              </Button>
            ))
          ) : (
            <p>No active products match in this category.</p>
          )}
        </>
      )}
    </Modal>
  );
}
