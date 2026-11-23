'use strict';
// Beim Ändern von Dateien die Versionsnummer erhöhen (aktuell App 2.5 = notvorrat-v10), damit Handys die neue Version laden.
const CACHE = 'notvorrat-v10';
const ASSETS = [
  './',
  './style.css',
  './app.js',
  './data.js',
  './LICENSES.txt',
  './manifest.webmanifest',
  './lib/jsQR.js',
  './lib/qrcode.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache zuerst (funktioniert ohne Netz), im Hintergrund aktualisieren.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      const net = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return net.then(res => res || (req.mode === 'navigate' ? caches.match('./') : Response.error()));
    })
  );
});

// ---------- MHD-Prüfung im Hintergrund (Chrome Android, nicht garantiert) ----------
function readState() {
  return new Promise(res => {
    const r = indexedDB.open('notvorrat', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); }; // wie in der App, damit kein leerer Zustand entsteht
    r.onerror = () => res(null);
    r.onsuccess = () => {
      try {
        const t = r.result.transaction('kv').objectStore('kv').get('state');
        t.onsuccess = () => res(t.result || null);
        t.onerror = () => res(null);
      } catch (e) { res(null); }
    };
  });
}
function dLeft(mhd) {
  const [y, m, d] = mhd.split('-').map(Number);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - now) / 86400000);
}
self.addEventListener('periodicsync', e => {
  if (e.tag !== 'mhd-check') return;
  e.waitUntil((async () => {
    const st = await readState();
    if (!st || !Array.isArray(st.items)) return;
    let exp = 0, soon = 0;
    st.items.forEach(it => {
      if (!(+it.qty > 0)) return;
      const lots = (it.batches && it.batches.length) ? it.batches : [{ qty: it.qty, mhd: it.mhd }];
      lots.forEach(l => {
        if (!(+l.qty > 0) || !l.mhd) return;
        const d = dLeft(l.mhd);
        if (d < 0) exp++; else if (d <= 30) soon++;
      });
    });
    if (!exp && !soon) return;
    const p = [];
    if (exp) p.push(`${exp} abgelaufen`);
    if (soon) p.push(`${soon} laufen in ≤ 30 Tagen ab`);
    await self.registration.showNotification('Notvorrat: MHD prüfen', { body: p.join(' · '), icon: 'icons/icon-192.png', tag: 'mhd' });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('./');
  }));
});
