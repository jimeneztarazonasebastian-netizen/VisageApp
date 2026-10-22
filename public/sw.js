/*
 * Visage service worker: makes the app work offline. Editing runs in the browser, so caching the
 * program (pages, scripts, the vision engine and its models) is enough. Photos are never cached.
 */
const STATIC = "visage-static-v1";
const PAGES = "visage-pages-v1";
const CORE = ["/", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((c) => c.addAll(CORE))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![STATIC, PAGES].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Only the big files that never change under the same name come from the cache first. The app's own
// code goes to the network first: some chunk names (e.g. the engine worker's) survive a rebuild with
// new contents, and serving them from the cache would run an old engine.
const isStatic = (url) => url.origin === self.location.origin && (/^\/(vendor|models|icons)\//.test(url.pathname) || /\.(woff2?|png|svg|ico)$/.test(url.pathname));

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(STATIC)).put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(PAGES)).put(request, response.clone());
    return response;
  } catch {
    const cached = (await caches.match(request)) ?? (request.mode === "navigate" ? await caches.match("/") : undefined);
    if (cached) return cached;
    throw new Error("offline");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isStatic(url)) event.respondWith(cacheFirst(request));
  else if (request.mode === "navigate" || url.pathname.startsWith("/_next/static/") || url.pathname === "/manifest.webmanifest") event.respondWith(networkFirst(request));
});
