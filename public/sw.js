/* eslint-disable */
// Kilo Energy service worker — handles Web Push events.
//
// Registered from lib/web-push-client.ts on the first time a user
// approves push permissions. The cron / API publishes payloads shaped
// as { title, body, url }; the SW renders them and routes the click to
// the originating URL.
//
// Versioning: bump SW_VERSION when the click handler / payload shape
// changes. Service workers update via the "Update on reload" lifecycle
// — bumping forces a refresh on the next navigation.

const SW_VERSION = 'kilo-sw-1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = { title: 'Kilo Energy', body: '', url: '/' };
  if (event.data) {
    try { data = { ...data, ...event.data.json() }; } catch (_e) {
      data.body = event.data.text();
    }
  }
  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-badge.png',
    data: { url: data.url || '/' },
    tag: data.tag || undefined,
  };
  event.waitUntil(self.registration.showNotification(data.title || 'Kilo Energy', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        try {
          const u = new URL(client.url);
          if (u.origin === self.location.origin) {
            client.focus();
            return client.navigate(targetUrl);
          }
        } catch (_e) {}
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
