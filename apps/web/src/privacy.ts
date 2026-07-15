import { useSyncExternalStore } from "react";

/* ————— Bakiye gizleme (gizlilik modu) —————
   Public alanlarda tutarları saklamak için tek global anahtar. Kaynak modül seviyesinde
   tutulur ki para biçimleyicileri (tl/tl2/fmtMoney) prop geçmeden doğrudan okuyabilsin;
   useSyncExternalStore aboneliği anahtar değişince tüm ağacı yeniden render ettirir. */

const KEY = "finans-hide-balances";
let hidden = ((): boolean => {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
})();
const subs = new Set<() => void>();

export const isBalancesHidden = () => hidden;
export function setBalancesHidden(v: boolean) {
  hidden = v;
  try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* yok say */ }
  subs.forEach((f) => f());
}
export const toggleBalancesHidden = () => setBalancesHidden(!hidden);

const subscribe = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
/** Bileşenlerin gizlilik durumuna abone olması (anahtar değişince re-render) */
export const useBalancesHidden = () => useSyncExternalStore(subscribe, () => hidden, () => hidden);

/** Biçimlenmiş bir para dizisindeki ilk sayı öbeğini maskeler; para simgesi ve işaret korunur.
    Konumdan bağımsızdır: "₺1.234" → "₺••••", "1.234,56 ₺" → "•••• ₺", "-$1,234" → "-$••••". */
export const maskMoney = (s: string) => s.replace(/\d[\d.,]*/, "••••");
/** Kısa (k/M) biçimli bakiye rakamları (takvim gibi) için maske */
export const maskBrief = (s: string) => (hidden ? "••" : s);
