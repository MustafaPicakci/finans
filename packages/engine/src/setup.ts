import type { AllData } from "./types.js";
import { positions } from "./portfolio.js";
import { accountKindOf, reconStatus } from "./accounts.js";
import { cashFundSymbols } from "./funds.js";

/* ————— Kurulum eksikleri —————
   Faz 16/17'de eklenen yetenekler (hesap türleri, mutabakat, "nakit sayılan fon") opt-in'dir:
   kullanıcı kurmazsa sessizce ATIL kalırlar — ve uygulama bunu hiçbir yerde söylemediği için
   kullanıcı özelliğin var olduğunu bile bilmez. Burası o boşluğu tespit eder: yalnız
   VERİSİ o özelliğe ihtiyaç duyduğunu gösteren kullanıcıya çıkar (portföy işlemi olmayana
   "aracı kurum hesabı aç" denmez). Saf fonksiyon — arayüz yalnız sonucunu gösterir. */

export type SetupGapKey = "nakit-hesap" | "araci-hesap" | "mutabakat" | "nakit-fon";
export type SetupGap = {
  key: SetupGapKey;
  /** Ne eksik */
  title: string;
  /** Neden önemli — eksikken hangi rakam yanlış görünüyor */
  detail: string;
  /** Kullanıcının çözmek için gideceği sekme */
  tab: "hesaplar" | "portfoy";
  action: string;
};

export function setupGaps(data: AllData, today: string): SetupGap[] {
  const gaps: SetupGap[] = [];
  if (!data.accounts.length) return gaps; // hiç hesap yoksa asıl eksik o; onboarding'in işi

  const kinds = new Set(data.accounts.map(accountKindOf));
  if (!kinds.has("nakit")) {
    gaps.push({
      key: "nakit-hesap", tab: "hesaplar", action: "Nakit hesabı aç",
      title: "Nakit cüzdanın tanımlı değil",
      detail: "ATM'den çektiğin para şu an sistemden çıkmış (gider) görünüyor. Nakit türünde bir hesap açarsan çekim virman olur, net varlığın değişmez.",
    });
  }
  /* Aracı kurum hesabı yalnız portföyü OLANA önerilir; hisse/fon almayan birine anlamsız. */
  if (!kinds.has("araci") && data.trades.length > 0) {
    gaps.push({
      key: "araci-hesap", tab: "hesaplar", action: "Aracı kurum hesabı aç",
      title: "Aracı kurum hesabın tanımlı değil",
      detail: "Yatırım hesabına aktardığın para da gider gibi görünüyor. Aracı türünde bir hesap açarsan aktarım virman olur, portföy alımların o hesaptan düşer.",
    });
  }
  const never = data.accounts.filter((a) => reconStatus(a, today) === "hic");
  if (never.length) {
    gaps.push({
      key: "mutabakat", tab: "hesaplar", action: "Hesapları doğrula",
      title: `${never.length} hesap hiç doğrulanmadı`,
      detail: "Mutabakat, gerçek bakiyeni sisteme sabitler: fark varsa 'düzeltme' hareketi olarak deftere yazılır. Yoksa 'bakiyem tutuyor mu' sorusunun cevabı hiçbir zaman olmaz.",
    });
  }
  /* "Nakit sayılan fon" yalnız elinde para piyasası fonu OLABİLECEK kullanıcıya önerilir:
     hiç FON tutmayan birine (ya da tamamını satmış olana) gösterilmez. */
  const holdsFund = positions(data.trades, data.prices).some((p) => p.type === "FON" && p.qty > 0);
  if (holdsFund && cashFundSymbols(data.settings).size === 0) {
    gaps.push({
      key: "nakit-fon", tab: "portfoy", action: "Fonu nakit say",
      title: "Para piyasası fonun nakit sayılmıyor",
      detail: "Likit fonlar nakit kadar erişilebilirdir. Portföyde 'nakit say' ile işaretlersen takvim onları etkin nakde katar ve ödeme öncesi 'fon boz' önerisi devreye girer.",
    });
  }
  return gaps;
}
