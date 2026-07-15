import type { Recurring, RecurringAmount } from "./types.js";
import { ymOf } from "./date.js";
import { clampDay } from "./cards.js";

/** Tutar zaman çizelgesinin "baştan" sentinel'i — her gerçek 'YYYY-MM' değerinden küçük sıralanır */
export const REC_AMOUNT_BEGIN = "0000-01";

/** Tutar satırlarını kaleme göre gruplar, her grubu from_month artan sıralar */
export function recurringAmountIndex(rows: RecurringAmount[]): Map<number, RecurringAmount[]> {
  const idx = new Map<number, RecurringAmount[]>();
  for (const row of rows) {
    const list = idx.get(row.recurring_id);
    list ? list.push(row) : idx.set(row.recurring_id, [row]);
  }
  for (const list of idx.values()) list.sort((a, b) => a.from_month.localeCompare(b.from_month));
  return idx;
}

/** ym ('YYYY-MM') ayında geçerli tutar: from_month <= ym olan en büyük from_month'lu satır; yoksa undefined.
    `rows` recurringAmountIndex çıktısı gibi from_month artan sıralı olmalıdır. */
export function recAmountOn(rows: RecurringAmount[] | undefined, ym: string): number | undefined {
  if (!rows) return undefined;
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].from_month <= ym) return rows[i].amount;
  return undefined;
}

/** ym'den SONRA başlayacak ilk planlı tutar değişikliği (UI ipucu satırı için); yoksa undefined */
export function recNextAmountChange(rows: RecurringAmount[] | undefined, ym: string): RecurringAmount | undefined {
  return rows?.find((r) => r.from_month > ym);
}

export const recActiveOn = (r: Recurring, d: Date) => {
  const ym = ymOf(d);
  if (r.from_month && ym < r.from_month) return false;
  if (r.to_month && ym > r.to_month) return false;
  return true;
};

/** Kalemin `ym` ('YYYY-MM') ayındaki gerçekleşme tarihi; kısa ayda ödeme günü ay sonuna kayar (hits ile tutarlı) */
export const recOccurrenceDate = (r: Recurring, ym: string): Date => {
  const [y, m] = ym.split("-").map(Number);
  return clampDay(y, m - 1, r.day);
};
