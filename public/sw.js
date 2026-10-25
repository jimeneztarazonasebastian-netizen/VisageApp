/*
 * Visage service worker: makes the app work offline. Editing runs in the browser, so caching the
 * program (pages, scripts, the vision engine and its models) is enough. Photos are never cached.
 */
const STATIC = "visage-static-v2";
const PAGES = "visage-pages-v2";
const CORE = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/logo.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // The page shell, plus the vision engine and the face model (listed by the build), so the
      // first offline launch can already open a photo and find the face.
      await caches.open(PAGES).then((c) => c.addAll(CORE)).catch(() => {});
      try {
        const list = await fetch("/vendor/precache.json", { cache: "no-store" }).then((r) => r.json());
        const cache = await caches.open(STATIC);
        await Promise.all(list.files.map((f) => cache.match(f).then((hit) => hit || cache.add(f)).catch(() => {})));
      } catch {}
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => ![STATIC, PAGES].includes(k)).map((k) => caches.delete(k)));
      // Pages from older deploys reference chunks that no longer exist: keep only the shell.
      const pages = await caches.open(PAGES);
      for (const req of await pages.keys()) if (!CORE.includes(new URL(req.url).pathname)) await pages.delete(req);
      await self.clients.claim();
    })(),
  );
});

// Big files that never change under the same name come from the cache first (the vision engine
// lives in a versioned folder). The app's own code goes to the network first.
const isStatic = (url) =>
  url.origin === self.location.origin && (/^\/(vendor\/mediapipe|models|icons)\//.test(url.pathname) || /^\/_next\/static\/immutable\//.test(url.pathname) || /\.(woff2?|png|svg|ico)$/.test(url.pathname));

async function cacheFirst(event, request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    event.waitUntil(caches.open(STATIC).then((c) => c.put(request, copy)));
  }
  return response;
}

/**
 * Network first, but with a short wait on a weak signal before falling back to the copy, and the
 * copy also wins over an error response (e.g. a chunk removed by a newer deploy).
 */
async function networkFirst(event, request, waitMs) {
  const cached = caches.match(request).then((c) => c ?? (request.mode === "navigate" ? caches.match("/") : undefined));
  const network = fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(PAGES).then((c) => c.put(request, copy)));
    }
    return response;
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve("timeout"), waitMs));
  try {
    const first = await Promise.race([network, timeout]);
    if (first !== "timeout" && first.ok) return first;
    const copy = await cached;
    if (copy) return copy;
    return first === "timeout" ? await network : first;
  } catch {
    const copy = await cached;
    if (copy) return copy;
    throw new Error("offline");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isStatic(url)) event.respondWith(cacheFirst(event, request));
  else if (request.mode === "navigate") event.respondWith(networkFirst(event, request, 3500));
  else if (url.pathname.startsWith("/_next/static/") || url.pathname === "/manifest.webmanifest") event.respondWith(networkFirst(event, request, 8000));
});
