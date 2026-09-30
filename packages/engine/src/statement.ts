/* ————— EKSTRE / TABLO YAPIŞTIRMA AYRIŞTIRICISI —————
   Banka ekstresinden, Excel'den ya da aracı kurum ekranından kopyalanan satırları
   `ParsedRow`'a çevirir. Tek satırlık bir "format" yoktur; bu yüzden sezgisel çalışır:
   sütun ayırıcı ve tarih/tutar sütunları satırların çoğunluğuna bakılarak seçilir.
   **Bankaya özel kural YOKTUR ve olmamalı** (kullanıcı kararı, Faz 45.3): banka şablonu,
   tasarım her değiştiğinde sessizce bozulan bir bakım işidir. Gerçek belgelerden öğrenilen
   şey bir bankanın düzeni değil, bir durum TÜRÜdür (ay adıyla tarih, iki satıra bölünen kayıt,
   ödemeyi "+" ile yazan kart ekstresi…) ve kural o türe yazılır.
   Saf fonksiyon — ağ/DOM yok, testlerle korunur. */

import { metinSadelestir } from "./kayitlar.js";

/** Ayrıştırılmış tek satır. `amount` işaretlidir: gider −, gelir +. */
export type ParsedRow = { date: string; name: string; amount: number };

/** Bakiye zincirinde iki ardışık satırın arasında açıklanamayan fark: `eksik`, arada okunamamış
    satırların işaretli toplamıdır (gider −, gelir +). */
export type Kopukluk = { once: string; sonra: string; eksik: number };

/** Belgenin kendi rakamlarıyla doğrulama (Faz 45.3). Okunan satırlar belgeyi eksiksiz açıklıyor
    mu? Dayanak yoksa `yok` — doğrulama uydurulmaz (ör. "önceki dönem" satırı okunamadıysa 0
    varsayılmaz: yanlış alarm, hiç alarm olmamasından kötüdür).
    - `bakiye`: hesap dökümünün bakiye sütunu satır satır zincirlenir.
    - `donem`: kart ekstresinde önceki dönem + harcamalar − ödemeler = dönem borcu
      (BDDK'nın zorunlu kıldığı ekstre dili; bankadan bağımsız). */
export type Dogrulama =
  | { tur: "bakiye"; tamam: boolean; kopukluklar: Kopukluk[] }
  | { tur: "donem"; tamam: boolean; belge: number; okunan: number }
  | { tur: "yok" };

/** `bozukHarf`: belgenin yazı tipi harf eşlemesi taşımıyor ve Türkçe harfler başka işaretlere
    dönüşmüş ("%deme - Tesekk!r", "D#nem"). Rakamlar etkilenmez (ASCII), adlar etkilenir. Geri
    çevrilmez — eşleme yazı tipine özeldir, yani bankaya bağımlılığın ta kendisi olurdu; arayüz
    "adları kontrol et" der. */
export type ParseResult = { rows: ParsedRow[]; skipped: string[]; dogrulama: Dogrulama; bozukHarf: boolean };

/** Harf arasına sıkışmış işaret, kelime başında yüzde/diyez ya da denetim karakteri: çözülememiş
    yazı tipi izi. Tek bir "AT&T" yanlış alarm vermesin diye belgede en az 3 iz aranır. */
const BOZUK_IZ = /[\u0000-\u0008\u000B-\u001F]|[A-Za-zÇĞİÖŞÜçğıöşü][#!$%&][A-Za-zÇĞİÖŞÜçğıöşü]|(?:^|\s)[#$%][A-Za-zçğıöşü]/g;
const bozukHarfMi = (metin: string) => (metin.match(BOZUK_IZ)?.length ?? 0) >= 3;

/** Sütun ayırıcı adayları — sekme (Excel/tablo kopyası), noktalı virgül (TR CSV), virgül (CSV), 2+ boşluk */
const SEPARATORS: { re: RegExp; name: string }[] = [
  { re: /\t/, name: "tab" },
  { re: /;/, name: "semi" },
  { re: /,/, name: "comma" },
  { re: / {2,}|\s\|\s/, name: "space" },
];

const AYLAR = ["ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik"];

/** "Ağustos", "EYLÜL", "Şub.", "Ara" → ay numarası. En az 3 harf şart ("Ma" Mart mı Mayıs mı?). */
function ayNo(s: string): number | null {
  const t = metinSadelestir(s.replace(/\.$/, ""));
  if (t.length < 3) return null;
  const i = AYLAR.findIndex((a) => a.startsWith(t));
  return i < 0 ? null : i + 1;
}

/** "12.03.2026", "12/03/2026", "2026-03-12", "12.03.26", "30 Ağustos 2026", "14 Eylül 2026, Pazartesi"
    → "2026-03-12" (yoksa null). Hücrenin TAMAMI tarih olmalı: düzyazının içindeki tarih kayıt açmaz. */
export function parseDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(t);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})$/.exec(t);
  if (m) {
    const y = +m[3];
    return iso(y < 100 ? 2000 + y : y, +m[2], +m[1]); // TR: gün.ay.yıl
  }
  // ay adıyla: kart ekstrelerinde yaygın; sonda haftanın günü olabilir
  m = /^(\d{1,2})\s+([^\d\s,]+)\s+(\d{4})(?:,?\s+[^\d\s]+)?$/.exec(t);
  if (m) {
    const ay = ayNo(m[2]);
    return ay ? iso(+m[3], ay, +m[1]) : null;
  }
  return null;
}
const iso = (y: number, mo: number, d: number): string | null => {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2999) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

