/* ————— KART MUTABAKATI —————
   Hesap mutabakatının (Faz 16) kart karşılığı: kayıtlar eksik girildiğinde kart borcu bankadakinden
   sessizce ayrışmasın. Hesapta karşılaştırılan rakam bakiyedir; kartta "toplam borç" / "dönem borcu"
   KULLANILAMAZ — tanımları bankadan bankaya değişir (kimi gelecek taksitleri sayar, kimi saymaz) ve
   bazı bankalar eski alışverişlerin bu ayki taksidini döneme ancak kesimde ekler. Her bankanın
   gösterdiği ve tanımı tek olan rakam KULLANILABİLİR LİMİTTİR: taksitli alışverişte toplam tutar
   limitten hemen düşer, taksit ödendikçe geri açılır. Yani limit − kullanılabilir = ödenmemiş
   ekstreler + açık dönem + BÜTÜN gelecek taksitler — `cardInfos().debt` ile tanım gereği aynı şey.

   Farkın TOPLAMI bilinir, hangi aylara dağıldığı bilinmez (12.000'lik fark tek çekim de olabilir,
   kalan 6 taksit de). Rakamdan çıkarmanın güvenilir yolu yok — kullanıcı seçer, varsayılan tek çekim.
   Fark bir kart harcaması olarak yazılır ve `mutabakat: true` taşır: içe aktarmada defterden
   ayrılır (bankada tek karşılığı yoktur, `hesapDefteri`nin düzeltme hareketini dışlamasıyla aynı
   gerekçe) ve ekstre gelince kaldırılması önerilir — yoksa aynı para iki kez sayılırdı.

   Saf + testli. Kayıt YAZMAZ. */

import { acikDonem, cardInfos, firstCutoff, stmtKey, txShares, type Ekstre, type Odemeler } from "./cards.js";
import { keyOf } from "./date.js";
import type { Card, CardTx } from "./types.js";

/** Bu kadarın altındaki fark "tutuyor" sayılır: taksit paylarının kuruş yuvarlaması bankada ve
    burada farklı birikebilir; kuruş için düzeltme kalemi yazmak gürültüdür. */
export const KART_MUTABAKAT_TOLERANS = 1;
export const KART_MUTABAKAT_ADI = "Açıklanamayan kart harcaması";

export const mutabakatKalemiMi = (t: Pick<CardTx, "mutabakat">): boolean => t.mutabakat === true;

export type KartMutabakat = {
  /** uygulamadaki borç (`cardInfos().debt`) */
  bizim: number;
  /** bankadaki borç: limit − kullanılabilir limit */
  banka: number;
  /** banka − bizim; artı = uygulamada eksik harcama */
  fark: number;
  tutuyor: boolean;
  /** bugün yapılan harcamanın düşeceği ekstrenin kesimi */
  acikKesim: Date;
  /** kesimi geçmiş, vadesi gelmemiş, ödenmemiş ekstre — eksik harcama ona da ait olabilir */
  kesilen: Ekstre | null;
  /** fark eksiyken: tutarı farka denk gelen ödenmemiş ekstreler (bankada ödenmiş, burada işaretlenmemiş) */
  odenmisOlabilir: Ekstre[];
  /** borçta payı süren eski mutabakat kalemleri (`kalan` = ödenmemiş ekstrelere düşen payları) */
  duzeltmeler: { tx: CardTx; kalan: number }[];
};

export function kartMutabakat(card: Card, txs: CardTx[], today: Date, odemeler: Odemeler, banka: number): KartMutabakat {
  const benim = txs.filter((t) => t.card_id === card.id);
  const info = cardInfos([card], benim, today, odemeler)[0];
  const fark = banka - info.debt;
  const kesilmis = info.statements.filter((s) => !s.paid && !acikDonem(s, today));
  return {
    bizim: info.debt, banka, fark,
    tutuyor: Math.abs(fark) < KART_MUTABAKAT_TOLERANS,
    acikKesim: firstCutoff(today, card.statement_day),
    kesilen: kesilmis[0] ?? null,
    odenmisOlabilir: fark < 0 ? kesilmis.filter((s) => Math.abs(s.amount + fark) < KART_MUTABAKAT_TOLERANS) : [],
    duzeltmeler: benim.filter(mutabakatKalemiMi)
      .map((tx) => ({
        tx,
        kalan: txShares(tx, card).filter((s) => s.due >= today && !odemeler.has(stmtKey(card.id, s.due)))
          .reduce((t, s) => t + s.amount, 0),
      }))
      .filter((d) => Math.abs(d.kalan) >= 0.005),
  };
}

/** Farkın yazılacağı kart harcaması. `donem: "kesilen"` → kesilmiş ekstreye (kesim günü tarihiyle —
    kesim günü dahil harcama o ekstreye girer), yoksa açık döneme (bugün). `taksit`: kalan taksit
    sayısı; fark limitten düşen TOPLAMDIR, yani taksitte de tutar farkın kendisidir. Eksi fark
    (bankada borç daha az) tek çekim ve açık döneme yazılır — taksite bölünecek bir alışveriş yok. */
export function mutabakatKalemi(
  m: Pick<KartMutabakat, "fark" | "kesilen">, today: Date,
  secim: { donem?: "acik" | "kesilen"; taksit?: number } = {},
): { date: string; name: string; amount: number; installments: number; mutabakat: true } {
  const eksi = m.fark < 0;
  const kesilen = !eksi && secim.donem === "kesilen" && m.kesilen ? m.kesilen : null;
  const n = Math.trunc(Number(secim.taksit ?? 1));
  return {
    date: keyOf(kesilen ? kesilen.cut : today),
    name: KART_MUTABAKAT_ADI,
    amount: Math.round(m.fark * 100) / 100,
    installments: !eksi && Number.isFinite(n) && n >= 1 ? n : 1,
    mutabakat: true,
  };
}
