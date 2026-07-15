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
