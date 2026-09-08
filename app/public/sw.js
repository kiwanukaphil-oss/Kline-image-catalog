/* Versioned offline notice only: no stock, identity, signed photos, HTML workspace or API responses are cached. */
const OFFLINE_CACHE='kline-offline-v1';
self.addEventListener('install',event=>event.waitUntil(caches.open(OFFLINE_CACHE).then(cache=>cache.add('/offline.html'))));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
// Accept the old Workbox restart button as well as the current app's update action during domain cutover.
self.addEventListener('message',event=>{if(['ACTIVATE_UPDATE','SKIP_WAITING'].includes(event.data?.type))self.skipWaiting();});
/** Save explicitly shared images locally; authenticated receiving must review them before any upload. */
async function receiveSharedPhotos(request){
  const form=await request.formData(),files=form.getAll('photos');
  if(!files.length||files.length>100||files.some(file=>!(file instanceof File)||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>30*1024*1024)||files.reduce((sum,file)=>sum+file.size,0)>100*1024*1024)
    return new Response('Choose up to 100 JPEG, PNG or WebP photos, up to 30 MB each and 100 MB total.',{status:400});
  const id=crypto.randomUUID();
  await new Promise((resolve,reject)=>{
    const open=indexedDB.open('kline-shares',1);open.onupgradeneeded=()=>open.result.createObjectStore('shares',{keyPath:'id'});open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{const db=open.result,tx=db.transaction('shares','readwrite');tx.objectStore('shares').put({id,files,createdAt:Date.now()});tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};
  });
  return Response.redirect(new URL('/?share='+id,self.location.origin),303);
}
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  if(url.pathname==='/share-intake'&&event.request.method==='POST'){
    event.respondWith(receiveSharedPhotos(event.request).catch(()=>new Response('Photos could not be saved on this device. Reopen K-Line and choose them again.',{status:507})));return;
  }
  if(event.request.mode==='navigate'&&event.request.method==='GET')
    event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));
});
