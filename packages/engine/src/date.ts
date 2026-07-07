export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const parseD = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const fmtD = (d: Date, o?: Intl.DateTimeFormatOptions) =>
  d.toLocaleDateString("tr-TR", o || { day: "numeric", month: "long", year: "numeric" });
export const keyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const num = (v: string | number) => { const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? 0 : n; };
/** Bir tarihin ödeme gününe denk gelip gelmediği; kısa aylarda ay sonuna kayar */
export const hits = (date: Date, payDay: number) => {
  const dim = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return date.getDate() === Math.min(payDay, dim);
};
export const monthIndex = (d: Date) => d.getFullYear() * 12 + d.getMonth();
export const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
/** "2026-8", "2026.08", "2026/8" → "2026-08"; geçersizse null (string karşılaştırması bozulmasın) */
export const normYm = (s: string): string | null => {
  const m = s.trim().match(/^(\d{4})[-./](\d{1,2})$/);
  if (!m) return null;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 ? `${m[1]}-${String(mo).padStart(2, "0")}` : null;
};
