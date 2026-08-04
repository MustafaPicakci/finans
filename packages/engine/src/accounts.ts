import type { Account, AccountEntry } from "./types.js";

/* ————— HESAP HAREKET DEFTERİ (Faz 15) —————
   Defterin değişmez kuralı: **hesabın bakiyesi = Σ o hesabın hareketleri** (açılış bakiyesi de
   'acilis' türünde bir harekettir). Bu yüzden yürüyen bakiye, bugünkü bakiyeden geriye giderek
   değil, ilk hareketten itibaren toplanarak bulunur — iki yöntem aynı sonucu vermeli; vermiyorsa
   defter ile bakiye ayrışmış demektir ve bunu `ledgerDrift` görünür kılar (sessizce düzeltmeyiz). */

/** Bir hesabın hareketi + o hareketten SONRAKİ bakiye */
export type LedgerRow = { entry: AccountEntry; balanceAfter: number };

/** Hareketleri kronolojik sıraya koyar: tarih, eşitlikte önce açılış bakiyesi, sonra id (yazım sırası).
    Açılış istisnası şart: geriye dönük dolumda açılış satırı en son yazıldığından id'si en büyüktür ve
    id'ye göre sıralanırsa aynı günkü hareketlerin ARDINA düşer — yürüyen bakiye o zaman "açılış = son
    bakiye" gibi saçma bir satır üretir. Anlamca açılış her zaman ilk gelir. */
const chrono = (a: AccountEntry, b: AccountEntry): number => {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const opening = (e: AccountEntry) => (e.kind === "acilis" ? 0 : 1);
  return opening(a) - opening(b) || a.id - b.id;
};

/** Bir hesabın hareket defteri, **yeniden eskiye** (ekranda en üstte son hareket).
    `balanceAfter` kronolojik kümülatif toplamdır: satır satır "bu hareketten sonra bakiye neydi". */
export function accountLedger(entries: AccountEntry[], accountId: number): LedgerRow[] {
  const mine = entries.filter((e) => e.account_id === accountId).sort(chrono);
  let running = 0;
  const rows = mine.map((entry) => {
    running += entry.amount;
    return { entry, balanceAfter: running };
  });
  return rows.reverse();
}

/** Defter ile kayıtlı bakiye arasındaki fark (0 olmalı). 0 değilse hesabın bakiyesini
    açıklayamayan bir değişiklik olmuş demektir — arayüz bunu uyarı olarak gösterir. */
export function ledgerDrift(entries: AccountEntry[], account: Account): number {
  const sum = entries.filter((e) => e.account_id === account.id).reduce((s, e) => s + e.amount, 0);
  return account.balance - sum;
}

/** Dönem özeti: seçili hareketlerin giren/çıkan toplamı (net = giren − çıkan) */
export function ledgerSummary(rows: LedgerRow[]): { in: number; out: number; net: number } {
  let inn = 0, out = 0;
  for (const r of rows) (r.entry.amount >= 0 ? (inn += r.entry.amount) : (out += -r.entry.amount));
  return { in: inn, out, net: inn - out };
}
