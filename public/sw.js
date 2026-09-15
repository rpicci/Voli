const CACHE_NAME = "flight-watch-v1";
const SHELL = ["/", "/index.html", "/manifest.json", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first: i dati (config, risultati) devono sempre essere freschi.
// Il guscio statico va in cache come fallback offline.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

// Notifiche push: il payload arriva come JSON da lib/webPush.mjs
// ({ title, body, url }). Se il parsing fallisce (payload assente o non
// JSON), mostriamo comunque una notifica generica invece di non mostrare
// nulla.
self.addEventListener("push", (event) => {
  let data = { title: "Flight Watch", body: "Nuovi risultati disponibili.", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (err) {
    // payload non JSON: teniamo i valori di default sopra
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: { url: data.url || "/" },
    })
  );
});

// Al tap sulla notifica: riusa una scheda già aperta della PWA se c'è,
// altrimenti ne apre una nuova sull'URL indicato.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});
