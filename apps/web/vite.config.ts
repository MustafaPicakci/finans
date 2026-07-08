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
        background_color: "#0D1322",
        theme_color: "#0D1322",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        /* /api/all: önce ağ dene (5sn), olmazsa son başarılı kopyayı göster — offline'da salt-okunur görünüm */
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname === "/api/all",
            handler: "NetworkFirst",
            options: {
              cacheName: "api-all",
              networkTimeoutSeconds: 5,
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
