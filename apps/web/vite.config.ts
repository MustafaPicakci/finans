import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KOK = dirname(fileURLToPath(import.meta.url));

/* Dev'de "/" tanıtım sayfasını göstersin (Faz 30).
   Prod'da bu dallanmayı Hono yapıyor (apps/server/index.ts): anonim → landing,
   girişli → uygulama. Vite dev sunucusu o koddan habersiz olduğu için "/" hep
   index.html döndürüyordu — yani landing yalnız prod build'de görülebiliyordu ve
   üzerinde çalışırken her seferinde build almak gerekiyordu. Bu eklenti aynı
   kuralı dev'de de uygular; oturum çerezi varsa dokunmaz, SPA'yı bırakır. */
const landingDev = () => ({
  name: "finans-landing-dev",
  configureServer(server: { config: { root: string }; middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void } }) {
    server.middlewares.use((req, res, next) => {
      const [path, query] = (req.url || "").split("?");
      const girisli = /(^|;\s*)finans_session=/.test(req.headers.cookie || "");
      const paylasim = new URLSearchParams(query || "").has("ekle");
      if (path !== "/" || girisli || paylasim) return next();
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(readFileSync(resolve(server.config.root, "public/landing.html"), "utf8"));
    });
  },
});

/* Faz 45.6 — OCR dosyaları: Tesseract'ın işçisi, motoru ve Türkçe dil verisi CDN'den DEĞİL kendi
   sunucumuzdan gelir (kapalı okuyucunun CSP'si ağı yalnız kendi dosyalarına açar). node_modules'tan
   `okuyucu-veri/` altına kopyalanır (build) ya da oradan sunulur (dev). Motorun üç sürümü var —
   işçi tarayıcının SIMD desteğine göre YALNIZ BİRİNİ indirir. Dil verisi `best_int` (2,1 MB, gzip'li;
   tesseract.js'in varsayılanı). Sürümler package.json'da tam sabittir. */
const gerek = createRequire(import.meta.url);
const tesseractKok = dirname(gerek.resolve("tesseract.js/package.json"));
const cekirdekKok = dirname(createRequire(resolve(tesseractKok, "package.json")).resolve("tesseract.js-core/package.json"));
const dilKok = dirname(gerek.resolve("@tesseract.js-data/tur"));
const OKUYUCU_VERI: Record<string, string> = {
  "worker.min.js": resolve(tesseractKok, "dist/worker.min.js"),
  "tesseract-core-lstm.wasm.js": resolve(cekirdekKok, "tesseract-core-lstm.wasm.js"),
  "tesseract-core-simd-lstm.wasm.js": resolve(cekirdekKok, "tesseract-core-simd-lstm.wasm.js"),
  "tesseract-core-relaxedsimd-lstm.wasm.js": resolve(cekirdekKok, "tesseract-core-relaxedsimd-lstm.wasm.js"),
  "tur.traineddata.gz": resolve(dilKok, "4.0.0_best_int/tur.traineddata.gz"),
};
const okuyucuVeri = () => ({
  name: "finans-okuyucu-veri",
  configureServer(server: { middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void } }) {
    server.middlewares.use((req, res, next) => {
      const m = /^\/okuyucu-veri\/([^/?]+)/.exec(req.url || "");
      const dosya = m && OKUYUCU_VERI[m[1]];
      if (!dosya) return next();
      res.setHeader("Content-Type", dosya.endsWith(".js") ? "text/javascript" : "application/octet-stream");
      res.end(readFileSync(dosya));
    });
  },
  /* PWA eklentisi her HTML'e servis çalışanı kaydı + manifest ekler (paket üretilirken, HTML
     dönüşümünden SONRA); opak kökenli okuyucuda ikisi de yalnız hata üretir (kayıt SecurityError,
     manifest CSP'ye takılır). Dosya diske yazıldıktan sonra temizlenir. */
  writeBundle(opts: { dir?: string }) {
    const yol = resolve(opts.dir ?? resolve(KOK, "dist"), "okuyucu.html");
    const html = readFileSync(yol, "utf8");
    writeFileSync(yol, html.replace(/<link rel="manifest"[^>]*>/, "").replace(/<script id="vite-plugin-pwa:register-sw"[^>]*><\/script>/, ""));
  },
  generateBundle(this: { emitFile: (f: { type: "asset"; fileName: string; source: Uint8Array }) => void }) {
    for (const [ad, yol] of Object.entries(OKUYUCU_VERI)) this.emitFile({ type: "asset", fileName: `okuyucu-veri/${ad}`, source: readFileSync(yol) });
  },
});

