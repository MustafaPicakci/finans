import type { Card, CardTx } from "./types.js";
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

export type Share = { due: Date; amount: number; idx: number; total: number };

/** Bir harcamanın taksit paylarını son ödeme tarihleriyle döndürür */
export function txShares(tx: CardTx, card: Card): Share[] {
  const fc = firstCutoff(parseD(tx.date), card.statement_day);
  const per = tx.amount / tx.installments;
  const out: Share[] = [];
  for (let i = 0; i < tx.installments; i++) {
    const cut = clampDay(fc.getFullYear(), fc.getMonth() + i, card.statement_day);
    out.push({ due: dueOf(cut, card.due_day), amount: per, idx: i + 1, total: tx.installments });
  }
  return out;
}

export type CardInfo = {
  card: Card; debt: number; nextDue: Date | null; nextAmount: number;
  statements: { due: Date; amount: number; paid: boolean }[];
};

/** Ödenmiş ekstre kümesi anahtarı (bkz. statement_payments) */
export const stmtKey = (cardId: number, due: Date | string) =>
  `${cardId}:${typeof due === "string" ? due : keyOf(due)}`;

/** Kart başına: güncel borç (bugünden sonra vadesi gelen paylar), yaklaşan ekstreler.
    `paid` (stmtKey kümesi) ile ödendi işaretlenen ekstre listede kalır ama borca/sıradakine sayılmaz —
    UI "ödendi ✓ / geri al" gösterebilsin; projeksiyon da gider olarak işlemez. */
export function cardInfos(cards: Card[], txs: CardTx[], today: Date, paid: Set<string> = new Set()): CardInfo[] {
  return cards.map((card) => {
    const byDue = new Map<string, { due: Date; amount: number; paid: boolean }>();
    let debt = 0;
    txs.filter((t) => t.card_id === card.id).forEach((t) => {
      txShares(t, card).forEach((s) => {
        if (s.due >= today) {
          const k = keyOf(s.due);
          const isPaid = paid.has(stmtKey(card.id, k));
          if (!isPaid) debt += s.amount;
          if (!byDue.has(k)) byDue.set(k, { due: s.due, amount: 0, paid: isPaid });
          byDue.get(k)!.amount += s.amount;
        }
      });
    });
    const statements = [...byDue.values()].sort((a, b) => +a.due - +b.due);
    const nextUnpaid = statements.find((s) => !s.paid);
    return {
      card, debt,
      nextDue: nextUnpaid?.due ?? null,
      nextAmount: nextUnpaid?.amount ?? 0,
      statements,
    };
  });
}
