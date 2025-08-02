// Service Worker for offline caching
const CACHE_NAME = 'voice-assistant-v1';
const STATIC_CACHE = 'static-v1';
const DYNAMIC_CACHE = 'dynamic-v1';

// Files to cache on install
const STATIC_FILES = [
  '/',
  '/workers/whisper-worker.js',
  '/workers/tts-worker.js',
  '/models/whisper-base.wasm',
  '/models/tts-model.onnx',
  '/manifest.json'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE).then((cache) => {
        console.log('Caching static files...');
        return cache.addAll(STATIC_FILES);
      }),
      // Skip waiting to activate immediately
      self.skipWaiting()
    ])
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE) {
              console.log('Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // Take control of all clients
      self.clients.claim()
    ])
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle API requests differently
  if (url.pathname.startsWith('/api/')) {
    // API requests - network first, no cache for dynamic content
    event.respondWith(
      fetch(request).catch(() => {
        // Return offline message for API failures
        return new Response(
          JSON.stringify({ error: 'Offline - API unavailable' }),
          {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'application/json' }
          }
        );
      })
    );
    return;
  }

  // Handle static assets and pages
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        console.log('Serving from cache:', request.url);
        return cachedResponse;
      }

      // Not in cache, fetch from network
      return fetch(request).then((networkResponse) => {
        // Don't cache non-successful responses
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        // Clone the response before caching
        const responseToCache = networkResponse.clone();

        // Decide which cache to use
        const cacheName = STATIC_FILES.includes(url.pathname) ? STATIC_CACHE : DYNAMIC_CACHE;

        caches.open(cacheName).then((cache) => {
          console.log('Caching new resource:', request.url);
          cache.put(request, responseToCache);
        });

        return networkResponse;
      }).catch(() => {
        // Network failed, return offline page for navigation requests
        if (request.mode === 'navigate') {
          return caches.match('/');
        }
        // For other requests, return a generic offline response
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});

// Background sync for when connection is restored
self.addEventListener('sync', (event) => {
  console.log('Background sync triggered:', event.tag);
  
  if (event.tag === 'background-sync') {
    event.waitUntil(
      // Perform any pending operations when back online
      doBackgroundSync()
    );
  }
});

async function doBackgroundSync() {
  try {
    // Implement any background tasks needed when coming back online
    console.log('Performing background sync...');
    
    // Could include:
    // - Syncing cached user data
    // - Updating models if newer versions available
    // - Processing queued requests
    
  } catch (error) {
    console.error('Background sync failed:', error);
  }
}

// Handle messages from the main thread
self.addEventListener('message', (event) => {
  const { type, data } = event.data;

  switch (type) {
    case 'skipWaiting':
      self.skipWaiting();
      break;
    
    case 'getCacheStatus':
      getCacheStatus().then((status) => {
        event.ports[0].postMessage({ type: 'cacheStatus', data: status });
      });
      break;
    
    default:
      console.log('Unknown message type:', type);
  }
});

async function getCacheStatus() {
  const caches_data = await caches.keys();
  const status = {
    caches: caches_data,
    staticCacheSize: await getCacheSize(STATIC_CACHE),
    dynamicCacheSize: await getCacheSize(DYNAMIC_CACHE)
  };
  return status;
}

async function getCacheSize(cacheName) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    return keys.length;
  } catch (error) {
    return 0;
  }
}