export default defineConfig({
  plugins: [
    landingDev(),
    okuyucuVeri(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Finans",
        short_name: "Finans",
        description: "Kişisel finans paneli",
        lang: "tr",
        start_url: "/",
        display: "standalone",
        /* Faz 23 — paylaşım hedefi: Android'de herhangi bir metnin (özellikle banka harcama
           SMS'inin) "Paylaş" menüsünde Finans çıkar. Paylaşılan metin `?ekle=` ile açılışta
           Asistan'a gider, orada çözümlenip onaya sunulur. GET seçildi: yan etkisi olmayan
           bir gezinme (POST share_target servis çalışanında istek yakalamayı gerektirirdi ve
           uygulama zaten hiçbir şeyi onaysız yazmıyor).
           iOS Safari share_target desteklemez; orada aynı URL'e Kısayollar'dan gidilir. */
        share_target: {
          /* action'da sorgu dizesi YOK: paylaşım parametreleri buna eklenecek, iki sorgu
             dizesinin birleşmesi tarayıcıya göre değişir. Paylaşımı `ekle` parametresinin
             varlığından anlıyoruz zaten. */
          action: "/",
          method: "GET",
          params: { title: "title", text: "ekle", url: "url" },
        },
        background_color: "#0D0D11",
        theme_color: "#0D0D11",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        /* Faz 45 — pdf.js (~480 KB + ~1,2 MB işçi) yalnız ekstre PDF'i seçilince yüklenir; önbelleğe
           alınsa PDF'i hiç kullanmayan herkes kurulumda indirirdi. Ağ zaten gerekli (içe aktarma yazar).
           Faz 45.6: pdf.js ve OCR (~6 MB) artık kapalı okuyucuda (okuyucu.html + okuyucu-veri/) — aynı gerekçe. */
        globIgnores: ["**/pdf-*.js", "**/pdf.worker*", "**/okuyucu*", "okuyucu-veri/**"],
        /* Faz 44 — push dinleyicisi ayrı dosyada (public/push-sw.js): generateSW'dan injectManifest'e
           geçmek tüm önbellek yapılandırmasını elle yazmayı gerektirirdi, iki olay dinleyicisi için değmez. */
        importScripts: ["push-sw.js"],
        /* Yasal sayfalar SPA değildir; servis çalışanının varsayılan navigasyon yedeği bu
           adreslere de index.html döndürür ve sayfa yerine uygulama açılır. Bir kez PWA'yı
           yüklemiş kullanıcıda (ve Google'ın bağlantıyı denetlediği tarayıcıda) gizlilik
           politikası görünmez olurdu — denylist ile navigasyonu ağa bırak. */
        navigateFallbackDenylist: [/^\/gizlilik$/, /^\/kosullar$/, /^\/okuyucu/],
        /* /api/all: önce ağ dene, olmazsa son başarılı kopyayı göster — offline'da salt-okunur görünüm.
           Timeout 30sn: Render ücretsiz katmanı atıllıkta uyur, soğuk başlangıç 30-60sn sürebilir;
           kısa timeout (eski 5sn) mutasyon sonrası ESKİ anlık görüntüyü sessizce gösteriyordu.
           Çevrimdışıyken ağ anında hata verir → yine anında cache'e düşer (bu senaryo değişmez). */
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname === "/api/all",
            handler: "NetworkFirst",
            options: {
              cacheName: "api-all",
              networkTimeoutSeconds: 30,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: { proxy: { "/api": "http://localhost:8787" } },
  build: {
    outDir: "dist",
    // Faz 45.6 — kapalı belge okuyucu ayrı bir sayfadır (sandbox'lı iframe, bkz. src/okuyucu/)
    rollupOptions: { input: { main: resolve(KOK, "index.html"), okuyucu: resolve(KOK, "okuyucu.html") } },
  },
});
