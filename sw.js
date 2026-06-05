const CACHE='adiatool-v3';
const ASSETS=['./', './index.html','./style.css','./app.js','./forms-data.js','./logo.js','./manifest.json'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>Promise.allSettled(ASSETS.map(u=>c.add(u)))).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  if(/generativelanguage|googleapis|jsdelivr|fonts\.g/.test(e.request.url)){e.respondWith(fetch(e.request).catch(()=>new Response('',{status:503})));return;}
  e.respondWith(caches.match(e.request).then(c=>{if(c)return c;return fetch(e.request).then(r=>{if(r.ok&&e.request.method==='GET')caches.open(CACHE).then(x=>x.put(e.request,r.clone()));return r;}).catch(()=>e.request.mode==='navigate'?caches.match('./index.html'):undefined);}));
});
