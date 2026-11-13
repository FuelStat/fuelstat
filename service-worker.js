// Service Worker (#89, #1)
// - Seiten (Navigation): immer zuerst vom Netz, mit Navigation Preload. Die Anfrage startet so parallel zum Aufwecken
//   des Service Workers und wartet nicht auf ihn.
// - Offline lesen (#1): Die Übersicht und die Fahrzeugseiten werden nach jedem erfolgreichen Laden gemerkt. Ohne
//   Verbindung zeigt der Service Worker den zuletzt geladenen Stand mit Hinweis (data-offline-stand am <html>).
//   Andere Seiten (Formulare, Einstellungen, Admin) werden nie gespeichert.
//   Datenschutz: Der Seiten-Cache wird geleert beim Abmelden und bei jedem Aufruf von Anmelden/Registrieren, also auch,
//   wenn eine abgelaufene Sitzung auf die Anmeldung umleitet. Seiten älter als SEITEN_MAX_ALTER werden nicht mehr
//   gezeigt; der Cache enthält höchstens SEITEN_MAX Seiten.
// - Eigene Bilder (signierte Adressen /api/v1/files/<name>?exp=…&sig=…): vom Netz wie bisher; zusätzlich wird jedes
//   geladene Bild unter seinem Dateinamen (ohne Signatur) gemerkt, damit die gemerkten Seiten offline ihre Bilder zeigen.
//   Gleiche Regeln wie für die Seiten: gelöscht beim Abmelden/Anmelden, höchstens BILDER_MAX, nach SEITEN_MAX_ALTER weg.
// - CSS/JS/Schriften/Bilder der App mit ?v=… (Version) oder fester Datei: aus dem Cache, sonst vom Netz und merken.
//   Neue Versionen haben eine neue Adresse (?v=Änderungszeit), veraltete Dateien gibt es dadurch nicht.
// - API und alles andere: nicht abfangen.
const cacheName = 'fuelstat-v9';
const seitenCache = 'fuelstat-seiten-v1';
const bilderCache = 'fuelstat-bilder-v1';
const SEITEN_MAX = 20;
const BILDER_MAX = 60;
const SEITEN_MAX_ALTER = 7 * 24 * 60 * 60 * 1000;
const vorab = [
  './images/platzhalter.jpg',
  './images/icon-192x192.png',
  './images/new-icon-512x512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(vorab)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const namen = await caches.keys();
    await Promise.all(namen.filter((n) => n !== cacheName && n !== seitenCache && n !== bilderCache).map((n) => caches.delete(n)));
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable().catch(() => {});
    }
    await self.clients.claim();
  })());
});

// Pfad relativ zum Scope, z. B. "index.php" oder "pages/fahrzeug_detail.php"
function pfadImScope(url) {
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return null;
  return url.pathname.slice(scope.pathname.length);
}

// Seiten, die offline lesbar sein sollen: Übersicht und Fahrzeugseite
function offlineLesbar(url) {
  const pfad = pfadImScope(url);
  return pfad === '' || pfad === 'index.php' || pfad === 'pages/fahrzeug_detail.php';
}

// Beim Abmelden und Anmelden die gemerkten Seiten löschen (anderes Konto, geteiltes Gerät)
function leertSeitenCache(url) {
  const pfad = pfadImScope(url);
  return pfad === 'pages/logout.php' || pfad === 'pages/login.php' || pfad === 'pages/register.php';
}

function seitenLeeren() {
  return Promise.all([caches.delete(seitenCache), caches.delete(bilderCache)]).catch(() => {});
}

// Eigenes Bild über die signierte Adresse der API
function istEigenesBild(url) {
  const pfad = pfadImScope(url);
  return pfad !== null && pfad.startsWith('api/v1/files/');
}

// Schlüssel ohne exp/sig: Die Signatur wechselt täglich, der Dateiname nicht
function bildSchluessel(url) {
  return url.origin + url.pathname;
}

async function bildMerken(url, antwort) {
  const typ = antwort.headers.get('Content-Type') || '';
  if (!antwort.ok || antwort.type !== 'basic' || !typ.startsWith('image/')) return;
  const cache = await caches.open(bilderCache);
  const schluessel = bildSchluessel(url);
  const vorhanden = await cache.match(schluessel);
  // Schon frisch gemerkt (unter einem Tag): nicht bei jedem Seitenaufruf neu schreiben
  if (vorhanden && Date.now() - (Number(vorhanden.headers.get('X-Fuelstat-Gespeichert')) || 0) < 24 * 60 * 60 * 1000) return;
  const kopf = new Headers({ 'Content-Type': typ, 'X-Fuelstat-Gespeichert': String(Date.now()) });
  await cache.delete(schluessel);
  await cache.put(schluessel, new Response(await antwort.blob(), { status: 200, headers: kopf }));
  const alle = await cache.keys();
  for (const alt of alle.slice(0, Math.max(0, alle.length - BILDER_MAX))) await cache.delete(alt);
}

async function gemerktesBild(url) {
  const cache = await caches.open(bilderCache);
  const treffer = await cache.match(bildSchluessel(url));
  if (!treffer) return null;
  if (Date.now() - (Number(treffer.headers.get('X-Fuelstat-Gespeichert')) || 0) > SEITEN_MAX_ALTER) {
    await cache.delete(bildSchluessel(url));
    return null;
  }
  return treffer;
}

