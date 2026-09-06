'use client';
import { useState } from 'react';
import { Modal, Pagination, usePosRead } from './workspace-ui';
type Activity = {
  id: string;
  created_at: string;
  actor: string;
  source: string;
  field: string;
  before: unknown;
  after: unknown;
};
/** Render recorded values in plain language; protected and unknown fields have already been removed by POS. */
function describeValue(value: unknown): string {
  if (value === null || value === undefined) return 'Not set';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value !== 'object') return 'Not recorded';
  if (Array.isArray(value)) return value.map(describeValue).join('; ') || 'None';
  return (
    Object.entries(value)
      .map(([key, entry]) => `${key.replaceAll('_', ' ')}: ${describeValue(entry)}`)
      .join(' · ') || 'No recorded details'
  );
}
/** Load activity only when requested, preserving parent edits and branch-scoped pagination. */
export function ItemActivity({
  itemId,
  branch,
  name,
  onClose,
}: {
  itemId: string;
  branch: string;
  name: string;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const activity = usePosRead<{ items: Activity[]; total: number; limit: number }>(
    `/catalog-workspace/items/${itemId}/activity?page=${page}`,
    branch,
  );
  const labels: Record<string, string> = {
    ai: 'AI fill',
    manual: 'Manual edit',
    pricing: 'Pricing',
    undo: 'Undo',
    shop: 'POS',
    approval: 'Receiving',
    upload: 'Photo added',
    system: 'System',
  };
  return (
    <Modal title="Item activity" description={name} onClose={onClose} wide>
      {activity.error ? (
        <p role="alert" className="error">
          {activity.error}
        </p>
      ) : activity.loading ? (
        <p role="status">Loading activity…</p>
      ) : activity.data?.items.length ? (
        <>
          {activity.data.items.map((event) => (
            <article key={event.id} className="border-b py-3 space-y-2">
              <strong>
                {labels[event.source]} · {event.field}
              </strong>
              <p className="text-sm text-muted-foreground">
                {event.actor} ·{' '}
                <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time>
              </p>
              {(event.before !== null || event.after !== null) && (
                <details>
                  <summary className="cursor-pointer">Recorded changes</summary>
                  <div className="mt-2 space-y-2 break-words">
                    <p>Before: {describeValue(event.before)}</p>
                    <p>After: {describeValue(event.after)}</p>
                  </div>
                </details>
              )}
            </article>
          ))}
          <Pagination
            page={page}
            total={activity.data.total}
            limit={activity.data.limit}
            onChange={setPage}
          />
        </>
      ) : (
        <p>No recorded activity for this item.</p>
      )}
    </Modal>
  );
}
