const VERSION='laterne-1.0.0';
const SHELL=['./','index.html','styles.css?v=1.0.0','app.js?v=1.0.0','cities/guetersloh.js?v=1.0.0','vendor/leaflet.js','vendor/leaflet.css','manifest.webmanifest','img/luna-hero.webp','img/luna-portrait.webp','icons/icon-192.png','icons/icon-512.png'];
const TILES='laterne-tiles';
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n!==VERSION&&n!==TILES).map(n=>caches.delete(n)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET')return;
 if(u.origin===location.origin){ // Netzwerk zuerst für HTML, Cache zuerst für Assets
  if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(VERSION).then(x=>x.put('index.html',c));return r}).catch(()=>caches.match('index.html')));return}
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{if(res.ok&&u.pathname.includes('/data/')){const c=res.clone();caches.open(VERSION).then(x=>x.put(e.request,c))}return res})));return}
 if(u.hostname==='tile.openstreetmap.org'){e.respondWith(caches.open(TILES).then(c=>c.match(e.request).then(hit=>{const net=fetch(e.request).then(r=>{if(r.ok)c.put(e.request,r.clone());return r}).catch(()=>hit);return hit||net})));}
});
