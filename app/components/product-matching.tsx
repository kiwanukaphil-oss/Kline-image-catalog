'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { WorkspaceSelect } from './workspace-select';
import { Modal, Photo, SearchField, usePosRead } from './workspace-ui';
import { postPos, type CatalogItem } from '@/lib/catalog-api';

export type ProductMatch = {
  id: string;
  item_ids: string[];
  product_name: string;
  brand_name: string;
  target_product_id: string | null;
  variant_defaults: { color?: string; fit?: string };
  review_note: string;
  revision: string;
};
export type ProductMatchReview = {
  id: string;
  product_name: string;
  revision: string;
  total_units: number;
  lot_count: number;
  variant_count: number;
  new_variants: number;
  existing_variants: number;
  warnings: string[];
  already_received?: boolean;
  rows: { attributes: Record<string, string>; quantity: number; price: number; action: string }[];
};

/** Save explicit style identity separately from stock receipt; original evidence remains visible and unchanged. */
export function ProductMatching({
  items,
  branch,
  plan,
  onClose,
  onSaved,
}: {
  items: CatalogItem[];
  branch: string;
  plan?: ProductMatch;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState(plan?.target_product_id ? 'existing' : 'new');
  const [target, setTarget] = useState(plan?.target_product_id || '');
  const [search, setSearch] = useState('');
  const [name, setName] = useState(plan?.product_name || items[0]?.name || '');
  const [brand, setBrand] = useState(plan?.brand_name || items[0]?.brand || '');
  const [color, setColor] = useState(plan?.variant_defaults.color || '');
  const [fit, setFit] = useState(plan?.variant_defaults.fit || '');
  const [note, setNote] = useState(plan?.review_note || '');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const products = usePosRead<
    {
      id: string;
      name: string;
      master_sku: string;
      brand_name?: string;
      image_url?: string;
      variants: { attributes: Record<string, string> }[] | null;
    }[]
  >(`/catalog-workspace/items/${items[0]?.id}/restock-options?search=${encodeURIComponent(search)}`, branch);
  async function saveMatch() {
    // Saving a grouping never creates products or stock; receiving revalidates all source and target records.
    setBusy(true);
    setError('');
    try {
      await postPos('/catalog-workspace/product-matches', branch, {
        id: plan?.id,
        expected_revision: plan?.revision,
        item_ids: items.map((item) => item.id),
        target_product_id: mode === 'existing' ? target : null,
        product_name: name,
        brand_name: brand,
        variant_defaults: {
          ...(color.trim() ? { color: color.trim() } : {}),
          ...(fit.trim() ? { fit: fit.trim() } : {}),
        },
        review_note: note,
        confirm_differences: confirmed,
      });
      onSaved();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function unmatch() {
    // Retire only the grouping decision; each original lot and its audit history remain intact.
    if (!plan) return;
    setBusy(true);
    setError('');
    try {
      await postPos(`/catalog-workspace/product-matches/${plan.id}/unmatch`, branch, {
        expected_revision: plan.revision,
      });
      onSaved();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Match product"
      description={`${items.length} lots / ${items.reduce((sum, item) => sum + Number(item.stock_quantity), 0)} units`}
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="matching-evidence">
        {items.map((item) => (
          <article key={item.id}>
            <a
              href={item.image_url || undefined}
              target="_blank"
              rel="noreferrer"
              aria-label={`View original photo of ${item.name}`}
            >
              <Photo url={item.image_url} name={item.name} />
            </a>
            <strong>{item.name}</strong>
            <small>{item.brand}</small>
            <small>
              {Object.entries(item.attributes || {})
                .filter(([key]) => ['color', 'fit', 'sleeve', 'pattern', 'material', 'style'].includes(key))
                .map(([key, value]) => `${key}: ${value}`)
                .join(' / ')}
            </small>
            <small>
              {item.variant_lines
                .map((line) => `${Object.values(line.variant_attributes).join('/')} × ${line.quantity}`)
                .join(', ')}
            </small>
          </article>
        ))}
      </div>
      <label htmlFor="product-destination">
        Destination
        <WorkspaceSelect
          id="product-destination"
          aria-label="Product destination"
          value={mode}
          onValueChange={setMode}
        >
          <option value="new">One new product</option>
          <option value="existing">Existing POS product</option>
        </WorkspaceSelect>
      </label>
      {mode === 'existing' && (
        <section className="space-y-3">
          <SearchField value={search} onChange={setSearch} placeholder="Find POS product by name or SKU" />
          {products.loading ? (
            <p role="status">Finding products...</p>
          ) : products.error ? (
            <p role="alert">{products.error}</p>
          ) : (
            <WorkspaceSelect
              aria-label="Matching POS product"
              value={target}
              onValueChange={(value) => {
                setTarget(value);
                const product = products.data?.find((row) => row.id === value);
                if (product) {
                  setName(product.name);
                  if (product.brand_name) setBrand(product.brand_name);
                }
              }}
            >
              <option value="">Choose product</option>
              {products.data?.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} / {product.master_sku}
                </option>
              ))}
            </WorkspaceSelect>
          )}
          {target &&
            products.data
              ?.filter((product) => product.id === target)
              .map((product) => (
                <div key={product.id} className="receipt-outcome">
                  <Photo url={product.image_url || null} name={product.name} />
                  <span>
                    {product.variants
                      ?.map((variant) => Object.values(variant.attributes).join('/'))
                      .join(', ')}
                  </span>
                </div>
              ))}
          <p className="muted">
            Matching variants receive stock. Missing sizes or colours become new variants. Existing POS prices
            and costs stay unchanged.
          </p>
        </section>
      )}
      <div className="receiving-scope-filters">
        <label>
          Product name
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={mode === 'existing'}
          />
        </label>
        <label>
          Brand
          <Input
            value={brand}
            onChange={(event) => setBrand(event.target.value)}
            disabled={mode === 'existing'}
          />
        </label>
      </div>
      <div className="receiving-scope-filters">
        <label>
          Shared colour (optional)
          <Input
            value={color}
            onChange={(event) => setColor(event.target.value)}
            placeholder="Keep each lot's colour"
          />
        </label>
        <label>
          Shared fit (optional)
          <Input
            value={fit}
            onChange={(event) => setFit(event.target.value)}
            placeholder="Keep each lot's fit"
          />
        </label>
      </div>
      <label>
        Matching evidence
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. same model 26201A-6 on every label"
        />
      </label>
      <div className="flex gap-3 items-start">
        <Checkbox
          id="confirm-product-match"
          aria-label="Confirm same style"
          checked={confirmed}
          onCheckedChange={(value) => setConfirmed(!!value)}
        />
        <label htmlFor="confirm-product-match">
          These lots are the same style. I checked model, fabric, fit and design against the photos.
        </label>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button variant="outline" disabled={busy} onClick={onClose}>
          Back
        </Button>
        {plan && (
          <Button variant="outline" disabled={busy} onClick={unmatch}>
            Keep lots separate
          </Button>
        )}
        <Button
          disabled={
            busy ||
            !confirmed ||
            !name.trim() ||
            !brand.trim() ||
            !note.trim() ||
            (mode === 'existing' && !target)
          }
          onClick={saveMatch}
        >
          {busy ? 'Saving...' : 'Save product match'}
        </Button>
      </div>
    </Modal>
  );
}
