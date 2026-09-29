/* apps/web'in DAR test altyapısı (E2EE aşama 5): jsdom ve bileşen testi YOK — yalnız
   `src` altındaki `.test.ts` dosyalarındaki saf fonksiyonlar (yazma boru hattı, codec). Vite config'i
   ayrı tutuldu ki PWA eklentisi test koşusuna girmesin. */
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts"], environment: "node" } });
