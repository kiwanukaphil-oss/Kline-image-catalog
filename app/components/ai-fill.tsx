'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError, postPos, requestPos, type CatalogItem } from '@/lib/catalog-api';
import { Modal, Photo } from './workspace-ui';

type Outcome = { state: 'ready' | 'running' | 'done' | 'failed' | 'unknown'; message: string };

/** Fill selected lots sequentially; reconcile saved runs before offering any paid retry. */
export function AiFill({
  items,
  branch,
  onClose,
  onReview,
}: {
  items: CatalogItem[];
  branch: string;
  onClose: () => void;
  onReview: (id: string) => void;
}) {
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const active = useRef(true),
    stopped = useRef(false);
  useEffect(() => {
    // Recover status from POS jobs after reopening, rather than resending completed requests.
    let cancelled = false;
    active.current = true;
    setLoading(true);
    setError('');
    Promise.all(
      items.map(async (item) => {
        const { item: saved } = await requestPos<{ item: CatalogItem }>(
          `/catalog-workspace/items/${item.id}`,
          branch,
        );
        const state: Outcome['state'] =
          saved.is_published || saved.ai_run?.status === 'succeeded'
            ? 'done'
            : saved.ai_run?.status === 'running'
              ? 'running'
              : saved.ai_run?.status === 'failed'
                ? 'failed'
                : 'ready';
        return [
          item.id,
          {
            state,
            message:
              state === 'done'
                ? 'Ready to review'
                : state === 'running'
                  ? 'Analysis still running'
                  : state === 'failed'
                    ? 'Previous attempt failed'
                    : 'Ready',
          },
        ] as const;
      }),
    )
      .then((rows) => {
        if (!cancelled) setOutcomes(Object.fromEntries(rows));
      })
      .catch((cause) => {
        if (!cancelled) setError(cause.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      active.current = false;
      stopped.current = true;
    };
  }, [items, branch, revision]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (busy) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  async function fillSelected() {
    // Never retry successes; stopping lets the current server request finish before ending the queue.
    setBusy(true);
    setError('');
    stopped.current = false;
    const token = sessionStorage.getItem('kline.session');
    const next = { ...outcomes };
    for (const item of items) {
      if (stopped.current || !active.current || sessionStorage.getItem('kline.session') !== token) break;
      if (!['ready', 'failed'].includes(next[item.id]?.state)) continue;
      next[item.id] = { state: 'running', message: 'Reading photo…' };
      setOutcomes({ ...next });
      try {
        const result = await postPos<{ data: { applied_fields: string[] } }>(
          `/catalog/items/${item.id}/ai-extract`,
          branch,
          { only_empty: true },
        );
        next[item.id] = {
          state: 'done',
          message: result.data.applied_fields.length
            ? `${result.data.applied_fields.length} details filled · Review`
            : 'No new details · Review',
        };
      } catch (cause) {
        // A lost response may have completed in POS. Require a status read before another request.
        next[item.id] = { state: 'unknown', message: (cause as Error).message };
        stopped.current = true;
        if (cause instanceof ApiError && cause.status === 429)
          setError('AI limit reached. Completed results are saved.');
      }
      if (active.current) setOutcomes({ ...next });
    }
    if (active.current) {
      setBusy(false);
      setError((previous) => (previous === 'Stopping after the current photo.' ? '' : previous));
    }
  }
  const remaining = items.filter((item) => ['ready', 'failed'].includes(outcomes[item.id]?.state)).length;
  const unresolved = Object.values(outcomes).some((outcome) =>
    ['unknown', 'running'].includes(outcome.state),
  );
  return (
    <Modal
      title="AI fill"
      description={`${items.length} photographed lots · Existing details stay unchanged`}
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {loading ? (
        <p role="status">Checking saved progress…</p>
      ) : (
        <div className="ai-fill-list">
          {items.map((item) => (
            <div className="ai-fill-row" key={item.id}>
              <Photo url={item.image_url} name={item.name || 'Photographed lot'} />
              <div>
                <strong>{item.name || 'Unnamed lot'}</strong>
                <p role="status">{outcomes[item.id]?.message}</p>
              </div>
              <Button variant="outline" disabled={busy} onClick={() => onReview(item.id)}>
                Review details
              </Button>
            </div>
          ))}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button variant="outline" disabled={busy} onClick={onClose}>
          Done
        </Button>
        {busy ? (
          <Button
            variant="outline"
            onClick={() => {
              stopped.current = true;
              setError('Stopping after the current photo.');
            }}
          >
            Stop after this photo
          </Button>
        ) : unresolved ? (
          <Button disabled={loading} onClick={() => setRevision((value) => value + 1)}>
            Check saved progress
          </Button>
        ) : (
          remaining > 0 && (
            <Button disabled={loading || !!error} onClick={fillSelected}>
              Fill {remaining} {remaining === 1 ? 'photo' : 'photos'}
            </Button>
          )
        )}
      </div>
    </Modal>
  );
}
