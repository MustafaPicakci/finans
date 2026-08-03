/* ————— EKSTRE / TABLO YAPIŞTIRMA AYRIŞTIRICISI —————
   Banka ekstresinden, Excel'den ya da aracı kurum ekranından kopyalanan satırları
   `ParsedRow`'a çevirir. Tek satırlık bir "format" yoktur; bu yüzden sezgisel çalışır:
   sütun ayırıcı ve tarih/tutar sütunları satırların çoğunluğuna bakılarak seçilir.
   Saf fonksiyon — ağ/DOM yok, testlerle korunur. */

/** Ayrıştırılmış tek satır. `amount` işaretlidir: gider −, gelir +. */
export type ParsedRow = { date: string; name: string; amount: number };
export type ParseResult = { rows: ParsedRow[]; skipped: string[] };

/** Sütun ayırıcı adayları — sekme (Excel/tablo kopyası), noktalı virgül (TR CSV), virgül (CSV), 2+ boşluk */
const SEPARATORS: { re: RegExp; name: string }[] = [
  { re: /\t/, name: "tab" },
  { re: /;/, name: "semi" },
  { re: /,/, name: "comma" },
  { re: / {2,}|\s\|\s/, name: "space" },
];

/** "12.03.2026", "12/03/2026", "2026-03-12", "12.03.26" → "2026-03-12" (yoksa null) */
export function parseDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(t);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})$/.exec(t);
  if (m) {
    const y = +m[3];
    return iso(y < 100 ? 2000 + y : y, +m[2], +m[1]); // TR: gün.ay.yıl
  }
  return null;
}
const iso = (y: number, mo: number, d: number): string | null => {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2999) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

/** "1.234,56" / "1,234.56" / "-1234" / "1.234,56 TL" / "(1.234,56)" → sayı (yoksa null).
    Ondalık ayırıcı: son geçen `,` veya `.`'nın sağında 1-2 hane varsa o ayırıcıdır. */
export function parseAmount(s: string): number | null {
  let t = s.trim().replace(/\s| /g, "").replace(/(TL|TRY|₺|USD|\$)/gi, "");
  if (t === "") return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }       // (1.234,56) = negatif
  if (/^[-−]/.test(t)) { neg = true; t = t.slice(1); }
  if (/^\+/.test(t)) t = t.slice(1);
  if (/\+$/.test(t)) t = t.slice(0, -1);
  if (/[-−]$/.test(t)) { neg = true; t = t.slice(0, -1); }           // "1.234,56-" (bazı bankalar)
  if (!/^[\d.,]+$/.test(t)) return null;
  const lastC = t.lastIndexOf(","), lastD = t.lastIndexOf(".");
  const sep = Math.max(lastC, lastD);
  let intPart = t, frac = "";
  if (sep >= 0 && t.length - sep - 1 <= 2 && t.length - sep - 1 >= 1 && /^\d+$/.test(t.slice(sep + 1))) {
    intPart = t.slice(0, sep); frac = t.slice(sep + 1);
  }
  intPart = intPart.replace(/[.,]/g, "");
  if (intPart === "" && frac === "") return null;
  const v = Number(`${intPart || "0"}.${frac || "0"}`);
  if (!Number.isFinite(v)) return null;
  return neg ? -v : v;
}

/** Satır bir başlık satırı mı? (tarih içermeyip "tarih/açıklama/tutar" gibi kelimeler taşıyor) */
const isHeader = (cells: string[]) =>
  cells.some((c) => /^(tarih|date|a[çc][ıi]klama|description|tutar|amount|i[şs]lem)/i.test(c.trim()));

