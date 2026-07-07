import type { Loan } from "./types.js";
import { parseD, monthIndex } from "./date.js";

export const loanPayDay = (l: Loan) => parseD(l.first_date).getDate();

/** Kredinin belirtilen tarihte kalan taksit sayısı; elle güncelleme gerekmez */
export const loanRemaining = (l: Loan, asOf: Date) => {
  const first = parseD(l.first_date);
  let paid = monthIndex(asOf) - monthIndex(first);
  if (paid >= 0 && asOf.getDate() >= Math.min(loanPayDay(l), new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0).getDate())) paid += 1;
  return Math.max(0, l.total - Math.max(0, paid));
};

export const loanActiveOn = (l: Loan, d: Date) => {
  const mi = monthIndex(d) - monthIndex(parseD(l.first_date));
  return mi >= 0 && mi < l.total;
};