/** Tutar + belgede AÇIKÇA yazılmış işaret ("+"/"−"/parantez), yoksa null. İşaret ayrıca döner
    çünkü anlamı belgeye göre değişir (kart ekstresinde "+" ödeme demek olabilir). */
function tutarOku(s: string): { v: number; isaret: "+" | "-" | null } | null {
  let t = s.trim().replace(/\s| /g, "").replace(/(TL|TRY|₺|USD|\$)/gi, "");
  if (t === "") return null;
  let isaret: "+" | "-" | null = null;
  const son = /\(([-−+])\)$/.exec(t);                                  // "19.394,54(-)" (bazı bankalar)
  if (son) { isaret = son[1] === "+" ? "+" : "-"; t = t.slice(0, -3); }
  if (/^\(.*\)$/.test(t)) { isaret = "-"; t = t.slice(1, -1); }       // (1.234,56) = negatif
  if (/^[-−]/.test(t)) { isaret = "-"; t = t.slice(1); }
  if (/^\+/.test(t)) { isaret = "+"; t = t.slice(1); }
  if (/\+$/.test(t)) { isaret = "+"; t = t.slice(0, -1); }
  if (/[-−]$/.test(t)) { isaret = "-"; t = t.slice(0, -1); }           // "1.234,56-" (bazı bankalar)
  if (!/^[\d.,]+$/.test(t) || !/\d/.test(t)) return null;
  const v = sayiCoz(t);
  if (v == null) return null;
  return { v: isaret === "-" ? -v : v, isaret };
}

/** Yalnız rakam ve `.`/`,` içeren metni sayıya çevirir. Binlik ayırıcının grupları HER ZAMAN 3
    hanedir — bu kural olmadan "4,17552660" 417 milyon, "10.02.2026" (bir tarih) bir tutar
    okunuyordu (Faz 45.3, gerçek belgelerde bulundu).
    - İki tür ayırıcı varsa sondaki ondalıktır ("1.234,56", "5,000.00").
    - Tek tür ayırıcı birden çok kez geçiyorsa binliktir ("1.234.567").
    - Tek bir ayırıcı: sağında tam 3 hane varsa binlik ("1.234" — belirsiz, TR alışkanlığı), yoksa ondalık. */
function sayiCoz(t: string): number | null {
  const son = Math.max(t.lastIndexOf(","), t.lastIndexOf("."));
  if (son < 0) return Number(t);
  const sepSon = t[son];
  const digeri = sepSon === "," ? "." : ",";
  let tam: string, kesir = "";
  if (t.includes(digeri)) {
    if (t.indexOf(digeri) > son) return null;
    tam = t.slice(0, son); kesir = t.slice(son + 1);
    if (tam.includes(sepSon)) return null;                              // "1,234.567,89" gibi karışık
  } else if (t.indexOf(sepSon) !== son) {
    tam = t;                                                            // yalnız binlik
  } else if (t.length - son - 1 === 3 && son > 0) {
    tam = t;                                                            // "1.234"
  } else {
    tam = t.slice(0, son); kesir = t.slice(son + 1);
  }
  if (kesir !== "" && !/^\d+$/.test(kesir)) return null;
  const gruplar = tam.split(/[.,]/);
  if (gruplar.length > 1 && (!/^\d{1,3}$/.test(gruplar[0]) || gruplar.slice(1).some((g) => !/^\d{3}$/.test(g)))) return null;
  const v = Number(`${gruplar.join("") || "0"}.${kesir || "0"}`);
  return Number.isFinite(v) ? v : null;
}

