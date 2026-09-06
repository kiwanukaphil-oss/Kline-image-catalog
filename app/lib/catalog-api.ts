/** POS HTTP boundary. Authentication and branch authorization remain server-owned. */
export const API_URL = process.env.NEXT_PUBLIC_POS_API_URL || 'http://127.0.0.1:5109/api';
export type Branch = { id: string; name: string; code: string; can_switch_to: boolean };
export type Session = {
  id: string;
  full_name: string;
  username: string;
  branches: Branch[];
  default_branch_id: string;
  can_edit: boolean;
  can_upload: boolean;
  can_publish: boolean;
  can_view_cost: boolean;
  can_ai_extract: boolean;
};
export type Variant = {
  id: string;
  variant_attributes: Record<string, string>;
  quantity: number;
  effective_price: number | null;
  price_override?: number | null;
  stock_quantity?: number;
  reorder_level?: number | null;
  sku?: string;
};
export type CatalogItem = {
  id: string;
  name: string;
  brand: string;
  category_id: string;
  image_url: string | null;
  attributes: Record<string, string | number | boolean | null>;
  variant_lines: Variant[];
  stock_quantity: number;
  updated_at: string;
  created_at: string;
  is_published: boolean;
  stock_distribution_source: string;
  blockers: string[];
  batch_id: string | null;
  batch_title: string | null;
  pos_product_id?: string;
  price: number | null;
  revision: string;
  status: string;
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Tokens stay scoped to this browser session; no secret is compiled into the app. */
export async function requestPos<T>(path: string, branchId = '', options: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem('kline.session');
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (branchId) headers.set('X-Branch-Id', branchId);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(API_URL + path, { ...options, headers, cache: 'no-store' });
  const result = (await response
    .json()
    .catch(() => ({ message: 'The service returned an unreadable response.' }))) as {
    message?: string;
    details?: unknown;
  };
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('kline-session-expired'));
    throw new ApiError(
      result.message || 'The request could not be completed.',
      response.status,
      result.details,
    );
  }
  return result as T;
}

export const postPos = <T>(path: string, branch: string, body: unknown) =>
  requestPos<T>(path, branch, { method: 'POST', body: JSON.stringify(body) });
export const formatMoney = (value: number | null | undefined) =>
  value == null ? 'Not set' : new Intl.NumberFormat('en-UG', { maximumFractionDigits: 2 }).format(value);
export const variantLabel = (line: Variant) =>
  Object.values(line.variant_attributes || {}).join(' / ') || 'Standard';
