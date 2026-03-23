/* ============================================================
   service-worker.js — DropBeam PWA
   Cache-first for app shell, network-first for everything else.
============================================================ */

const CACHE = "dropbeam-v3";

const SHELL = [
  "./",
  "./dropbeam.html",
  "./room2.html",
  "./css/dropbeam.css",
  "./js/mind.js",
  "./js/room.js",
  "./js/webrtc.js",
  "./js/firebase2.js",
  "./js/encryption.js",
  "./js/chunkManager.js",
  "./js/storage.js",
  "./manifest.json",
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (
    e.request.method !== "GET" ||
    e.request.url.includes("firestore") ||
    e.request.url.includes("firebase") ||
    e.request.url.includes("googleapis.com/identitytoolkit")
  ) return;

  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r.ok) {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return r;
      })
      .catch(() => caches.match(e.request).then(cached => {
        if (cached) return cached;
        if (e.request.mode === "navigate") return caches.match("./dropbeam.html");
      }))
  );
});
