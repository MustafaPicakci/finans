import { useState } from "react";
import type React from "react";

/* ————— YARIM İŞ BELLEKTE —————
   İçe aktarma bir sayfadır ve kullanıcı ortasında başka sekmeye bakabilir (defterdeki eski kaydı
   silmek için Kartlar'a geçmek gibi); dönünce kaldığı yerde olmalı: okunan belge, seçimler,
   kategoriler, düzeltilen adlar. Bunlar MODÜL kapsamında tutulur (asistanın `oturumSohbet`i gibi):
   bileşen sökülüp kurulunca yaşar, sayfa yenilenince ölür. localStorage/sessionStorage DEĞİL —
   okunmuş ekstre şifresiz banka verisidir; cihaza kalıcı yazılmaz ve çıkışta silinir
   (App `iceAktarTemizle`). */
export const bellek: Record<string, unknown> = {};
export const iceAktarTemizle = () => { for (const k of Object.keys(bellek)) delete bellek[k]; };
/** `useState` gibi, ama değer modül belleğinde de durur (bkz. yukarı). */
export function useKalici<T>(ad: string, ilk: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [v, set] = useState<T>(() => (ad in bellek ? (bellek[ad] as T) : ilk));
  bellek[ad] = v;
  return [v, set];
}
