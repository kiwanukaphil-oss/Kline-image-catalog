'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatMoney, postPos, requestPos, type Session } from '@/lib/catalog-api';
import type { PricePlan } from '@/lib/pricing';
import { Modal, Pagination, usePosRead } from './workspace-ui';
type Entry = Pick<PricePlan, 'id' | 'status' | 'applied_at' | 'undone_at' | 'summary'> & { actor: string };

/** Reopen persisted, account-scoped receipts; all exact reads and Undo retain POS permission and concurrency checks. */
export function PricingHistory({
  branch,
  session,
  onClose,
  onChanged,
}: {
  branch: string;
  session: Session;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [page, setPage] = useState(1),
    [rowPage, setRowPage] = useState(1);
  const history = usePosRead<{ items: Entry[]; total: number; limit: number }>(
    `/catalog-workspace/pricing-history?page=${page}`,
    branch,
  );
  const [entry, setEntry] = useState<Entry | null>(null),
    [plan, setPlan] = useState<PricePlan | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirmUndo, setConfirmUndo] = useState(false);
  async function openReceipt(selected: Entry) {
    // Load exact values from the existing POS serializer; never infer them from current merchandise prices.
    setBusy(true);
    setError('');
    setConfirmUndo(false);
    try {
      const result = await requestPos<{ data: PricePlan }>(`/catalog/pricing/plans/${selected.id}`, branch);
      setEntry(selected);
      setPlan(result.data);
      setRowPage(1);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function undoReceipt() {
    // Retrying the same ID is safe; later edits or received stock cause a conflict instead of being overwritten.
    if (!plan) return;
    setBusy(true);
    setError('');
    try {
      const result = await postPos<{ data: PricePlan }>(`/catalog/pricing/plans/${plan.id}/undo`, branch, {});
      setPlan(result.data);
      setConfirmUndo(false);
      history.refresh();
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Your pricing history"
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {plan ? (
        <>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setPlan(null);
              setEntry(null);
              setError('');
            }}
          >
            Back to history
          </Button>
          <p>
            {entry?.actor} · {new Date(plan.applied_at).toLocaleString()} ·{' '}
            {plan.status === 'undone' ? 'Undone' : 'Applied'}
          </p>
          <p className="muted">
            {plan.summary.changed_count} sizes changed · {plan.summary.total_units} units
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Merchandise / size</th>
                  <th>Price before</th>
                  <th>Price saved</th>
                  {session.can_view_cost && plan.includes_costs && (
                    <>
                      <th>Cost before</th>
                      <th>Cost saved</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {plan.rows.slice((rowPage - 1) * 24, rowPage * 24).map((row) => (
                  <tr key={row.line_id}>
                    <td>
                      {row.name}
                      <small className="block">
                        {Object.values(row.variant_attributes).join(' / ') || 'Standard'}
                      </small>
                    </td>
                    <td>{formatMoney(row.price_before)}</td>
                    <td>{formatMoney(row.price_after)}</td>
                    {session.can_view_cost && plan.includes_costs && (
                      <>
                        <td>{formatMoney(row.cost_before)}</td>
                        <td>{formatMoney(row.cost_after)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={rowPage} total={plan.rows.length} limit={24} onChange={setRowPage} />
          {plan.status === 'applied' &&
            (!plan.includes_costs || session.can_view_cost) &&
            (confirmUndo ? (
              <div className="dialog-actions">
                <Button variant="outline" disabled={busy} onClick={() => setConfirmUndo(false)}>
                  Keep prices
                </Button>
                <Button disabled={busy} onClick={undoReceipt}>
                  {busy ? 'Restoring…' : 'Restore previous prices'}
                </Button>
              </div>
            ) : (
              <Button variant="outline" disabled={busy} onClick={() => setConfirmUndo(true)}>
                Undo these prices
              </Button>
            ))}
        </>
      ) : (
        <>
          {history.error ? (
            <p role="alert" className="error">
              {history.error}
            </p>
          ) : history.loading ? (
            <p role="status">Loading history…</p>
          ) : !history.data?.items.length ? (
            <p>No saved pricing changes yet.</p>
          ) : (
            history.data.items.map((item) => (
              <Button
                key={item.id}
                variant="outline"
                className="justify-between h-auto whitespace-normal"
                disabled={busy}
                onClick={() => openReceipt(item)}
              >
                <span>
                  {new Date(item.applied_at).toLocaleString()} · {item.actor}
                </span>
                <span>
                  {item.summary.changed_count} sizes · {item.status === 'undone' ? 'Undone' : 'Applied'}
                </span>
              </Button>
            ))
          )}
          {history.data && (
            <Pagination
              page={page}
              total={history.data.total}
              limit={history.data.limit}
              onChange={setPage}
            />
          )}
        </>
      )}
    </Modal>
  );
}
