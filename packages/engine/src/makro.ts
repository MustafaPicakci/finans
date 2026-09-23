/* ————— FAZ 37: MAKRO TAKVİM (TCMB / Fed / TÜİK) —————

   Bu dosya bir VERİ SAĞLAYICISI DEĞİL, elle bakımlı bir TABLODUR ve bu bilinçli bir seçimdir.
   Fed yılda 8, TCMB yılda 8 toplantı yapar ve ikisi de takvimini yıl BAŞINDAN duyurur —
   yani aranan şey yılda ~30 satır, hepsi aylar önceden kesin. Bunun için bir API aramak
   (ya da kazımak) yanlış soruydu: `prices.ts`'in TEFAS/KAP dersi burada tersine işliyor,
   çünkü veri kırılgan değil, sadece SEYREK. Kaynak sayfalar (federalreserve.gov/fomccalendars,
   tcmb.gov.tr/takvim) statik HTML ve yılda bir kez değişiyor; onları her gün yoklamak
   kırılganlık ithal etmek olurdu. Yılda bir commit ucuzdur.

   BEDELİ SESSİZ TÜKENMEDİR ve tek gerçek risk bu: takvim bitince ekran "yaklaşan olay yok"
   der ve bunun sebebi görünmez. Bu yüzden `makroSonTarih()` var — arayüz takvimin nereye
   kadar dolu olduğunu YAZAR ve bitmeye yaklaşınca uyarır (`setup.ts`'in "kurulmamış yetenek
   sessizce atıl kalıyordu" dersinin aynısı).

   TÜFE İSTİSNASI — kuralla üretilir, listeden değil: TÜİK enflasyonu her ayın 3'ünde
   yayımlar (hafta sonuna denk gelirse sonraki iş günü), yani tarih tek tek duyurulmuş bir
   liste değil bir DESENDİR ve desen tükenmez. Karşılığında kesinliği düşüktür (resmî tatil
   kaymasını bilmiyoruz), o yüzden `tahmini: true` ile işaretlenir — tahmini bir tarihi kesin
   gibi göstermek `returns.ts`'in "veri yetmiyorsa uydurulmaz" kuralının ihlali olurdu.  */

/** Makro olayın kaynağı — arayüzde rozet olarak yazılır (hangi kuruma ait olduğu görünmeli) */
export type MakroKaynak = "TCMB" | "Fed" | "TÜİK";

export type MakroOlay = {
  date: string; // YYYY-MM-DD
  kaynak: MakroKaynak;
  baslik: string;
  /** true = tarih bir desenden türetildi (TÜFE), duyurulmuş değil */
  tahmini?: boolean;
};

/* ————— DUYURULMUŞ TARİHLER —————
   Kaynak: tcmb.gov.tr/takvim ve federalreserve.gov/monetarypolicy/fomccalendars.htm
   (22 Eylül 2026'da doğrulandı). TCMB 2027'nin yalnız İLK YARISINI duyurmuş durumda;
   listenin orada bitmesi eksiklik değil, kurumun takviminin bittiği yer. */

/** TCMB Para Politikası Kurulu — faiz kararı günleri */
const TCMB_PPK = [
  "2026-01-22", "2026-03-12", "2026-04-22", "2026-06-11",
  "2026-07-23", "2026-09-10", "2026-10-22", "2026-12-10",
  "2027-01-21", "2027-03-18", "2027-04-22", "2027-06-10",
];

/** TCMB Enflasyon Raporu (yılda 4) */
const TCMB_ENFLASYON_RAPORU = [
  "2026-02-12", "2026-05-14", "2026-08-13", "2026-11-12",
  "2027-02-11", "2027-05-13",
];

/** TCMB Finansal İstikrar Raporu (yılda 2) */
const TCMB_FINANSAL_ISTIKRAR = ["2026-05-22", "2026-11-27", "2027-05-28"];

/** FOMC faiz kararı — iki günlük toplantının İKİNCİ günü (karar o gün açıklanır) */
const FOMC = [
  "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17",
  "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
  "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09",
  "2027-07-28", "2027-09-15", "2027-10-27", "2027-12-08",
];

const SABIT: MakroOlay[] = [
  ...TCMB_PPK.map((date) => ({ date, kaynak: "TCMB" as const, baslik: "TCMB faiz kararı (PPK)" })),
  ...TCMB_ENFLASYON_RAPORU.map((date) => ({ date, kaynak: "TCMB" as const, baslik: "Enflasyon Raporu" })),
  ...TCMB_FINANSAL_ISTIKRAR.map((date) => ({ date, kaynak: "TCMB" as const, baslik: "Finansal İstikrar Raporu" })),
  ...FOMC.map((date) => ({ date, kaynak: "Fed" as const, baslik: "Fed faiz kararı (FOMC)" })),
];

/** Duyurulmuş tarihlerin EN SONU — arayüz "takvim şu tarihe kadar dolu" diyebilsin diye.
    TÜFE buna dahil DEĞİL: o kuralla üretiliyor, yani hiç tükenmez ve takvimin dolu olup
    olmadığı sorusunun cevabını gizlerdi. */
export const makroSonTarih = (): string => SABIT.reduce((a, o) => (o.date > a ? o.date : a), "");

const pad = (n: number) => String(n).padStart(2, "0");

/** TÜİK TÜFE yayın günü: ayın 3'ü, hafta sonuna denk gelirse sonraki iş günü. */
function tufeGunu(y: number, m: number): string {
  const d = new Date(y, m - 1, 3);
  if (d.getDay() === 6) d.setDate(5); // Cumartesi → Pazartesi
  else if (d.getDay() === 0) d.setDate(4); // Pazar → Pazartesi
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `from`–`to` (dahil, YYYY-MM-DD) aralığındaki makro olaylar, tarihe göre sıralı. */
export function makroOlaylar(from: string, to: string): MakroOlay[] {
  const out = SABIT.filter((o) => o.date >= from && o.date <= to);
  /* TÜFE: aralığın aylarını gez. Aralık çok geniş olsa bile ay sayısıyla sınırlı. */
  const [fy, fm] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const [ty, tm] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))];
  for (let y = fy, m = fm; y * 12 + m <= ty * 12 + tm; m === 12 ? (y++, m = 1) : m++) {
    const date = tufeGunu(y, m);
    if (date >= from && date <= to)
      out.push({ date, kaynak: "TÜİK", baslik: "Enflasyon (TÜFE) açıklanıyor", tahmini: true });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
