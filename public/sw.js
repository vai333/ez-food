/* EZ FOOD service worker (hand-written, versioned).
 * - Static chunks + fonts: cache-first (immutable, hashed).
 * - App pages: network-first, fall back to the cached page, then /offline.
 * - GET /api/today, /api/plan, /api/recipe, /api/game, /api/pantry: network-first with cached fallback, so Today,
 *   recipes and cooking mode work offline. Mutations are queued by the page (lib/client/api.ts), never here.
 * - Web Push: shows notifications; action buttons call the API in the background.
 */
const VERSION = "ezf-v1";
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const DATA = `${VERSION}-data`;
const PRECACHE = ["/offline", "/today", "/icons/icon-192.png", "/icons/icon.svg"];
const CACHEABLE_API = ["/api/today", "/api/plan", "/api/recipe", "/api/game", "/api/pantry", "/api/settings"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(PAGES).then((c) => c.addAll(PRECACHE).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

async function networkFirst(req, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreVary: true });
    if (hit) return hit;
    if (fallbackUrl) {
      const fb = await caches.match(fallbackUrl);
      if (fb) return fb;
    }
    return new Response(JSON.stringify({ error: { code: "offline", message: "You're offline." } }), { status: 503, headers: { "Content-Type": "application/json" } });
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/_next/image")) {
    e.respondWith(
      caches.open(STATIC).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    if (CACHEABLE_API.some((p) => url.pathname.startsWith(p))) e.respondWith(networkFirst(req, DATA));
    return;
  }
  if (req.mode === "navigate") {
    e.respondWith(networkFirst(req, PAGES, "/offline"));
  }
});

// ---------- Push ----------
self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { title: "EZ FOOD", body: e.data ? e.data.text() : "" };
  }
  const actions = [];
  if (data.action === "done") actions.push({ action: "done", title: "Done" });
  if (data.action === "water") actions.push({ action: "water", title: "+1 glass" });
  if (data.action === "start") actions.push({ action: "open", title: "Start cooking" });
  e.waitUntil(
    self.registration.showNotification(data.title || "EZ FOOD", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.kind || "ezf",
      renotify: data.kind === "wake_activation",
      requireInteraction: data.kind === "wake_activation",
      data: { url: data.url || "/today", kind: data.kind },
      actions,
    }),
  );
  if (self.navigator && "setAppBadge" in self.navigator) self.navigator.setAppBadge(1).catch(() => {});
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  if (e.action === "water") {
    e.waitUntil(fetch("/api/water", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delta: 1 }) }).catch(() => {}));
    return;
  }
  const target = e.action === "done" ? "/today?morning=1&done=1" : d.url || "/today";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(target).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
