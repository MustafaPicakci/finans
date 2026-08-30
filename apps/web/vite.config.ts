import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
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
        /* Yasal sayfalar SPA değildir; servis çalışanının varsayılan navigasyon yedeği bu
           adreslere de index.html döndürür ve sayfa yerine uygulama açılır. Bir kez PWA'yı
           yüklemiş kullanıcıda (ve Google'ın bağlantıyı denetlediği tarayıcıda) gizlilik
           politikası görünmez olurdu — denylist ile navigasyonu ağa bırak. */
        navigateFallbackDenylist: [/^\/gizlilik$/, /^\/kosullar$/],
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
  build: { outDir: "dist" },
});
