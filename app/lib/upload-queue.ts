export type PendingPhoto = {
  id: string;
  userId: string;
  branchId: string;
  batchId: string;
  batchTitle: string;
  categoryId: string;
  file: File;
  createdAt: number;
};

/** Persist the original bytes and stable intake ID before attempting a network upload. */
async function openUploadDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('kline-receiving', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pending-photos', { keyPath: 'id' });
    request.onerror = () => reject(new Error('This browser could not save the upload queue.'));
    request.onsuccess = () => resolve(request.result);
  });
}
/** Resolve after the transaction commits, not merely after the individual request succeeds. */
async function uploadTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openUploadDatabase();
  return new Promise((resolve, reject) => {
    /* Resolve only after IndexedDB commits so successful queue writes survive page reloads. */

    const transaction = db.transaction('pending-photos', mode);
    const request = operation(transaction.objectStore('pending-photos'));
    transaction.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error('Upload queue could not be saved.'));
    };
    transaction.onabort = () => {
      db.close();
      reject(new Error('Upload queue save was interrupted.'));
    };
  });
}
export const queuePhoto = (photo: PendingPhoto) =>
  uploadTransaction('readwrite', (store) => store.put(photo));
/** Persist the chosen group atomically so a quota failure cannot leave a partially duplicated selection. */
export async function queuePhotos(photos: PendingPhoto[]): Promise<void> {
  const db = await openUploadDatabase();
  return new Promise((resolve, reject) => {
    /* Commit the entire photo group atomically or retain none of a failed selection. */

    const transaction = db.transaction('pending-photos', 'readwrite');
    for (const photo of photos) transaction.objectStore('pending-photos').put(photo);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onabort = () => {
      db.close();
      reject(new Error('There is not enough browser storage for these photos. Choose fewer photos.'));
    };
    transaction.onerror = () => {
      db.close();
      reject(new Error('These photos could not be saved for upload.'));
    };
  });
}
export const finishPhoto = (id: string) => uploadTransaction('readwrite', (store) => store.delete(id));
export const readPendingPhotos = async (userId: string, branchId: string) =>
  (await uploadTransaction<PendingPhoto[]>('readonly', (store) => store.getAll()))
    .filter((photo) => photo.userId === userId && photo.branchId === branchId)
    .sort((a, b) => a.createdAt - b.createdAt);
