// Putzplan – Service Worker: Offline-Betrieb und tägliche Erinnerungen.
importScripts('scheduler.js', 'shared.js');

const CACHE = 'putzplan-v2';
const ASSETS = [
  './', 'index.html', 'styles.css', 'app.js', 'scheduler.js', 'templates.js', 'shared.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Netzwerk zuerst (damit Updates ankommen), bei Offline aus dem Cache.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});

// Tägliche Erinnerung: Der Server schickt nur den Weckruf, die Aufgaben
// für heute werden hier auf dem Gerät aus den gespeicherten Daten berechnet.
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) { /* leerer Push */ }

  event.waitUntil((async () => {
    let msg = { title: payload.title || 'Putzplan', body: payload.body || 'Schau nach, was heute zu tun ist 🧽' };
    try {
      const state = await self.PutzplanShared.kvGet('state');
      if (state && state.onboarded) msg = self.PutzplanShared.reminderMessage(state, self.Scheduler);
    } catch (e) { /* Fallback-Text verwenden */ }
    if (payload.test) msg.title = '🔔 Test · ' + msg.title;
    await self.registration.showNotification(msg.title, {
      body: msg.body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'putzplan-daily',
      renotify: true,
      data: { url: './' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) return w.focus();
    }
    return self.clients.openWindow('./');
  })());
});
