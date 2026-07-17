// VibeFoundry Service Worker — minimal, just enables PWA install
// No aggressive caching — this is a local dev tool, not an offline app

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim())
})

self.addEventListener('fetch', (event) => {
  // Pass everything through to the network — no caching
  // The app runs locally so offline support isn't needed
  event.respondWith(fetch(event.request))
})
