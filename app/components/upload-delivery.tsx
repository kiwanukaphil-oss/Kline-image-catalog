'use client';
import { useEffect, useRef, useState } from 'react';
import { Upload, Check } from 'lucide-react';
import { PhotoIntake } from './photo-intake';
import { IntakeCancellation } from './intake-cancellation';
import { useWorkspaceProtection } from '@/lib/workspace-protection';
import { sharedPhotos } from '@/lib/shared-photos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from './workspace-ui';
import { postPos, requestPos } from '@/lib/catalog-api';
import { queuePhotos, readPendingPhotos, finishPhoto, type PendingPhoto } from '@/lib/upload-queue';
export type Category = { id: string; name: string; parent_id: string | null };

/** Queue bytes before upload and keep failed items under their original account, branch and intake ID. */
export function UploadDelivery({
  branch,
  userId,
  canCancel,
  categories,
  onClose,
  onComplete,
}: {
  branch: string;
  userId: string;
  canCancel: boolean;
  categories: Category[];
  onClose: () => void;
  onComplete: (batchId: string, title: string) => void;
}) {
  const [title, setTitle] = useState(
      `Delivery · ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}`,
    ),
    [category, setCategory] = useState(categories[0]?.id || '');
  const [files, setFiles] = useState<File[]>([]),
    [pending, setPending] = useState<PendingPhoto[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState('');
  const lifetime = useRef<AbortController | null>(null),
    batchId = useRef(crypto.randomUUID());
  const [preparing, setPreparing] = useState(false);
  const [intakeVersion, setIntakeVersion] = useState(0);
  const [cancelling, setCancelling] = useState<PendingPhoto | null>(null);
  useWorkspaceProtection(!!files.length, busy || preparing);
  useEffect(() => {
    lifetime.current = new AbortController();
    readPendingPhotos(userId, branch)
      .then(setPending)
      .catch((cause) => setError(cause.message));
    return () => lifetime.current?.abort();
  }, [userId, branch]);
  // The former file-only picker is superseded by PhotoIntake's reviewed capture and preparation workflow.
  /** A failed batch-link is retried using the already created intake item, never a replacement item. */
  async function uploadQueued(photos: PendingPhoto[]) {
    const token = sessionStorage.getItem('kline.session');
    let completed = 0,
      lastBatch = '',
      lastTitle = '';
    for (const photo of photos) {
      if (lifetime.current?.signal.aborted || sessionStorage.getItem('kline.session') !== token) return;
      setProgress(`${completed + 1} of ${photos.length} · ${photo.file.name}`);
      const form = new FormData();
      form.set('id', photo.id);
      form.set('category_id', photo.categoryId);
      form.set('status', 'draft');
      form.set('image', photo.file);
      await requestPos('/catalog/items', branch, {
        method: 'POST',
        body: form,
        signal: lifetime.current?.signal,
      });
      await requestPos(`/catalog-workspace/batches/${photo.batchId}/items/${photo.id}`, branch, {
        method: 'PUT',
        signal: lifetime.current?.signal,
      });
      await finishPhoto(photo.id);
      completed++;
      lastBatch = photo.batchId;
      lastTitle = photo.batchTitle;
    }
    setPending(await readPendingPhotos(userId, branch));
    setProgress(`${completed} photos added`);
    setFiles([]);
    if (lastBatch) onComplete(lastBatch, lastTitle);
  }
  async function startDelivery() {
    /* Create the delivery once and persist the whole photo selection before starting network writes. */

    setBusy(true);
    setError('');
    try {
      if (!title.trim() || !category || !files.length)
        throw new Error('Name the delivery, choose a category and add photos.');
      await postPos('/catalog-workspace/batches', branch, { id: batchId.current, title: title.trim() });
      const queued: PendingPhoto[] = [];
      for (const file of files) {
        const photo = {
          id: crypto.randomUUID(),
          userId,
          branchId: branch,
          batchId: batchId.current,
          batchTitle: title,
          categoryId: category,
          file,
          createdAt: Date.now(),
        };
        queued.push(photo);
      }
      await queuePhotos(queued);
      setFiles([]);
      const shareId = new URLSearchParams(location.search).get('share');
      if (shareId) {
        const url = new URL(location.href);
        url.searchParams.delete('share');
        history.replaceState(null, '', url);
        await sharedPhotos(shareId, true).catch(() =>
          console.warn('Shared source remains locally; its upload queue is already saved.'),
        );
      }
      setIntakeVersion((version) => version + 1);
      setPending(await readPendingPhotos(userId, branch));
      await uploadQueued(queued);
    } catch (cause) {
      setError((cause as Error).message);
      setPending(await readPendingPhotos(userId, branch));
    } finally {
      setBusy(false);
    }
  }
  async function resumeUploads() {
    /* Resume the stored stable IDs, retaining every failed entry for another attempt. */

    setBusy(true);
    setError('');
    try {
      await uploadQueued(pending);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
      setPending(await readPendingPhotos(userId, branch));
    }
  }
  return (
    <Modal
      title="New delivery"
      description="Each photo creates one lot. Count its sizes after upload."
      onClose={() => {
        if (!busy && !preparing) onClose();
      }}
    >
      <label>
        Delivery name
        <Input disabled={busy} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Category
        <select
          aria-label="Delivery category"
          disabled={busy}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {categories.map((entry) => (
            <option value={entry.id} key={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
      <PhotoIntake key={intakeVersion} onChange={setFiles} disabled={busy} onWorkingChange={setPreparing} />
      {pending.length > 0 && (
        <div className="pending-uploads">
          <strong>{pending.length} saved photos waiting</strong>
          <small>{[...new Set(pending.map((photo) => photo.batchTitle))].join(', ')}</small>
          {pending.map((photo) => (
            <div key={photo.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{photo.file.name}</span>
              {canCancel && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setCancelling(photo)}
                  aria-label={`Cancel ${photo.file.name}`}
                >
                  Cancel
                </Button>
              )}
            </div>
          ))}
          <Button variant="outline" disabled={busy} onClick={resumeUploads}>
            Resume uploads
          </Button>
        </div>
      )}
      {cancelling && (
        <IntakeCancellation
          itemId={cancelling.id}
          branch={branch}
          name={cancelling.file.name}
          onClose={() => setCancelling(null)}
          onDone={async () => {
            await finishPhoto(cancelling.id);
            setPending(await readPendingPhotos(userId, branch));
            setCancelling(null);
          }}
        />
      )}
      {progress && <p role="status">{progress}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <Button className="h-11" disabled={busy || preparing || !files.length} onClick={startDelivery}>
        {busy ? <Check size={16} /> : <Upload size={16} />} {busy ? 'Adding photos…' : 'Add to Receiving'}
      </Button>
    </Modal>
  );
}