/** Hücreleri ayır — tırnak içindeki ayırıcıyı bölmeyen basit CSV desteği */
function split(line: string, sep: string): string[] {
  if (sep === "space") return line.split(/ {2,}|\s\|\s/).map((c) => c.trim()).filter((c, i, a) => !(c === "" && (i === 0 || i === a.length - 1)));
  const ch = sep === "tab" ? "\t" : sep === "semi" ? ";" : ",";
  const out: string[] = [];
  let cur = "", q = false;
  for (const c of line) {
    if (c === '"') { q = !q; continue; }
    if (c === ch && !q) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Metnin tamamına bakıp en çok *kullanılabilir* satır (tarih + tutar hücresi olan) üreten ayırıcıyı seçer.
    Hücre sayısına bakmak yetmez: "-450,25" içindeki virgül CSV ayırıcısı sanılabilir. */
function pickSeparator(lines: string[]): string {
  let best = "space", bestScore = -1;
  for (const s of SEPARATORS) {
    if (!lines.some((l) => s.re.test(l))) continue;
    const score = lines.reduce((n, l) => {
      const cells = split(l, s.name).filter((c) => c !== "");
      const hasDate = cells.some((c) => parseDate(c) !== null);
      const hasAmt = cells.some((c) => parseDate(c) === null && parseAmount(c) !== null);
      return n + (cells.length >= 2 && hasDate && hasAmt ? 1 : 0);
    }, 0);
    if (score > bestScore) { bestScore = score; best = s.name; }
  }
  return best;
}

/**
 * Yapıştırılan metni satırlara çevirir. Sütun sırası sabit değildir:
 * her satırda ilk tarihe benzeyen hücre tarih, **son** sayıya benzeyen hücre tutar
 * (bakiye sütunu genelde en sağda olduğundan, iki sayı varsa soldaki tutar sayılır),
 * kalan en uzun metin hücresi açıklamadır.
 *
 * @param text     yapıştırılan ham metin
 * @param defaultSign gider olarak mı gelir olarak mı yorumlansın (işaretsiz tutarlar için)
 */
export function parseStatement(text: string, defaultSign: "gider" | "gelir" = "gider"): ParseResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  const rows: ParsedRow[] = [];
  const skipped: string[] = [];
  if (lines.length === 0) return { rows, skipped };
  const sep = pickSeparator(lines);
  /** iki sayısal hücre varsa ikincisi (en sağdaki) bakiye kabul edilir */
  const hasBalanceCol = lines.filter((l) => split(l, sep).filter((c) => parseAmount(c) !== null).length >= 3).length > lines.length / 2;
  let prevBalance: number | null = null; // bakiye sütunu varsa işaret bakiyenin yönünden çıkarılır
  for (const line of lines) {
    const cells = split(line, sep).filter((c) => c !== "");
    if (cells.length === 0) continue;
    if (isHeader(cells)) continue;
    const dateIdx = cells.findIndex((c) => parseDate(c) !== null);
    if (dateIdx < 0) { skipped.push(line); continue; }
    const date = parseDate(cells[dateIdx])!;
    const numIdx = cells.map((c, i) => (i !== dateIdx && parseAmount(c) !== null ? i : -1)).filter((i) => i >= 0);
    if (numIdx.length === 0) { skipped.push(line); continue; }
    // bakiye sütunu varsa sondan bir önceki sayı tutardır, yoksa sonuncusu
    const amtIdx = hasBalanceCol && numIdx.length >= 2 ? numIdx[numIdx.length - 2] : numIdx[numIdx.length - 1];
    const raw = cells[amtIdx];
    const parsed = parseAmount(raw)!;
    const explicitNeg = /[-−(]/.test(raw) || /[-−]$/.test(raw.trim()) || parsed < 0;
    const explicitPos = !explicitNeg && /^\s*\+|\+\s*$/.test(raw);
    /* İşaret önceliği: (1) tutarda açık +/−, (2) bakiye sütununun yönü, (3) kullanıcının seçtiği varsayılan */
    const balance = hasBalanceCol && numIdx.length >= 2 ? parseAmount(cells[numIdx[numIdx.length - 1]]) : null;
    const byBalance = balance != null && prevBalance != null && Math.abs(balance - prevBalance) > 1e-9
      ? balance > prevBalance : null;
    if (balance != null) prevBalance = balance;
    const positive = explicitNeg ? false : explicitPos ? true : byBalance ?? (defaultSign === "gelir");
    const amount = positive ? Math.abs(parsed) : -Math.abs(parsed);
    const name = cells
      .filter((_, i) => i !== dateIdx && i !== amtIdx)
      .filter((c) => parseAmount(c) === null && parseDate(c) === null)
      .sort((a, b) => b.length - a.length)[0] ?? "İşlem";
    if (amount === 0) { skipped.push(line); continue; }
    rows.push({ date, name: name.slice(0, 120), amount });
  }
  return { rows, skipped };
}
