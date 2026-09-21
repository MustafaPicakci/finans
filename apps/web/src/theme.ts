import type { CSSProperties } from "react";
import type { AssetType, Currency } from "@finans/engine";
import { isBalancesHidden, maskMoney } from "./privacy";

/**
 * Token sistemi: renkler CSS custom property olarak `themeCSS` içinde tanımlanır
 * (varsayılan = açık tema), `T`/`TYPE_COLORS`/`CATEGORY_PALETTE` bunlara `var(--x)`
 * referanslarıyla işaret eder — tema değişince (data-theme attribute) tüm bileşenler
 * otomatik güncellenir, hiçbir bileşen kodu tema bilmek zorunda kalmaz.
 */
/* Renk paleti Finans.dc.html tasarımından: sıcak nötr yüzeyler + mor marka.
   Değişken ADLARI (--type-*, --cat-*) korunur ki tüm bileşen kodu değişmeden çalışsın;
   yalnız değerler tasarımın --t-* skalasına güncellendi. */
export const themeCSS = `
  :root {
    --ground: #F4F3F0; --surface: #FFFFFF; --surface-2: #F4F3EF; --surface-3: #FBFAF8;
    --ink: #1B1A1E; --ink-2: #68666E; --ink-3: #9A98A0;
    --line: #E9E7E2; --line-2: #F1EFEA;
    --brand: #5B5BD6; --brand-ink: #FFFFFF; --brand-soft: #ECECFB; --brand-2: #7C6BE8;
    --pos: #12885E; --pos-soft: #E6F2EC;
    --neg: #C6453F; --neg-soft: #F8EAE8;
    --warn: #A9741A; --warn-soft: #F6EEDD;
    --type-nakit: #2f74c9; --type-fon: #178a52; --type-bist: #dd6a2e; --type-altin: #c9971f;
    --type-doviz: #5a4ec2; --type-kripto: #c26191; --type-etf: #1a9d86;
    --cat-1: #2f74c9; --cat-2: #1a9d86; --cat-3: #c9971f; --cat-4: #178a52;
    --cat-5: #5a4ec2; --cat-6: #d24b45; --cat-7: #c26191; --cat-8: #dd6a2e;
    --shadow: 0 2px 6px rgba(24,22,30,.05), 0 14px 34px -18px rgba(24,22,30,.22);
    --shadow-sm: 0 1px 2px rgba(24,22,30,.05);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ground: #0D0D11; --surface: #16161C; --surface-2: #1D1D25; --surface-3: #131319;
      --ink: #EDECF2; --ink-2: #9B99A6; --ink-3: #66646F;
      --line: #26262F; --line-2: #1E1E26;
      --brand: #8E8DF2; --brand-ink: #131228; --brand-soft: #20203A; --brand-2: #A08CF5;
      --pos: #3EBE86; --pos-soft: #12321F;
      --neg: #E8746C; --neg-soft: #37191A;
      --warn: #D9A84E; --warn-soft: #302610;
      --type-nakit: #4a8ee0; --type-fon: #2fa96a; --type-bist: #e07d43; --type-altin: #d4a835;
      --type-doviz: #8b7ff0; --type-kripto: #d67aa6; --type-etf: #33b39a;
      --cat-1: #4a8ee0; --cat-2: #33b39a; --cat-3: #d4a835; --cat-4: #2fa96a;
      --cat-5: #8b7ff0; --cat-6: #e8746c; --cat-7: #d67aa6; --cat-8: #e07d43;
      --shadow: 0 2px 6px rgba(0,0,0,.4), 0 16px 40px -18px rgba(0,0,0,.6);
      --shadow-sm: 0 1px 2px rgba(0,0,0,.4);
    }
  }
  :root[data-theme="light"] {
    --ground: #F4F3F0; --surface: #FFFFFF; --surface-2: #F4F3EF; --surface-3: #FBFAF8;
    --ink: #1B1A1E; --ink-2: #68666E; --ink-3: #9A98A0;
    --line: #E9E7E2; --line-2: #F1EFEA;
    --brand: #5B5BD6; --brand-ink: #FFFFFF; --brand-soft: #ECECFB; --brand-2: #7C6BE8;
    --pos: #12885E; --pos-soft: #E6F2EC;
    --neg: #C6453F; --neg-soft: #F8EAE8;
    --warn: #A9741A; --warn-soft: #F6EEDD;
    --type-nakit: #2f74c9; --type-fon: #178a52; --type-bist: #dd6a2e; --type-altin: #c9971f;
    --type-doviz: #5a4ec2; --type-kripto: #c26191; --type-etf: #1a9d86;
    --cat-1: #2f74c9; --cat-2: #1a9d86; --cat-3: #c9971f; --cat-4: #178a52;
    --cat-5: #5a4ec2; --cat-6: #d24b45; --cat-7: #c26191; --cat-8: #dd6a2e;
    --shadow: 0 2px 6px rgba(24,22,30,.05), 0 14px 34px -18px rgba(24,22,30,.22);
    --shadow-sm: 0 1px 2px rgba(24,22,30,.05);
  }
  :root[data-theme="dark"] {
    --ground: #0D0D11; --surface: #16161C; --surface-2: #1D1D25; --surface-3: #131319;
    --ink: #EDECF2; --ink-2: #9B99A6; --ink-3: #66646F;
    --line: #26262F; --line-2: #1E1E26;
    --brand: #8E8DF2; --brand-ink: #131228; --brand-soft: #20203A; --brand-2: #A08CF5;
    --pos: #3EBE86; --pos-soft: #12321F;
    --neg: #E8746C; --neg-soft: #37191A;
    --warn: #D9A84E; --warn-soft: #302610;
    --type-nakit: #4a8ee0; --type-fon: #2fa96a; --type-bist: #e07d43; --type-altin: #d4a835;
    --type-doviz: #8b7ff0; --type-kripto: #d67aa6; --type-etf: #33b39a;
    --cat-1: #4a8ee0; --cat-2: #33b39a; --cat-3: #d4a835; --cat-4: #2fa96a;
    --cat-5: #8b7ff0; --cat-6: #e8746c; --cat-7: #d67aa6; --cat-8: #e07d43;
    --shadow: 0 2px 6px rgba(0,0,0,.4), 0 16px 40px -18px rgba(0,0,0,.6);
    --shadow-sm: 0 1px 2px rgba(0,0,0,.4);
  }
`;

