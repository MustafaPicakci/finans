import type { Account, AccountEntry, AccountKind } from "./types.js";

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

/* ————— BAKİYE ARTIK TÜRETİLİR (Faz 42) —————
   `accounts.balance` kolonu kalktı; bakiye defterin kendisinden gelir. Değişmez zaten
   "bakiye = Σ hareketler" diyordu, yani bu yeni bir kural DEĞİL — tek gerçeği iki yerde
   tutmayı bırakmak. Doğrudan sonucu: `ledgerDrift` kavramsal olarak öldü (fark tanım
   gereği 0) ve onunla birlikte "defter ile bakiye ayrıştı" diye bir hata sınıfı kalmadı.

   Maliyeti yok — `account_entries` zaten `/api/all` ile tamamen istemciye geliyor ve
   `accountLedger` aynı diziyi zaten geziyor. (Aynı değişiklik şifreleme çalışmasının da ön
   koşuluydu: şifreli tutarlar sunucuda toplanamaz.) */

/** Tek bir hesabın bakiyesi = o hesabın hareketlerinin toplamı (açılış dahil). */
export function accountBalance(entries: AccountEntry[], accountId: number): number {
  let sum = 0;
  for (const e of entries) if (e.account_id === accountId) sum += e.amount;
  return sum;
}

/** Tüm hesapların bakiyesi tek geçişte — hesap başına `accountBalance` çağırmak
    N×M gezinti demekti (hesap sayısı × hareket sayısı); toplam nakit ve hesap listesi
    her render'da hesaplanıyor. */
export function balancesByAccount(entries: AccountEntry[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const e of entries) m.set(e.account_id, (m.get(e.account_id) ?? 0) + e.amount);
  return m;
}

/** Toplam nakit: tüm hesapların bakiyeleri. Çağrı yerleri bunu dört ayrı yerde
    `accounts.reduce((s,a) => s + a.balance, 0)` diye tekrarlıyordu. */
export function totalCash(entries: AccountEntry[]): number {
  let sum = 0;
  for (const e of entries) sum += e.amount;
  return sum;
}

/** Dönem özeti: seçili hareketlerin giren/çıkan toplamı (net = giren − çıkan) */
export function ledgerSummary(rows: LedgerRow[]): { in: number; out: number; net: number } {
  let inn = 0, out = 0;
  for (const r of rows) (r.entry.amount >= 0 ? (inn += r.entry.amount) : (out += -r.entry.amount));
  return { in: inn, out, net: inn - out };
}

/* ————— MUTABAKAT (Faz 16) —————
   Defter kendi içinde tutarlı olsa bile GERÇEK hesapla ayrışabilir: unutulan bir harcama, girilmemiş
   bir transfer, banka masrafı. `ledgerDrift` defter-içi tutarsızlığı yakalar; mutabakat ise defteri
   dış dünyaya sabitler — kullanıcı "bankada şu an şu kadar var" der, fark 'duzeltme' hareketi olarak
   YAZILIR (gizlenmez, tarihi ve tutarı defterde durur). Mutabakat sonrası bakiye tanım gereği doğrudur;
   soru "bakiyem tutuyor mu" olmaktan çıkıp "en son ne zaman doğruladım" olur. */

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  banka: "Banka", nakit: "Nakit", araci: "Aracı kurum", fon: "Fon",
};
export const accountKindOf = (a: Account): AccountKind => a.kind ?? "banka";

/** Mutabakat farkı: gerçek bakiye − kayıtlı bakiye. Pozitif = defterde eksik para (girilmemiş gelir/
    unutulan transfer), negatif = defterde fazla para (girilmemiş harcama). */
export function reconcileDiff(currentBalance: number, realBalance: number): number {
  return realBalance - currentBalance;
}

/** Mutabakat durumu — `staleDays` günden eski (veya hiç yapılmamış) doğrulama arayüzde hatırlatılır.
    `today`/`last_recon_date` 'YYYY-MM-DD'; sözlük sırası tarih sırasıyla aynı olduğundan gün farkı
    yerine doğrudan eşik tarihiyle karşılaştırılır. */
export function reconStatus(account: Account, today: string, staleDays = 30): "hic" | "guncel" | "bayat" {
  const last = account.last_recon_date;
  if (!last) return "hic";
  const t = new Date(`${today}T00:00:00`);
  t.setDate(t.getDate() - staleDays);
  const cutoff = t.toISOString().slice(0, 10);
  return last >= cutoff ? "guncel" : "bayat";
}

/** Mutabakat sonrası kontrol için: son mutabakattan BU YANA yazılmış hareketler (o günden sonrası).
    "Fark nereden çıktı" sorusunda bakılacak pencere budur. */
export function entriesSinceRecon(entries: AccountEntry[], account: Account): AccountEntry[] {
  const since = account.last_recon_date;
  return entries.filter((e) => e.account_id === account.id && (!since || e.date >= since)).sort(chrono).reverse();
}
