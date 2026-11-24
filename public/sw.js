const CACHE = "sv-v1";
self.addEventListener("install", (e) => {
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// Web Push delivery (when a push subscription/VAPID is configured): admin
// order notifications are sent by the server and shown as OS notifications.
self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) { /* empty payload */ }
  event.waitUntil(
    self.registration.showNotification(payload.title || "SVB Notification", {
      body: payload.body || "",
      data: payload.data || {},
      icon: "/icon.svg",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window" }).then((clients) => {
    const target = event.notification.data?.url || "/orders";
    const existing = clients.find((client) => client.url.includes(target));
    if (existing) return existing.focus();
    return self.clients.openWindow(target);
  }));
});
