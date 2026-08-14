import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

/* ————— PWA güncellemesi açık sayfaya da uygulansın (Faz 23) —————
   `registerSW.js` yalnızca servis çalışanını KAYDEDER. Yeni sürüm indirilip
   (skipWaiting + clientsClaim ile) denetimi devraldığında bile, açık olan sayfa
   belleğindeki ESKİ paketi çalıştırmaya devam ediyordu: kullanıcı düzeltilmiş bir
   hatayı uygulamayı tamamen kapatıp açana dek görmeye devam ediyordu (mobil yerleşim
   düzeltmesinde birebir yaşandı — sunucuda yeni sürüm vardı, telefonda eski).
   Denetim el değiştirdiğinde bir kez yeniliyoruz.
   `hadController` kapısı şart: ilk kurulumda da `controllerchange` tetiklenir, o an
   yenilemek yeni ziyaretçiyi sebepsiz bir yeniden yüklemeye sokardı. */
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
}

createRoot(document.getElementById("root")!).render(<App />);
