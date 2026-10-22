// K2K : l'appli s'ouvre même hors connexion ; les données de marché passent toujours par le réseau.
const CACHE = 'k2k-v6';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'smc.js', 'cot.js', 'data.js', 'manifest.webmanifest', 'icons/favicon-32.png', 'icons/icon-192.png', 'vendor/lightweight-charts.standalone.production.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (/binance|cftc\.gov/.test(url.hostname)) return; // données en direct : jamais de cache
  // Réseau d'abord, cache en secours : la dernière version est toujours servie quand on est en ligne.
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
