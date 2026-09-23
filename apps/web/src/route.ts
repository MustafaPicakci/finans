import { useCallback, useEffect, useState } from "react";
import { NAV, PROFIL_META, TANIMLAR_META, type TabKey } from "./nav";

/* ————— sekme adresleri —————
   Aktif sekme eskiden yalnız `useState`'te yaşıyordu (App.tsx) ve bunun üç ayrı bedeli
   vardı: her sayfa yenilemesi kullanıcıyı Özet'e atıyordu, tarayıcının geri tuşu sekmeler
   arasında hiçbir şey yapmıyordu, ve açık ekranın linki paylaşılamıyordu. Artık adres
   çubuğu tek gerçek kaynaktır; `tab` onun türevi.

   **Özet'in adresi "/" — "/ozet" DEĞİL.** Manifest'teki `start_url` ve paylaşım hedefinin
   `action`'ı "/" (vite.config.ts); Özet'i başka bir yola taşımak telefonuna PWA'yı kurmuş
   kullanıcıyı her açılışta bir yönlendirmeye sokardı. Aynı sebeple "/app" de Özet'e düşer
   (landing'in "Uygulamayı aç" düğmesi oraya gider, apps/server/index.ts).

   Sunucu tarafında yapılacak bir şey YOK ve bu tesadüf değil: `app.get("*", serveApp)`
   bilinmeyen yolu zaten index.html ile karşılıyor (apps/server/index.ts) ve servis
   çalışanının navigasyon yedeği de öyle (vite.config.ts `navigateFallbackDenylist` yalnız
   yasal sayfaları dışarıda bırakır) — yani "/portfoy" adresine doğrudan girmek de,
   oradayken yenilemek de, çevrimdışı açmak da çalışır. **Yeni sekme eklerken yapılacak
   tek iş NAV'a (ya da META'lara) eklemektir**; yol anahtardan türer.

   Yasal sayfalar (/gizlilik, /kosullar) buranın dışındadır — onlar SPA değil, sunucunun
   ayrı rotaları (Faz 28). Bir sekme anahtarı asla o adlarla çakışmamalı. */

const KEYS: string[] = [...NAV.map((n) => n.key), TANIMLAR_META.key, PROFIL_META.key];

export const tabPath = (t: TabKey) => (t === "ozet" ? "/" : `/${t}`);

/** Yoldan sekme — tanınmayan her şey (kök, "/app", elle yazılmış hatalı adres) Özet'e düşer. */
export const tabOfPath = (pathname: string): TabKey => {
  const seg = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  return KEYS.includes(seg) ? (seg as TabKey) : "ozet";
};

/**
 * Sekme durumu + tarayıcı geçmişi. `setTab(t)` bir geçmiş kaydı iter (geri tuşu bir
 * önceki sekmeye döner), `setTab(t, true)` mevcut kaydı değiştirir.
 */
export function useTabRoute(): [TabKey, (t: TabKey, replace?: boolean) => void] {
  const [tab, setTab] = useState<TabKey>(() => tabOfPath(window.location.pathname));
  useEffect(() => { // geri/ileri tuşu
    const pop = () => setTab(tabOfPath(window.location.pathname));
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const go = useCallback((t: TabKey, replace = false) => {
    setTab(t);
    const yol = tabPath(t);
    /* Sorgu dizesi BİLEREK taşınmaz: bu uygulamaya sorguyla gelinen iki yol da tek
       kullanımlıktır — `?ekle=` (paylaşılan SMS) ve `?reset=`/`?verify=` (e-posta
       bağlantısı). Taşısaydık geri tuşuyla dönen kullanıcı aynı metni ikinci kez
       göndermiş, aynı token'ı ikinci kez harcamış olurdu.
       Yol zaten aynıysa itme değil değiştirme yapılır, yoksa aynı sekmeye ikinci kez
       tıklamak geçmişe kopya kayıt yığardı (geri tuşu hiçbir yere gitmezdi). */
    if (replace || window.location.pathname === yol) window.history.replaceState({}, "", yol);
    else window.history.pushState({}, "", yol);
  }, []);
  return [tab, go];
}
