'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, Upload, Check } from 'lucide-react';
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
  categories,
  onClose,
  onComplete,
}: {
  branch: string;
  userId: string;
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
  useEffect(() => {
    lifetime.current = new AbortController();
    readPendingPhotos(userId, branch)
      .then(setPending)
      .catch((cause) => setError(cause.message));
    return () => lifetime.current?.abort();
  }, [userId, branch]);
  function choosePhotos(list: FileList | null) {
    /* Reject unsupported or oversized photos before attempting browser persistence or upload. */

    const chosen = Array.from(list || []);
    if (
      chosen.some(
        (file) =>
          !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024,
      )
    ) {
      setError('Choose JPEG, PNG or WebP photos up to 5 MB each.');
      return;
    }
    if (chosen.length > 100) {
      setError('Choose up to 100 photos at a time.');
      return;
    }
    setError('');
    setFiles(chosen);
  }
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
        if (!busy) onClose();
      }}
    >
      <label>
        Delivery name
        <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Category
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((entry) => (
            <option value={entry.id} key={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
      <label className="upload-drop">
        <Camera size={28} />
        <strong>{files.length ? `${files.length} photos selected` : 'Choose photos'}</strong>
        <span>JPEG, PNG or WebP · up to 5 MB each</span>
        <input
          aria-label="Delivery photos"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => choosePhotos(e.target.files)}
        />
      </label>
      {pending.length > 0 && (
        <div className="pending-uploads">
          <strong>{pending.length} saved photos waiting</strong>
          <small>{[...new Set(pending.map((photo) => photo.batchTitle))].join(', ')}</small>
          <Button variant="outline" disabled={busy} onClick={resumeUploads}>
            Resume uploads
          </Button>
        </div>
      )}
      {progress && <p role="status">{progress}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <Button className="h-11" disabled={busy || !files.length} onClick={startDelivery}>
        {busy ? <Check size={16} /> : <Upload size={16} />} {busy ? 'Adding photos…' : 'Add to Receiving'}
      </Button>
    </Modal>
  );
}
