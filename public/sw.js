const CACHE_NAME = 'bufferwave-v1';
let currentMode = 'standby';

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SET_MODE') {
    currentMode = event.data.mode;
  }
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  if (url.includes('/api/') || url.includes('supabase.co')) return;
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  if (currentMode === 'discharging') {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Non disponible hors ligne' }), {
      status: 503, headers: { 'Content-Type': 'application/json' }
    });
  }
  if (currentMode === 'charging') {
    try {
      const response = await fetch(request.clone());
      if (response && response.status === 200) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
      return response;
    } catch {
      return caches.match(request);
    }
  }
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    if (response && response.status === 200) cache.put(request, response.clone());
    return response;
  } catch {
    return caches.match(request);
  }
}
