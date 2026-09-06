'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, postPos, requestPos } from '@/lib/catalog-api';
import { Modal } from './workspace-ui';

/** Review a fixed server revision before cancelling; queued IDs may not have reached the server yet. */
export function IntakeCancellation({
  itemId,
  branch,
  name,
  restore = false,
  onClose,
  onDone,
}: {
  itemId: string;
  branch: string;
  name: string;
  restore?: boolean;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [review, setReview] = useState<{ publication_revision?: string } | null>(null);
  const [reason, setReason] = useState(restore ? 'Return to preparation' : 'Accidental upload');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    requestPos<{ publication_revision: string }>(`/catalog-workspace/items/${itemId}`, branch, {
      signal: controller.signal,
    })
      .then(setReview)
      .catch((cause) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 404 && !restore) setReview({});
        else setError(cause.message);
      });
    return () => controller.abort();
  }, [itemId, branch, restore]);
  async function confirmCancellation() {
    // Keep the local upload until its durable server cancellation has been acknowledged.
    if (!review) return;
    setBusy(true);
    setError('');
    try {
      await postPos(`/catalog-workspace/intake/${itemId}/cancellation`, branch, {
        action: restore ? 'restore' : 'cancel',
        reason: reason.trim(),
        expected_revision: review.publication_revision,
      });
      await onDone();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={restore ? 'Restore intake' : 'Cancel intake'}
      description={name}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>
        {restore
          ? 'Return this lot to Receiving with its saved details and counts.'
          : 'Remove this lot from preparation. Its photo and history remain available under Cancelled intake.'}
      </p>
      <label>
        Reason
        <Input
          value={reason}
          maxLength={300}
          disabled={busy}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      {!review && !error && <p role="status">Checking intake…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <Button disabled={busy || !review || !reason.trim()} onClick={confirmCancellation}>
        {busy ? 'Saving…' : restore ? 'Restore intake' : 'Cancel intake'}
      </Button>
    </Modal>
  );
}
