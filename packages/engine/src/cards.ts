import type { Card, CardTx, StatementPayment, Transaction } from "./types.js";
import { keyOf, parseD } from "./date.js";

export const clampDay = (y: number, m: number, day: number) =>
  new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));

/** Harcamanın girdiği ilk kesim tarihi (kesim günü dahil) */
export const firstCutoff = (purchase: Date, statementDay: number) => {
  let c = clampDay(purchase.getFullYear(), purchase.getMonth(), statementDay);
  if (purchase > c) c = clampDay(purchase.getFullYear(), purchase.getMonth() + 1, statementDay);
  return c;
};

/** Kesimden sonraki ilk son ödeme tarihi */
export const dueOf = (cutoff: Date, dueDay: number) => {
  let d = clampDay(cutoff.getFullYear(), cutoff.getMonth(), dueDay);
  if (d <= cutoff) d = clampDay(cutoff.getFullYear(), cutoff.getMonth() + 1, dueDay);
  return d;
};

/** `cut`: payın girdiği ekstrenin KESİM günü (o gün dahil harcama alır). */
export type Share = { due: Date; cut: Date; amount: number; idx: number; total: number };

/** Bir harcamanın taksit paylarını son ödeme tarihleriyle döndürür */
export function txShares(tx: CardTx, card: Card): Share[] {
  const fc = firstCutoff(parseD(tx.date), card.statement_day);
  const n = taksitSayisi(tx);
  const per = tx.amount / n;
  const out: Share[] = [];
  for (let i = 0; i < n; i++) {
    const cut = clampDay(fc.getFullYear(), fc.getMonth() + i, card.statement_day);
    out.push({ due: dueOf(cut, card.due_day), cut, amount: per, idx: i + 1, total: n });
  }
  return out;
}

/** Taksit sayısı; boş/geçersiz değer TEK ÇEKİMDİR. E2EE'de kolon zarfa taşınınca veritabanının
    `DEFAULT 1`'i kalktı ve asistanın taksitsiz yazdığı harcamalar `installments: null` kaydedildi —
    döngü hiç dönmüyor, harcama listede görünüp hiçbir ekstreye ve borca girmiyordu. Burada
    çözülünce o kayıtlar veri düzeltmesi gerekmeden doğru ekstreye düşer. */
export const taksitSayisi = (tx: Pick<CardTx, "installments">): number => {
  const n = Math.trunc(Number(tx.installments));
  return Number.isFinite(n) && n >= 1 ? n : 1;
};

/** Belirli bir ekstrenin (son ödeme tarihi `dueKey`, 'YYYY-MM-DD') toplam tutarı: o vadeye düşen
    tüm taksit paylarının toplamı. Ekstre ödemesinin tutarı İSTEMCİDEN alınmaz — hem sunucu
    (`POST /cards/:id/pay-statement`) hem asistanın onay ekranı aynı hesabı buradan çağırır. */
export const statementAmount = (card: Card, txs: CardTx[], dueKey: string): number =>
  ekstreDetayi(card, txs, dueKey).toplam;

/** Ekstreye düşen tek kalem: harcamanın kendisi + o ekstreye düşen PAYI (taksitte `idx`/`total`). */
export type EkstreKalemi = { tx: CardTx; tutar: number; idx: number; total: number };

/** Bir ekstrenin İÇERİĞİ: dönem aralığı (`donemBasi`..`kesim`, ikisi dahil) ve o vadeye düşen paylar,
    harcama tarihine göre yeniden eskiye. Ekstreye düşen şey harcamanın tarihi değil kesim günü ve
    taksit payıdır — 6 taksitli bir alışverişin Kasım payı tarihle süzülerek bulunamaz, bu yüzden
    kalemler `txShares`'ten gelir ve `statementAmount` bunun toplamıdır (satırdaki rakam ile
    sayfadaki liste tanım gereği aynı). Ekstrede kalem yoksa kesim bilinmez (`null`). */
export function ekstreDetayi(card: Card, txs: CardTx[], dueKey: string): { kesim: Date | null; donemBasi: Date | null; kalemler: EkstreKalemi[]; toplam: number } {
  let kesim: Date | null = null;
  const kalemler: EkstreKalemi[] = [];
  for (const t of txs) {
    if (t.card_id !== card.id) continue;
    for (const sh of txShares(t, card)) {
      if (keyOf(sh.due) !== dueKey) continue;
      kesim = sh.cut;
      kalemler.push({ tx: t, tutar: sh.amount, idx: sh.idx, total: sh.total });
    }
  }
  kalemler.sort((a, b) => b.tx.date.localeCompare(a.tx.date) || b.tx.id - a.tx.id);
  const donemBasi = kesim ? clampDay(kesim.getFullYear(), kesim.getMonth() - 1, card.statement_day) : null;
  donemBasi?.setDate(donemBasi.getDate() + 1); // önceki kesimin ertesi günü
  return { kesim, donemBasi, kalemler, toplam: kalemler.reduce((s, k) => s + k.tutar, 0) };
}

