/* Vite'ın `?url` içe aktarması: dosyayı derlemeye kopyalar ve adresini verir (pdf.js işçisi için) */
declare module "*?url" {
  const adres: string;
  export default adres;
}

/* Vite'ın derleme anında yerine koyduğu ortam bayrağı (tam `vite/client` tipleri alınmadı: yalnız bu
   alan kullanılıyor — kapalı okuyucunun geliştirmede yalıtımsız açılması, bkz. forms/pdfOku.ts) */
interface ImportMetaEnv { readonly DEV: boolean }
interface ImportMeta { readonly env: ImportMetaEnv }
