import type { Recurring } from "./types.js";
import { ymOf } from "./date.js";
import { clampDay } from "./cards.js";

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