export type ThemeMode = "light" | "dark";
export const THEME_KEY = "finans-theme";
export const CCY_KEY = "finans-ccy"; // görüntü para birimi (TRY/USD) localStorage anahtarı

/* ————— tasarım jetonları ————— */
export const T = {
  bg: "var(--ground)", panel: "var(--surface)", panel2: "var(--surface-2)", panel3: "var(--surface-3)", line: "var(--line)", line2: "var(--line-2)",
  text: "var(--ink)", mut: "var(--ink-2)", mut3: "var(--ink-3)",
  pos: "var(--pos)", posSoft: "var(--pos-soft)", neg: "var(--neg)", negSoft: "var(--neg-soft)",
  warn: "var(--warn)", warnSoft: "var(--warn-soft)",
  acc: "var(--brand)", accInk: "var(--brand-ink)", accSoft: "var(--brand-soft)", acc2: "var(--brand-2)",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
  disp: "'Schibsted Grotesk', system-ui, sans-serif",
};
export const TYPE_COLORS: Record<string, string> = {
  Nakit: "var(--type-nakit)", BIST: "var(--type-bist)", FON: "var(--type-fon)", ALTIN: "var(--type-altin)",
  DOVIZ: "var(--type-doviz)", KRIPTO: "var(--type-kripto)", ETF: "var(--type-etf)", Vadeli: "var(--cat-5)",
};
export const TYPE_HINT: Record<AssetType, string> = {
  BIST: "THYAO, ASELS…", FON: "TEFAS kodu: AFT…", ALTIN: "GRAM, CEYREK, ONS, GUMUS",
  DOVIZ: "USD, EUR, GBP", KRIPTO: "BTC, ETH", ETF: "VOO, QQQ, VTI… (ABD/global borsa)",
};
/** Kategoriler için sabit sıralı kategorik palet (dataviz becerisiyle açık+koyu yüzeye karşı doğrulanmış); id sırasına göre atanır, 9. kategoriden itibaren döngüye girer */
export const CATEGORY_PALETTE = [
  "var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)",
  "var(--cat-5)", "var(--cat-6)", "var(--cat-7)", "var(--cat-8)",
];

