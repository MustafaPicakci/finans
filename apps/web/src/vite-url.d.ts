/* Vite'ın `?url` içe aktarması: dosyayı derlemeye kopyalar ve adresini verir (pdf.js işçisi için) */
declare module "*?url" {
  const adres: string;
  export default adres;
}
