import type { Recurring } from "./types.js";
import { ymOf } from "./date.js";

export const recActiveOn = (r: Recurring, d: Date) => {
  const ym = ymOf(d);
  if (r.from_month && ym < r.from_month) return false;
  if (r.to_month && ym > r.to_month) return false;
  return true;
};