const rawTl = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });
const rawTl2 = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2 });
const rawUsd = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const rawUsd2 = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const maybeMask = (s: string) => (isBalancesHidden() ? maskMoney(s) : s);

/* tl/tl2 gizlilik moduna duyarlı: her `.format()` çağrısı, mod açıkken tutarı maskeler —
   böylece tüm çağrı yerleri (38+) ek değişiklik olmadan otomatik gizlenir. */
export const tl = { format: (v: number) => maybeMask(rawTl.format(v)) };
export const tl2 = { format: (v: number) => maybeMask(rawTl2.format(v)) };

/** Para birimine göre biçimler; `dec` iki ondalık ister, `raw` gizlilik maskesini atlar
    (örn. kullanıcının o an yazdığı tutar önizlemesi). ccy verilmezse TRY. */
export const fmtMoney = (v: number, ccy: Currency = "TRY", dec = false, raw = false) => {
  const s = ccy === "USD" ? (dec ? rawUsd2 : rawUsd).format(v) : (dec ? rawTl2 : rawTl).format(v);
  return raw ? s : maybeMask(s);
};

/**
 * Yüzde biçimleyici. İşaret `%`'in ÖNÜNE yazılır.
 *
 * Bunun kuralı olması gerekiyordu: çağrı yerleri `{v > 0 ? "+" : ""}%{(x*100).toFixed(1)}`
 * diye elle kuruyordu ve negatif değerde `toFixed` kendi eksisini getirip ortaya **"%-12,5"**
 * çıkıyordu — Türkçede yanlış, üstelik pozitifte "+%6,8" yazıp negatifte biçim değiştirmek
 * iki rakamı görsel olarak kıyaslanamaz kılıyordu.
 *
 * @param x oran mı yüzde mi olduğunu `zatenYuzde` söyler (0,068 → %6,8 | 6,8 → %6,8)
 */
export const fmtPct = (x: number, dec = 1, zatenYuzde = false) => {
  const v = zatenYuzde ? x : x * 100;
  const isaret = v > 0 ? "+" : v < 0 ? "−" : ""; // U+2212: eksi, tire değil (rakamla aynı genişlik)
  return `${isaret}%${Math.abs(v).toFixed(dec).replace(".", ",")}`;
};

/**
 * PAY yüzdesi (ağırlık / dağılım): `fmtPct`'ten farkı **işaretsiz** olmasıdır. Bir payın
 * "+%38,2" yazılması artış sanılır — oysa o bir değişim değil, bütünün içindeki paydır
 * ve hiçbir zaman negatif olmaz. Dört çağrı yeri bunu elle kuruyordu (üç farklı ondalıkla,
 * biri Türkçe virgülü unutarak); yeni pay gösteren her yer bu fonksiyonu çağırsın.
 */
export const fmtPay = (x: number, dec = 1) => `%${(x * 100).toFixed(dec).replace(".", ",")}`;

/**
 * `prices.updated_at`'in yaşı — "az önce" / "12 dk önce" / "3 sa önce" / "2 gün önce".
 *
 * **İki damga da SUNUCUNUN saatindendir ve bu şart**: `updated_at` timezone taşımayan bir
 * duvar saati damgası (`nowLocal()`), tarayıcının saatiyle karşılaştırılamaz — sunucu
 * (Render) UTC'de, kullanıcı UTC+3'te olduğundan yeni çekilmiş bir fiyat "3 sa önce"
 * görünürdü. Aynı saatten iki damganın FARKI zonedan bağımsız doğrudur, bu yüzden `now`
 * `/api/all`'dan gelir. Gelmiyorsa (eski sunucu / PWA önbelleği) **null** dönülür: yaşı
 * tarayıcı saatinden uydurmak, yanlış bir rakamı doğru gibi göstermek olurdu.
 *
 * Ölçtüğü şey fiyatın DEĞİL, son başarılı ÇEKİMİN yaşıdır — bkz. `FIYAT_YASI_IPUCU`.
 */