async function seiteMerken(req, antwort) {
  const typ = antwort.headers.get('Content-Type') || '';
  if (!antwort.ok || antwort.type !== 'basic' || !typ.includes('text/html')) return;
  const kopf = new Headers(antwort.headers);
  kopf.set('X-Fuelstat-Gespeichert', String(Date.now()));
  const gemerkt = new Response(await antwort.blob(), { status: 200, headers: kopf });
  const cache = await caches.open(seitenCache);
  // Vorher löschen, damit die Seite ans Ende rückt: keys() liefert die Einträge in Einfügereihenfolge
  await cache.delete(req.url);
  await cache.put(req.url, gemerkt);
  const schluessel = await cache.keys();
  // Die ältesten über SEITEN_MAX hinaus entfernen
  for (const alt of schluessel.slice(0, Math.max(0, schluessel.length - SEITEN_MAX))) await cache.delete(alt);
}

async function gemerkteSeite(url) {
  const cache = await caches.open(seitenCache);
  const treffer = await cache.match(url);
  if (!treffer) return null;
  const zeit = Number(treffer.headers.get('X-Fuelstat-Gespeichert')) || 0;
  if (Date.now() - zeit > SEITEN_MAX_ALTER) {
    await cache.delete(url);
    return null;
  }
  // Hinweis für die Seite: Stand der Daten (wird in includes/footer.php angezeigt)
  const html = (await treffer.text()).replace('<html ', `<html data-offline-stand="${new Date(zeit).toISOString()}" `);
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function offlineSeite() {
  const start = new URL('index.php', self.registration.scope);
  const startGemerkt = await (await caches.open(seitenCache)).match(start.href);
  const link = startGemerkt
    ? `<p><a href="${start.pathname}">Zur Übersicht (zuletzt geladener Stand)</a></p>`
    : '';
  return new Response(
    '<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Offline – Fuelstat</title><body style="font-family:system-ui;padding:2rem;text-align:center">'
    + '<h1>Keine Verbindung</h1><p>Diese Seite ist offline nicht verfügbar. Bitte später erneut versuchen.</p>'
    + link
    + '<p><a href="" onclick="location.reload();return false">Erneut versuchen</a></p></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

// Statische Datei der App, die sich unter derselben Adresse nie ändert
function istStatisch(url) {
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return false;
  if (/\.(css|js)$/.test(url.pathname)) return url.searchParams.has('v');
  return /\.(woff2?|ttf|png|jpe?g|webp|svg|ico|gif)$/.test(url.pathname) && !url.pathname.includes('/uploads/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    if (leertSeitenCache(url)) event.waitUntil(seitenLeeren());
    event.respondWith((async () => {
      try {
        const vorgeladen = await event.preloadResponse;
        const antwort = vorgeladen || await fetch(req);
        // Umleitungen (z. B. abgelaufene Sitzung → Anmeldung) kommen als eigene Navigation wieder hier an
        if (offlineLesbar(url)) event.waitUntil(seiteMerken(req, antwort.clone()).catch(() => {}));
        return antwort;
      } catch {
        if (offlineLesbar(url)) {
          const gemerkt = await gemerkteSeite(req.url).catch(() => null);
          if (gemerkt) return gemerkt;
        }
        return offlineSeite();
      }
    })());
    return;
  }

  if (istEigenesBild(url)) {
    event.respondWith((async () => {
      try {
        const antwort = await fetch(req);
        event.waitUntil(bildMerken(url, antwort.clone()).catch(() => {}));
        return antwort;
      } catch (e) {
        const gemerkt = await gemerktesBild(url).catch(() => null);
        if (gemerkt) return gemerkt;
        throw e;
      }
    })());
    return;
  }

  if (!istStatisch(url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const treffer = await cache.match(req);
    if (treffer) return treffer;
    const antwort = await fetch(req);
    if (antwort.ok && antwort.type === 'basic') {
      const kopie = antwort.clone();
      event.waitUntil((async () => {
        // Ältere Versionen derselben Datei entfernen, damit der Cache nicht wächst
        for (const alt of await cache.keys()) {
          if (new URL(alt.url).pathname === url.pathname && alt.url !== req.url) await cache.delete(alt);
        }
        await cache.put(req, kopie);
      })().catch(() => {}));
    }
    return antwort;
  })());
});

// --- Push-Benachrichtigungen (#136) ---
// Die API schickt { title, body, url, tag, badge } (Ende-zu-Ende verschlüsselt). url ist relativ zur App, ein Tipp
// öffnet sie. badge: Zahl auf dem App-Symbol (z. B. anstehende Termine), wo der Browser das kann (iOS ab 16.4, Android,
// Desktop); die App löscht sie beim Öffnen (includes/footer.php).
self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch (e) {
    d = { body: event.data ? event.data.text() : '' };
  }
  const scope = self.registration.scope;
  let ziel = scope;
  try {
    const u = new URL(d.url || '', scope);
    // Nur Seiten der App
    if (u.origin === new URL(scope).origin) ziel = u.href;
  } catch (e) { /* Startseite */ }
  const badge = Number.isInteger(d.badge) && 'setAppBadge' in self.navigator ? self.navigator.setAppBadge(d.badge).catch(() => {}) : null;
  event.waitUntil(Promise.all([self.registration.showNotification(d.title || 'Fuelstat', {
    body: d.body || '',
    tag: d.tag || undefined,
    renotify: Boolean(d.tag),
    icon: scope + 'images/icon-192x192.png',
    data: { url: ziel }
  }), badge]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    let url;
    try {
      url = new URL((event.notification.data && event.notification.data.url) || self.registration.scope);
    } catch (e) {
      url = new URL(self.registration.scope);
    }
    // Nur Seiten der App öffnen
    if (url.origin !== self.location.origin) url = new URL(self.registration.scope);
    const fenster = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const f of fenster) {
      if (new URL(f.url).origin !== url.origin) continue;
      await f.focus();
      if ('navigate' in f) return f.navigate(url.href);
      return undefined;
    }
    return self.clients.openWindow(url.href);
  })());
});
