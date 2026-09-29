/* ============================================================================
   Mobil görünüm denetimi (Faz 23)
   ----------------------------------------------------------------------------
   Chrome'u DevTools protokolüyle sürer: GERÇEK cihaz emülasyonu (390×844, mobil),
   sekme geçişi, taşma teşhisi ve tam sayfa ekran görüntüsü. Kurulum gerektirmez —
   Node 22'nin yerleşik WebSocket'i yeter (Playwright vb. gerekmiyor).

   NEDEN CDP: Chrome'un `--headless --screenshot --window-size=390,…` yolu macOS'ta
   pencereyi ~500px'in altına indirmiyor; sayfa 500px'e göre dizilip 390px'e KIRPILIYOR.
   Bu, olmayan bir "taşma hatası" gibi görünür (bir kez yanılttı). CDP'nin
   Emulation.setDeviceMetricsOverride'ı gerçek viewport verir.

   Kullanım (veritabanı GEREKMEZ):
     pnpm --filter @finans/web build
     node apps/web/scripts/mobil-stub.mjs &                 # sahte API + dist, :8791
     node apps/web/scripts/mobil-cek.mjs http://localhost:8791/ /tmp/ozet.png
     node apps/web/scripts/mobil-cek.mjs http://localhost:8791/ /tmp/hesap.png Hesap diag
   Argümanlar: <url> <çıktı.png> [sekme adı] [diag]
   Önce Chrome'u hata ayıklama portuyla başlat:
     "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
       --remote-debugging-port=9222 --user-data-dir=/tmp/finans-chrome about:blank & */
import { writeFileSync } from "node:fs";

const PORT = 9222;
const BASE = "http://localhost:" + PORT;

const rpc = (ws) => {
  let id = 0;
  const waiting = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result ?? {}); waiting.delete(m.id); }
  });
  return (method, params = {}) => new Promise((res) => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [, , url, out, tabLabel, mode] = process.argv;

const targets = await (await fetch(`${BASE}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" })).json();
const ws = new WebSocket(targets.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
const send = rpc(ws);

await send("Page.enable");
await send("Runtime.enable");
/* Uygulama bir PWA: service worker eski paketi sunar ve yeni build'i görmezsin.
   Her çekimden önce origin'in tüm depolamasını (SW kaydı dahil) temizle. */
await send("Storage.clearDataForOrigin", { origin: new URL(url).origin, storageTypes: "all" });
await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true });
await send("Page.navigate", { url });
await sleep(3500);

/* E2EE aşama 6: uygulama cihazda veri anahtarı olmadan açılmıyor ve yukarıda depolama
   temizlendi — stub giriş ekranını gösterir. Stub "gir" diyorsa (`stubGiris`; CIKIS=1 modunda
   demez, orada giriş ekranının KENDİSİ denetleniyor) GERÇEK formdan stub parolasıyla girilir:
   tarayıcı parolayı türetir ve stub'daki sarılı anahtarı açar. Parola mobil-stub.mjs'teki
   STUB_PAROLA ile aynı olmalı (oradaki paket bu parolayla üretildi). */
const STUB_PAROLA = "Stub-Parola-2026";
const giris = await send("Runtime.evaluate", {
  awaitPromise: true, returnByValue: true,
  expression: `(async () => {
    if (!document.querySelector("input[type=password]")) return "gerekmedi";
    const me = await (await fetch("/api/auth/me")).json();
    if (!me.stubGiris) return "giriş ekranı (CIKIS)";
    const yaz = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    yaz(document.querySelector("input[type=email]"), "demo@finans.local");
    yaz(document.querySelector("input[type=password]"), ${JSON.stringify(STUB_PAROLA)});
    document.querySelector("form button[type=submit]").click();
    for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 250)); if (!document.querySelector("input[type=password]")) return "giriş yapıldı"; }
    return "giriş BAŞARISIZ: " + document.body.innerText.slice(0, 120);
  })()`,
});
console.log("  oturum:", giris.result?.value);
if (giris.result?.value === "giriş yapıldı") await sleep(2500);

if (tabLabel) {
  await send("Runtime.evaluate", {
    expression: `
      (() => {
        const b = [...document.querySelectorAll("nav button")]
          .find(x => (x.textContent||"").trim().toLowerCase().startsWith(${JSON.stringify(tabLabel.toLowerCase())}));
        if (b) { b.click(); return "tıklandı: " + b.textContent.trim(); }
        return "bulunamadı";
      })()`,
  }).then((r) => console.log("  sekme:", r.result?.value));
  await sleep(1800);
}

if (mode === "diag") {
  const r = await send("Runtime.evaluate", {
    returnByValue: true,
    expression: `
      (() => {
        const W = document.documentElement.clientWidth;
        const bad = [...document.querySelectorAll("*")]
          .map(el => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && r.right > W + 1)
          .map(({ el, r }) => ({
            sel: el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/).join(".") : ""),
            w: Math.round(r.width), right: Math.round(r.right), txt: (el.textContent||"").trim().slice(0, 45),
          }))
          .sort((a,b) => b.right - a.right).slice(0, 12);
        return { W, scrollW: document.documentElement.scrollWidth, bodyScrollW: document.body.scrollWidth, bad };
      })()`,
  });
  console.log(JSON.stringify(r.result?.value, null, 1));
}

const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log("  →", out);
ws.close();
process.exit(0);