export function fiyatYasi(updated: string | null | undefined, now: string | null | undefined): string | null {
  if (!updated || !now) return null;
  /* "YYYY-MM-DD HH:MM:SS" → ikisi de aynı şekilde ayrıştırılır; mutlak değer değil FARK
     kullanıldığı için tarayıcının hangi zonede olduğu sonucu etkilemez. */
  const ms = (v: string) => Date.parse(v.replace(" ", "T"));
  const d = ms(now) - ms(updated);
  if (!isFinite(d)) return null;
  if (d < 0) return "az önce"; // sunucu saati damgadan geri (saat düzeltmesi) — negatif yaş yazma
  const dk = Math.floor(d / 60_000);
  if (dk < 2) return "az önce";
  if (dk < 60) return `${dk} dk önce`;
  const sa = Math.floor(dk / 60);
  if (sa < 24) return `${sa} sa önce`;
  return `${Math.floor(sa / 24)} gün önce`;
}

/** Yaş rozetlerinin tooltip'i. Ayrım kasıtlı: `updated_at` fiyatın oluştuğu an değil, bizim
    onu son kez başarıyla ÇEKTİĞİMİZ andır. Yahoo piyasa kapalıyken de son kapanışı döndürür,
    yani pazar günü çekilen bir BIST fiyatı "2 dk önce" görünür ama cuma kapanışıdır. Rakamın
    dürüstçe söylediği şey: fiyat boru hattı çalışıyor mu (cron öldü mü, sunucu uyudu mu). */
export const FIYAT_YASI_IPUCU =
  "Fiyatın son çekildiği an. BIST verisi ~15 dk gecikmelidir ve piyasa kapalıyken son kapanış çekilir; fon (TEFAS) fiyatı günde bir hesaplanır.";

export const css: Record<string, CSSProperties> = {
  /* boxSizing BURADA olmak zorunda: uygulamanın içindeki kartlar genişlik VERMEDEN kullanılır
     (blok öğe, genişlik auto → padding zaten içeride kalır) ama `width:"100%"` verilen iki yerde
     — giriş ekranı kartı ve Modal — içerik kutusuna 22×2 padding + 1×2 kenarlık EKLENİYORDU:
     390px telefonda 358px'lik yuvaya 404px'lik kart çiziliyor, sağ kenarı ekranın dışında
     kalıyordu. width:auto iken border-box'ın hiçbir etkisi yok, yani bu düzeltme başka
     hiçbir kartı kıpırdatmaz. */
  card: { background: T.panel, border: `1px solid ${T.line}`, borderRadius: 20, padding: 22, boxSizing: "border-box", boxShadow: "var(--shadow-sm)" },
  label: { fontSize: 11.5, color: T.mut, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6, fontWeight: 600 },
  input: {
    width: "100%", boxSizing: "border-box", background: T.panel2, border: `1px solid ${T.line}`,
    borderRadius: 10, color: T.text, padding: "10px 12px", fontSize: 14, fontFamily: T.mono, outline: "none",
    transition: "border-color .15s, box-shadow .15s",
  },
  btn: {
    background: T.acc, color: T.accInk, border: "none", borderRadius: 10, padding: "11px 18px",
    fontWeight: 640, fontSize: 13, cursor: "pointer", fontFamily: T.disp, transition: "filter .15s, transform .05s",
  },
  ghost: {
    background: T.panel2, color: T.mut, border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 14px",
    fontWeight: 500, fontSize: 13, cursor: "pointer", fontFamily: T.disp,
  },
  del: { background: "none", border: "none", color: T.mut3, cursor: "pointer", fontSize: 16, padding: 4, borderRadius: 8 },
  /** Satır içi "düzenle" düğmesi — sil (✕) düğmesinin yanında, aynı ağırlıkta durur (Faz 14) */
  edit: { background: "none", border: "none", color: T.mut3, cursor: "pointer", fontSize: 14, padding: 4, borderRadius: 8 },
  /** Küçük tek-tık kısayol düğmesi (şablon çipleri, "güncel fiyat", "tümünü sat") */
  chip: {
    background: T.panel2, color: T.text, border: `1px solid ${T.line}`, borderRadius: 999, padding: "6px 12px",
    fontWeight: 560, fontSize: 12, cursor: "pointer", fontFamily: T.disp, whiteSpace: "nowrap",
  },
  mono: { fontFamily: T.mono, fontVariantNumeric: "tabular-nums" },
};
