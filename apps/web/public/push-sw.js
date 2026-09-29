/* Bildirim dinleyicisi (Faz 44) — vite-plugin-pwa'nın ürettiği servis çalışanına `importScripts`
   ile eklenir (vite.config.ts). Gövdeyi tarayıcı zaten çözmüş verir (RFC 8291): içerik istemcide
   cihazın anahtarıyla şifrelendi, sunucu açamadan iletti, burada düz JSON'dur.
   Her push GÖRÜNÜR bir bildirim göstermek zorunda (Chrome/Safari kuralı) — sessiz push yok. */
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { /* bozuk gövde: genel metinle göster */ }
  e.waitUntil(self.registration.showNotification(d.baslik || "Finans", {
    body: d.govde || "",
    tag: d.anahtar || undefined, // aynı olay ikinci kez gelirse üst üste binmez, yerini alır
    icon: "/icon-192.png",
    data: { url: d.url || "/" },
  }));
});
/* Dokununca ilgili ekran: açık bir pencere varsa oraya gider, yoksa yenisini açar */
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const hedef = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((pencereler) => {
    for (const p of pencereler) {
      if (new URL(p.url).origin === self.location.origin && "focus" in p) return p.focus().then((w) => (w || p).navigate(hedef));
    }
    return self.clients.openWindow(hedef);
  }));
});