/** "1.234,56" / "1,234.56" / "-1234" / "1.234,56 TL" / "(1.234,56)" / "19.394,54(-)" → sayı (yoksa null). */
export function parseAmount(s: string): number | null {
  return tutarOku(s)?.v ?? null;
}

/** Satır bir başlık satırı mı? ("tarih/açıklama/tutar" gibi kelimeler taşıyor). Yalnız tarihsiz
    satırlara bakılır: "ISLEM UCRETI" adlı gerçek bir kayıt başlık sanılıp atlanmasın. */
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

const tarihMi = (c: string) => parseDate(c) !== null;
const tutarMi = (c: string) => !tarihMi(c) && parseAmount(c) !== null;

/** Metnin tamamına bakıp en çok *kullanılabilir* satır (tarih + tutar hücresi olan) üreten ayırıcıyı seçer.
    Hücre sayısına bakmak yetmez: "-450,25" içindeki virgül CSV ayırıcısı sanılabilir. */
function pickSeparator(lines: string[]): string {
  let best = "space", bestScore = -1;
  for (const s of SEPARATORS) {
    if (!lines.some((l) => s.re.test(l))) continue;
    const score = lines.reduce((n, l) => {
      const cells = split(l, s.name).filter((c) => c !== "");
      return n + (cells.length >= 2 && cells.some(tarihMi) && cells.some(tutarMi) ? 1 : 0);
    }, 0);
    if (score > bestScore) { bestScore = score; best = s.name; }
  }
  return best;
}

/** Bakiye zinciri: satırlar belgedeki sırayla (yeniden eskiye ya da eskiden yeniye). Sıra,
    hangi yönün daha çok çifti açıkladığına bakılarak seçilir. */
function bakiyeZinciri(satirlar: { date: string; amount: number; bakiye: number }[]): Dogrulama {
  if (satirlar.length < 2) return { tur: "yok" };
  const esit = (a: number, b: number) => Math.abs(a - b) < 0.005;
  let yeniden = 0, eskiden = 0;
  for (let i = 0; i + 1 < satirlar.length; i++) {
    const r = satirlar[i], s = satirlar[i + 1];
    if (esit(r.bakiye - r.amount, s.bakiye)) yeniden++;
    if (esit(r.bakiye + s.amount, s.bakiye)) eskiden++;
  }
  const kopukluklar: Kopukluk[] = [];
  for (let i = 0; i + 1 < satirlar.length; i++) {
    const r = satirlar[i], s = satirlar[i + 1];
    // arada okunamamış satırların toplamı; yeniden eskiye: r.bakiye − r.tutar = arada + s.bakiye
    const eksik = yeniden >= eskiden ? r.bakiye - r.amount - s.bakiye : s.bakiye - s.amount - r.bakiye;
    if (!esit(eksik, 0)) kopukluklar.push({ once: r.date, sonra: s.date, eksik: Math.round(eksik * 100) / 100 });
  }
  return { tur: "bakiye", tamam: kopukluklar.length === 0, kopukluklar };
}

/** Tarihsiz bir satırda anahtar sözcük + sayı: kart ekstresinin üstbilgisindeki "Dönem Borcu" gibi. */
function etiketliTutar(satirlar: string[][], re: RegExp, haric?: RegExp): number | null {
  for (const cells of satirlar) {
    if (cells.some(tarihMi)) continue;
    const metin = metinSadelestir(cells.join(" "));
    if (!re.test(metin) || (haric && haric.test(metin))) continue;
    const sayilar = cells.filter(tutarMi);
    if (sayilar.length) return Math.abs(parseAmount(sayilar[sayilar.length - 1])!);
  }
  return null;
}

/**
 * Yapıştırılan metni satırlara çevirir. Sütun sırası sabit değildir:
 * her satırda ilk tarihe benzeyen hücre tarih, **son** sayıya benzeyen hücre tutar
 * (bakiye sütunu genelde en sağda olduğundan, iki sayı varsa soldaki tutar sayılır),
 * kalan en uzun metin hücresi açıklamadır.
 *
 * @param text     yapıştırılan ham metin
 * @param tur      işaretsiz tutar gider mi gelir mi sayılsın — ya da `kart`: belge bir kredi
 *                 kartı ekstresidir. Kartta işaretsiz satır HARCAMADIR ve işaretli satır ("+" ya
 *                 da "−", hangisi olursa) ödeme/iadedir; bankalar ödemeyi iki işaretle de yazıyor
 *                 (gerçek belgelerde ikisi de görüldü). Her satır işaretliyse çoğunluk harcamadır.
 *                 Çıktı her durumda hesap dilindedir: harcama −, ödeme +.
 */
