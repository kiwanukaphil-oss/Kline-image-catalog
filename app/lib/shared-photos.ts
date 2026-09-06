/** Read or consume one unpredictable local share intent; never automatically assign it to an account or branch. */
export async function sharedPhotos(id: string, consume = false): Promise<File[]> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return [];
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('kline-shares', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('shares', { keyPath: 'id' });
    open.onerror = () => reject(new Error('Shared photos are unavailable.'));
    open.onsuccess = () => {
      const db = open.result,
        tx = db.transaction('shares', consume ? 'readwrite' : 'readonly'),
        store = tx.objectStore('shares'),
        request = store.get(id);
      let files: File[] = [];
      request.onsuccess = () => {
        files = request.result?.files || [];
        if (consume) store.delete(id);
      };
      tx.oncomplete = () => {
        db.close();
        resolve(files);
      };
      tx.onabort = () => {
        db.close();
        reject(new Error('Shared photos could not be opened.'));
      };
    };
  });
}