/** Bir ekstre: `paid` ödendi işareti, `eksik` ödemeden SONRA o ekstreye düşen ve henüz ödenmemiş
    tutar (ödenmemiş ekstrede 0 — orada borç zaten `amount`'un tamamı). */
export type Ekstre = { due: Date; cut: Date; amount: number; paid: boolean; eksik: number };

export type CardInfo = {
  card: Card; debt: number; nextDue: Date | null; nextAmount: number;
  statements: Ekstre[];
};

/** Ödenmiş ekstre kümesi anahtarı (bkz. statement_payments) */
export const stmtKey = (cardId: number, due: Date | string) =>
  `${cardId}:${typeof due === "string" ? due : keyOf(due)}`;

/** Ödenmiş ekstreler: anahtar → ÖDENEN tutar (`null` = bilinmiyor, tamamı ödenmiş sayılır).
    `Set` de kabul edilir (eski çağrılar/testler — tutarsız, yani tamamı ödenmiş). */
export type Odemeler = ReadonlySet<string> | ReadonlyMap<string, number | null>;

/** Ödenen tutar ekstre ödemesinin yazdığı gider kaydından (`statement_payments.tx_id`) okunur —
    "ödendi" işareti kimliğe (kart + vade) bağlıdır, tutara değil; ödemeden sonra o ekstreye düşen
    harcama (geçmiş tarihli giriş, ya da kesimden önce verilmiş ödeme) eskiden borçtan sessizce
    siliniyordu. Kayıt bulunamazsa (eski sunucu, silinmiş satır) tutar bilinmez → tamamı ödenmiş. */
export function ekstreOdemeleri(data: { statement_payments?: StatementPayment[]; transactions?: Transaction[] }): Map<string, number | null> {
  const tx = new Map((data.transactions ?? []).map((t) => [t.id, t]));
  return new Map((data.statement_payments ?? []).map((p) => {
    const t = p.tx_id != null ? tx.get(p.tx_id) : undefined;
    const tutar = t ? Math.abs(Number(t.amount)) : NaN;
    return [stmtKey(p.card_id, p.due), Number.isFinite(tutar) ? tutar : null];
  }));
}

/** Kesimi henüz gelmemiş (hâlâ harcama alan) ekstre — ödemesi verilmez, tutarı kesinleşmedi. */
export const acikDonem = (s: Pick<Ekstre, "cut">, today: Date) => s.cut >= today;

/** Kart başına: güncel borç (bugünden sonra vadesi gelen paylar), yaklaşan ekstreler.
    Ödendi işaretli ekstre listede kalır ama borca yalnız `eksik`i kadar sayılır — UI "ödendi ✓ /
    geri al" gösterebilsin; projeksiyon da yalnız eksiği gider olarak işler. */
export function cardInfos(cards: Card[], txs: CardTx[], today: Date, paid: Odemeler = new Set()): CardInfo[] {
  const odenen = (k: string): { paid: boolean; tutar: number | null } =>
    paid instanceof Map ? (paid.has(k) ? { paid: true, tutar: paid.get(k) ?? null } : { paid: false, tutar: null })
      : { paid: (paid as ReadonlySet<string>).has(k), tutar: null };
  return cards.map((card) => {
    const byDue = new Map<string, Ekstre>();
    txs.filter((t) => t.card_id === card.id).forEach((t) => {
      txShares(t, card).forEach((s) => {
        if (s.due >= today) {
          const k = keyOf(s.due);
          if (!byDue.has(k)) byDue.set(k, { due: s.due, cut: s.cut, amount: 0, paid: odenen(stmtKey(card.id, k)).paid, eksik: 0 });
          byDue.get(k)!.amount += s.amount;
        }
      });
    });
    const statements = [...byDue.values()].sort((a, b) => +a.due - +b.due);
    let debt = 0;
    for (const s of statements) {
      const o = odenen(stmtKey(card.id, keyOf(s.due)));
      // kuruş yuvarlaması (taksit payları) eksik sayılmaz
      if (o.paid && o.tutar != null && s.amount - o.tutar >= 0.01) s.eksik = s.amount - o.tutar;
      debt += s.paid ? s.eksik : s.amount;
    }
    const nextUnpaid = statements.find((s) => !s.paid);
    return {
      card, debt,
      nextDue: nextUnpaid?.due ?? null,
      nextAmount: nextUnpaid?.amount ?? 0,
      statements,
    };
  });
}