export function parseStatement(text: string, tur: "gider" | "gelir" | "kart" = "gider"): ParseResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  const rows: ParsedRow[] = [];
  const skipped: string[] = [];
  if (lines.length === 0) return { rows, skipped, dogrulama: { tur: "yok" }, bozukHarf: false };
  const kart = tur === "kart";
  const sep = pickSeparator(lines);
  const hucreler = lines.map((l) => split(l, sep).filter((c) => c !== ""));
  /* Bakiye sütunu: kayıt satırlarının (tarih + tutar) çoğunda iki ya da daha çok sayı varsa en
     sağdaki bakiyedir. Kart ekstresinde bakiye sütunu yoktur; oradaki ikinci sayı puan ya da
     döviz tutarıdır ve tutar her zaman en sağdakidir. */
  const kayitlar = hucreler.filter((c) => c.some(tarihMi) && c.some(tutarMi));
  const hasBalanceCol = !kart && kayitlar.filter((c) => c.filter(tutarMi).length >= 2).length > kayitlar.length / 2;

  /* İki satıra bölünen kayıt (Faz 45.3): açıklama iki satıra taşınca PDF tarihi ve tutarı ayrı
     satırlara çizer. Tarihli ama tutarsız satır, KOMŞUSUNDAKİ tarihsiz "tutar + bakiye" parçasıyla
     birleşir (önce üstteki, sonra alttaki). Yalnız bakiye sütunlu belgede yapılır: orada parçanın
     biçimi (en az iki sayı) belirgindir ve sonucu bakiye zinciri denetler. Bakiyesiz belgede
     "Nakit Avans Limiti 25.000" + "Hesap Kesim Tarihi 27 Eylül" gibi üstbilgiler kayda dönüşürdü. */
  const tuketildi = new Set<number>();
  if (hasBalanceCol) {
    const parca = (i: number) => i >= 0 && i < hucreler.length && !tuketildi.has(i)
      && !hucreler[i].some(tarihMi) && hucreler[i].filter(tutarMi).length >= 2;
    for (let i = 0; i < hucreler.length; i++) {
      const c = hucreler[i];
      if (!c.some(tarihMi) || c.some(tutarMi)) continue;
      const j = parca(i - 1) ? i - 1 : parca(i + 1) ? i + 1 : -1;
      if (j < 0) continue;
      /* Okuma sırası: tarih, parçanın metni (açıklamanın üst satırıdır), tarih satırının kalan
         metni, en sonda sayılar — ad, bölünmemiş satırlardakiyle aynı sırada kurulsun. */
      const f = hucreler[j];
      hucreler[i] = [...c.filter(tarihMi), ...f.filter((x) => !tutarMi(x)), ...c.filter((x) => !tarihMi(x)), ...f.filter(tutarMi)];
      tuketildi.add(j);
    }
  }

  let prevBalance: number | null = null; // bakiye sütunu varsa işaret bakiyenin yönünden çıkarılır
  const zincir: { date: string; amount: number; bakiye: number }[] = [];
  /* İşareti belirsiz satırlar (açık +/− yok, bakiyeden de çıkmıyor) sona bırakılır: belge işaret
     kullanıyorsa onun dilinde karar verilir (aşağıda). */
  const belirsiz: ParsedRow[] = [];
  const isaretli: { row: ParsedRow; isaret: "+" | "-" }[] = [];
  let eksiVar = false, artiVar = false;
  for (let li = 0; li < lines.length; li++) {
    if (tuketildi.has(li)) continue;
    const line = lines[li];
    const cells = hucreler[li];
    if (cells.length === 0) continue;
    const dateIdx = cells.findIndex(tarihMi);
    if (dateIdx < 0) { if (!isHeader(cells)) skipped.push(line); continue; }
    const date = parseDate(cells[dateIdx])!;
    const numIdx = cells.map((c, i) => (i !== dateIdx && tutarMi(c) ? i : -1)).filter((i) => i >= 0);
    if (numIdx.length === 0) { skipped.push(line); continue; }
    // bakiye sütunu varsa sondan bir önceki sayı tutardır, yoksa sonuncusu
    const amtIdx = hasBalanceCol && numIdx.length >= 2 ? numIdx[numIdx.length - 2] : numIdx[numIdx.length - 1];
    const okunan = tutarOku(cells[amtIdx])!;
    const parsed = okunan.v;
    /* İşaret önceliği: (1) tutarda açık +/−, (2) bakiye sütununun yönü, (3) belgenin işaret dili, (4) varsayılan */
    const balance = hasBalanceCol && numIdx.length >= 2 ? parseAmount(cells[numIdx[numIdx.length - 1]]) : null;
    const byBalance = balance != null && prevBalance != null && Math.abs(balance - prevBalance) > 1e-9
      ? balance > prevBalance : null;
    if (balance != null) prevBalance = balance;
    /* Ad: tarih ile tutar ARASINDAKİ metin hücreleri sırasıyla birleşir — PDF aynı açıklamayı geniş
       bir boşlukla iki hücreye bölebiliyor ("IYZICO" + "*AMAZON.COM.T"; yalnız en uzununu almak
       adın yarısını düşürüyordu). Arada metin yoksa (sütun sırası farklı) en uzun metin hücresi. */
    const metinMi = (c: string, i: number) => i !== dateIdx && i !== amtIdx && parseAmount(c) === null && !tarihMi(c);
    const [bas, son] = dateIdx < amtIdx ? [dateIdx, amtIdx] : [amtIdx, dateIdx];
    const arada = cells.filter((c, i) => i > bas && i < son && metinMi(c, i));
    const name = (arada.length ? arada.join(" ")
      : cells.filter(metinMi).sort((a, b) => b.length - a.length)[0]) ?? "İşlem";
    if (parsed === 0) { skipped.push(line); continue; }
    const row = { date, name: name.slice(0, 120), amount: Math.abs(parsed) };
    rows.push(row);
    if (balance != null) zincir.push({ date, amount: 0, bakiye: balance });
    if (kart) {
      // kartın işaret dili aşağıda, bütün satırlar görüldükten sonra çözülür
      if (okunan.isaret) isaretli.push({ row, isaret: okunan.isaret }); else row.amount = -row.amount;
      continue;
    }
    if (okunan.isaret === "-") eksiVar = true;
    if (okunan.isaret === "+") artiVar = true;
    const positive = okunan.isaret === "-" ? false : okunan.isaret === "+" ? true : byBalance;
    if (positive === false) row.amount = -row.amount;
    if (positive === null) belirsiz.push(row);
  }
  if (kart) {
    /* İşaretsiz satır varsa işaretli olan onun tersidir (ödeme/iade), hangi işaretle yazılmış
       olursa olsun. Hepsi işaretliyse az olan işaret ödemedir; eşitlikte "−" ödeme sayılır
       (kart ekstresinin özet tablosu alacakları eksiyle yazar). */
    const isaretsizVar = rows.length > isaretli.length;
    const artiSay = isaretli.filter((x) => x.isaret === "+").length;
    const eksiSay = isaretli.length - artiSay;
    const odemeIsareti = isaretsizVar ? null : artiSay < eksiSay ? "+" : "-";
    for (const { row, isaret } of isaretli) {
      row.amount = odemeIsareti == null || isaret === odemeIsareti ? Math.abs(row.amount) : -Math.abs(row.amount);
    }
  } else {
    /* Belirsiz satırın işareti: belgede YALNIZ eksi işareti kullanılıyorsa işaretsiz olan artıdır
       (ör. hesap dökümü: harcamalar "-450,25", iade/ödeme "5.000,00"); yalnız artı kullanılıyorsa
       eksidir. Belge hiç işaret kullanmıyorsa (ya da ikisini birden) karar kullanıcının seçtiği
       varsayılandır. Önceden varsayılan her zaman uygulanıyordu ve işaretli bir belgedeki ödeme
       satırı harcama gibi eksi okunuyordu (testli). */
    const artiSay = eksiVar && !artiVar ? true : artiVar && !eksiVar ? false : tur === "gelir";
    for (const r of belirsiz) r.amount = artiSay ? Math.abs(r.amount) : -Math.abs(r.amount);
  }

  let dogrulama: Dogrulama = { tur: "yok" };
  if (hasBalanceCol && zincir.length === rows.length) {
    rows.forEach((r, i) => { zincir[i].amount = r.amount; });
    dogrulama = bakiyeZinciri(zincir);
  } else if (kart) {
    const belge = etiketliTutar(hucreler, /donem borcu/);
    const onceki = etiketliTutar(hucreler, /onceki donem|devir/, /donem borcu/);
    if (belge != null && onceki != null) {
      const okunan = Math.round((onceki - rows.reduce((s, r) => s + r.amount, 0)) * 100) / 100;
      dogrulama = { tur: "donem", tamam: Math.abs(okunan - belge) < 0.005, belge, okunan };
    }
  }
  return { rows, skipped, dogrulama, bozukHarf: bozukHarfMi(text) };
}
