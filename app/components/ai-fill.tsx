'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { postPos, requestPos, type CatalogItem } from '@/lib/catalog-api';
import type { AiBatch, AiBatchSummary } from '@/lib/ai-batches';
import { Modal, Photo } from './workspace-ui';

/** Submit durable intent once; browser polling reports progress but never drives extraction. */
export function AiFill({
  items = [],
  batchId,
  branch,
  onClose,
  onReview,
  onPrice,
  onExtracted,
}: {
  items?: CatalogItem[];
  batchId?: string;
  branch: string;
  onClose: () => void;
  onReview: (id: string) => void;
  onPrice?: (ids: string[]) => void;
  onExtracted?: () => void;
}) {
  const [id, setId] = useState(batchId);
  const [batch, setBatch] = useState<AiBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [submissionPending, setSubmissionPending] = useState(false);
  const extractedCallback = useRef(onExtracted);
  const completedCount = useRef<number | null>(null);
  extractedCallback.current = onExtracted;
  useEffect(() => {
    // Refresh on return to the foreground; no background timer is required for server progress.
    if (!id) return;
    let cancelled = false,
      fetching = false;
    async function refreshProgress() {
      if (cancelled || fetching || document.visibilityState === 'hidden') return;
      fetching = true;
      try {
        const saved = await requestPos<AiBatch>(`/catalog-workspace/ai-batches/${id}`, branch);
        if (cancelled) return;
        setBatch(saved);
        setError('');
        const count = saved.items.filter((item) => item.state === 'done').length;
        if (completedCount.current !== null && completedCount.current !== count)
          extractedCallback.current?.();
        completedCount.current = count;
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message);
      } finally {
        fetching = false;
      }
    }
    void refreshProgress();
    const timer = window.setInterval(() => void refreshProgress(), 4000);
    document.addEventListener('visibilitychange', refreshProgress);
    window.addEventListener('online', refreshProgress);
    window.addEventListener('focus', refreshProgress);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshProgress);
      window.removeEventListener('online', refreshProgress);
      window.removeEventListener('focus', refreshProgress);
    };
  }, [id, branch]);

  async function submitBatch() {
    // Retain the key after a lost acknowledgement; repeating acceptance cannot duplicate work.
    setBusy(true);
    setError('');
    setSubmissionPending(true);
    try {
      const selectionKey = `kline.ai-submission:${branch}:${items.map((item) => item.id).join(',')}`;
      const submissionKey = sessionStorage.getItem(selectionKey) || crypto.randomUUID();
      sessionStorage.setItem(selectionKey, submissionKey);
      const saved = await postPos<AiBatch>('/catalog-workspace/ai-batches', branch, {
        item_ids: items.map((item) => item.id),
        submission_key: submissionKey,
      });
      setBatch(saved);
      setId(saved.id);
      setSubmissionPending(false);
      sessionStorage.removeItem(selectionKey);
      window.dispatchEvent(new Event('kline-ai-batches-changed'));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function changeBatch(action: 'stop' | 'resume') {
    // Stop and retry decisions are persisted by the server, so closing this view cannot undo them.
    setBusy(true);
    setError('');
    try {
      setBatch(
        await postPos<AiBatch>(`/catalog-workspace/ai-batches/${id}/${action}`, branch, {
          confirm_retry: confirmRetry,
        }),
      );
      setConfirmRetry(false);
      window.dispatchEvent(new Event('kline-ai-batches-changed'));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const needsRetry = batch?.items.some((item) => item.state === 'attention');
  return (
    <Modal
      title="AI fill"
      description={
        id
          ? 'Saved background progress'
          : `${items.length} photographed lots · Existing details stay unchanged`
      }
      wide
      onClose={onClose}
    >
      {!id ? (
        <>
          <p>
            After the server accepts this batch, AI fill continues while your screen is locked, the app is
            closed, or you sign out. You can return to Background AI fill in Receiving.
          </p>
          {submissionPending && (
            <p role="status">
              Acceptance is not yet confirmed. Check acceptance again or reopen Background AI fill before
              starting another batch.
            </p>
          )}
          <div className="ai-fill-list">
            {items.map((item) => (
              <div className="ai-fill-row" key={item.id}>
                <Photo url={item.image_url} name={item.name || 'Photographed lot'} />
                <strong>{item.name || 'Unnamed lot'}</strong>
              </div>
            ))}
          </div>
        </>
      ) : !batch ? (
        <p role="status">Loading saved progress…</p>
      ) : (
        <>
          <p role="status">
            {batch.status === 'active'
              ? 'Running in the background'
              : batch.status === 'done'
                ? 'Finished'
                : batch.status === 'paused'
                  ? 'Needs attention'
                  : 'Stopped'}{' '}
            · {batch.items.filter((item) => ['done', 'skipped'].includes(item.state)).length} of{' '}
            {batch.items.length} finished
          </p>
          <p>{batch.message || 'You can safely close this window. Accepted work continues on the server.'}</p>
          {onPrice && batch.items.some((item) => item.state === 'done') && (
            <Button
              onClick={() =>
                onPrice(batch.items.filter((item) => item.state === 'done').map((item) => item.item_id))
              }
            >
              Price completed items
            </Button>
          )}
          <div className="ai-fill-list">
            {batch.items.map((item) => (
              <div className="ai-fill-row" key={item.id}>
                <div>
                  <strong>{item.name || 'Unnamed lot'}</strong>
                  <p>{item.message}</p>
                </div>
                <Button variant="outline" onClick={() => onReview(item.item_id)}>
                  Review details
                </Button>
              </div>
            ))}
          </div>
          {needsRetry && (
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={confirmRetry}
                onChange={(event) => setConfirmRetry(event.target.checked)}
              />
              I reviewed saved details and approve retrying unresolved photos. A retry may incur another AI
              charge.
            </label>
          )}
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button variant="outline" onClick={onClose}>
          Done
        </Button>
        {!id && (
          <Button disabled={busy || !items.length} onClick={submitBatch}>
            {busy
              ? 'Submitting…'
              : submissionPending
                ? 'Check batch acceptance'
                : `Fill ${items.length} photos in background`}
          </Button>
        )}
        {batch?.status === 'active' && (
          <Button disabled={busy} variant="outline" onClick={() => changeBatch('stop')}>
            Stop after current photo
          </Button>
        )}
        {batch && ['paused', 'stopped'].includes(batch.status) && (
          <Button disabled={busy || (!!needsRetry && !confirmRetry)} onClick={() => changeBatch('resume')}>
            {needsRetry ? 'Retry unresolved and resume' : 'Resume batch'}
          </Button>
        )}
      </div>
    </Modal>
  );
}

/** Keep accepted batches discoverable after refresh, sign-in, or a change of device. */
export function AiBatchProgress({
  branch,
  onReview,
  onPrice,
  onExtracted,
}: {
  branch: string;
  onReview: (id: string) => void;
  onPrice?: (ids: string[]) => void;
  onExtracted: () => void;
}) {
  const [batches, setBatches] = useState<AiBatchSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const callback = useRef(onExtracted),
    previousProgress = useRef<string | null>(null);
  callback.current = onExtracted;
  useEffect(() => {
    // The list is authoritative; it does not rely on local storage or the original selection.
    let cancelled = false,
      fetching = false;
    previousProgress.current = null;
    async function refreshBatches() {
      if (cancelled || fetching || document.visibilityState === 'hidden') return;
      fetching = true;
      try {
        const saved = await requestPos<{ batches: AiBatchSummary[] }>(
          '/catalog-workspace/ai-batches',
          branch,
        );
        if (cancelled) return;
        setBatches(saved.batches);
        setError('');
        const progress = JSON.stringify(saved.batches.map((batch) => [batch.id, batch.completed]));
        if (previousProgress.current !== null && previousProgress.current !== progress) callback.current();
        previousProgress.current = progress;
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message);
      } finally {
        fetching = false;
      }
    }
    void refreshBatches();
    const timer = window.setInterval(() => void refreshBatches(), 5000);
    window.addEventListener('kline-ai-batches-changed', refreshBatches);
    window.addEventListener('focus', refreshBatches);
    window.addEventListener('online', refreshBatches);
    document.addEventListener('visibilitychange', refreshBatches);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('kline-ai-batches-changed', refreshBatches);
      window.removeEventListener('focus', refreshBatches);
      window.removeEventListener('online', refreshBatches);
      document.removeEventListener('visibilitychange', refreshBatches);
    };
  }, [branch]);
  return (
    <section aria-label="Background AI fill" className="receiving-review-group">
      <details>
        <summary>
          <strong>
            Background AI fill ({batches.filter((batch) => batch.status !== 'done').length} unfinished)
          </strong>
        </summary>
        {error && (
          <p className="error" role="alert">
            Progress unavailable: {error}. Accepted work may still be running.
          </p>
        )}
        {!batches.length && !error && (
          <p>No background batches yet. Select photographed lots and choose AI fill.</p>
        )}
        {batches.map((batch) => (
          <div key={batch.id} className="receipt-outcome">
            <span>
              {new Date(batch.created_at).toLocaleString()} · {batch.completed}/{batch.total} finished ·{' '}
              {batch.status}
            </span>
            <Button variant="outline" onClick={() => setSelected(batch.id)}>
              View progress
            </Button>
          </div>
        ))}
      </details>
      {selected && (
        <AiFill
          batchId={selected}
          branch={branch}
          onClose={() => setSelected(null)}
          onReview={(id) => {
            setSelected(null);
            onReview(id);
          }}
          onPrice={
            onPrice
              ? (ids) => {
                  setSelected(null);
                  onPrice(ids);
                }
              : undefined
          }
          onExtracted={onExtracted}
        />
      )}
    </section>
  );
}
