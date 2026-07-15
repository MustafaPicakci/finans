import type { Deposit } from "./types.js";
import { parseD } from "./date.js";

/* ————— VADELİ MEVDUAT MATEMATİĞİ —————
   Basit faiz, yıllık oran, 365 gün-sayımı (TR mevduat standardı; tek vade için bileşik değil).
   Değer bugünden vadeye doğru DOĞRUSAL accrue eder ve vadede net getiride donar — böylece net
   varlık grafiğinde kesme/sıçrama olmaz, para vade sonuna dek "kilitli varlık" gibi sayılır. */

const DAY_MS = 86_400_000;

export const depositMaturity = (d: Deposit): Date =>
  new Date(parseD(d.open_date).getTime() + d.term_days * DAY_MS);

/** Vade sonundaki brüt faiz getirisi (stopaj öncesi) */
export const depositGrossInterest = (d: Deposit): number =>
  d.principal * (d.rate / 100) * (d.term_days / 365);

/** Stopaj düşülmüş net faiz getirisi */
export const depositNetInterest = (d: Deposit): number =>
  depositGrossInterest(d) * (1 - (d.withholding || 0) / 100);

/** Vade sonunda ele geçen: anapara + net faiz */
export const depositMaturityValue = (d: Deposit): number =>
  d.principal + depositNetInterest(d);

/** `asOf` tarihine dek geçen sürenin vadeye oranı [0,1] (açılış öncesi 0, vade sonrası 1) */
export const depositAccruedFraction = (d: Deposit, asOf: Date): number => {
  if (d.term_days <= 0) return 1;
  const elapsed = (asOf.getTime() - parseD(d.open_date).getTime()) / DAY_MS;
  return Math.max(0, Math.min(1, elapsed / d.term_days));
};

/** `asOf`'a dek biriken net faiz (doğrusal) */
export const depositAccruedInterest = (d: Deposit, asOf: Date): number =>
  depositNetInterest(d) * depositAccruedFraction(d, asOf);

/** `asOf` tarihindeki mevduat değeri = anapara + biriken net faiz (vadede net getiride donar) */
export const depositValueOn = (d: Deposit, asOf: Date): number =>
  d.principal + depositAccruedInterest(d, asOf);

export const depositMatured = (d: Deposit, asOf: Date): boolean =>
  asOf.getTime() >= depositMaturity(d).getTime();

/** Vadeye kalan gün sayısı (dolmuşsa 0) */
export const depositDaysRemaining = (d: Deposit, asOf: Date): number =>
  Math.max(0, Math.ceil((depositMaturity(d).getTime() - asOf.getTime()) / DAY_MS));
