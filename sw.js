const C='trekker-v3',CFG='trekker-cfg';
const FILES=['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png','icon-maskable-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C&&x!==CFG).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
async function dynManifest(req){
  let m;
  try{m=await (await fetch(req)).json()}catch(e){const r=await caches.match('manifest.webmanifest');m=r?await r.json():{}}
  try{const cc=await caches.open(CFG),r=await cc.match('cfg');
    if(r){const j=await r.json();
      if(j.name){m.name=j.name;m.short_name=j.name.length>14?j.name.slice(0,14):j.name}
      if(j.icon){const v='?v='+j.v;m.icons=[{src:'hicon-192.png'+v,sizes:'192x192',type:'image/png',purpose:'any'},{src:'hicon-512.png'+v,sizes:'512x512',type:'image/png',purpose:'any'},{src:'hicon-512.png'+v,sizes:'512x512',type:'image/png',purpose:'maskable'}]}}
  }catch(e){}
  return new Response(JSON.stringify(m),{headers:{'Content-Type':'application/manifest+json'}});
}
async function dynIcon(p){
  try{const cc=await caches.open(CFG),r=await cc.match(p);if(r)return r}catch(e){}
  return caches.match(p==='hicon-192.png'?'icon-192.png':'icon-512.png');
}
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
  const f=u.pathname.split('/').pop();
  if(f==='manifest.webmanifest'){e.respondWith(dynManifest(e.request));return}
  if(f==='hicon-192.png'||f==='hicon-512.png'){e.respondWith(dynIcon(f));return}
  e.respondWith(fetch(e.request).then(res=>{const cp=res.clone();caches.open(C).then(c=>c.put(e.request,cp));return res}).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match('index.html'))))});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window'}).then(l=>l.length?l[0].focus():clients.openWindow('./')))});
