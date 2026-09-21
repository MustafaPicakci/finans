import React, { useMemo, useState } from "react";
import {
  convert, openPositions, symbolReturns,
  type AllData, type Currency, type Position, type PriceHistoryEntry, type Rates,
} from "@finans/engine";
import { api } from "../../api";
import { T, css, fmtMoney, fmtPct, fmtPay, TYPE_COLORS } from "../../theme";
import { Empty, useSayfalama, DahaFazla } from "../../ui";
import { PozisyonAyrinti } from "./PozisyonAyrinti";

/* ————— MEVCUT VARLIKLAR TABLOSU (Faz 32) —————
   Liste ekranındaki kart satırları "ne kadarım var, toplamda ne kazandım" diyor ama
   "bu hafta ne oldu, bu ay ne oldu" diyemiyordu. Bu tablo o eksiği kapatır: sembol başına
   pencere pencere getiri.

   İKİ FARKLI GETİRİ AYNI SATIRDA — ve ayrımı yazmak şart:
   • Günlük/Haftalık/Aylık/3A/1Y = SEMBOLÜN FİYAT getirisi (piyasa ne yaptı)
   • Toplam = SENİN pozisyonunun açık K/Z oranı (ortalama maliyetine göre)
   Biri piyasayı, öteki senin girişini ölçer; aynı kolonmuş gibi okunursa "hisse %40 yükselmiş
   ama bende %5" çelişki sanılır — oysa geç girmiş olmak tam da budur.

   Veri yoksa "—". TEFAS (FON) ve ALTIN geriye doldurulamadığından uzun pencereleri gerçekten
   boştur (bkz. returns.ts); eldeki en eski fiyatı taban saymak sahte getiri üretirdi.

   Tablo kendi `overflow-x: auto` kabındadır — CLAUDE.md tablolara bu izni açıkça verir,
   sayfa gövdesi yatay kaymaz. */

type Kolon = "sym" | "qty" | "avg" | "cur" | "value" | "agirlik" | "gunluk" | "haftalik" | "aylik" | "uc" | "yillik" | "toplam";

const BASLIK: { k: Kolon; label: string; sag?: boolean; ipucu?: string }[] = [
  { k: "sym", label: "Hisse" },
  { k: "qty", label: "Adet", sag: true },
  { k: "avg", label: "Maliyet", sag: true, ipucu: "ağırlıklı ortalama alış maliyetin" },
  { k: "cur", label: "Fiyat", sag: true, ipucu: "güncel birim fiyat" },
  { k: "value", label: "Değer", sag: true },
  { k: "agirlik", label: "Ağırlık", sag: true, ipucu: "bu portföy içindeki payı" },
  { k: "gunluk", label: "Günlük", sag: true, ipucu: "sembolün fiyat getirisi — son 1 gün" },
  { k: "haftalik", label: "Haftalık", sag: true, ipucu: "sembolün fiyat getirisi — son 7 gün" },
  { k: "aylik", label: "Aylık", sag: true, ipucu: "sembolün fiyat getirisi — son 30 gün" },
  { k: "uc", label: "3 Aylık", sag: true, ipucu: "sembolün fiyat getirisi — son 90 gün" },
  { k: "yillik", label: "Yıllık", sag: true, ipucu: "sembolün fiyat getirisi — son 365 gün" },
  { k: "toplam", label: "Toplam", sag: true, ipucu: "SENİN getirin: ortalama maliyetine göre açık K/Z oranı" },
];

type Satir = {
  p: Position;
  agirlik: number;
  tryDeger: number;
  getiri: ReturnType<typeof symbolReturns>;
  toplam: number | null;
};

export function VarlikTablosu({ data, pos, ccy, rates, reload, onSymbol }: {
  data: AllData; pos: Position[]; ccy: Currency; rates: Rates; reload: () => void;
  onSymbol?: (s: string) => void;
}) {
  const [sirala, setSirala] = useState<{ k: Kolon; asc: boolean }>({ k: "agirlik", asc: false });
  const [acikSym, setAcikSym] = useState<string | null>(null);

  const cashFunds = new Set((data.settings.cash_funds || "").split(",").map((s) => s.trim()).filter(Boolean));
  const toggleCashFund = async (sym: string) => {
    const next = new Set(cashFunds);
    next.has(sym) ? next.delete(sym) : next.add(sym);
    await api.put("settings", { cash_funds: [...next].join(",") });
    reload();
  };

  const satirlar = useMemo<Satir[]>(() => {
    const acik = openPositions(pos);
    const toplamTry = acik.reduce((s, p) => s + convert(p.value ?? 0, p.currency, "TRY", rates), 0);
    return acik.map((p) => {
      const tryDeger = convert(p.value ?? 0, p.currency, "TRY", rates);
      return {
        p, tryDeger,
        agirlik: toplamTry > 0 ? tryDeger / toplamTry : 0,
        getiri: symbolReturns(data.price_history as PriceHistoryEntry[], `${p.type}:${p.sym}`),
        toplam: p.unrealPct != null ? p.unrealPct * 100 : null,
      };
    });
  }, [pos, rates, data.price_history]);

  const sirali = useMemo(() => {
    const deger = (s: Satir): number | string => {
      switch (sirala.k) {
        case "sym": return s.p.sym;
        case "qty": return s.p.qty;
        case "avg": return s.p.avg;
        case "cur": return s.p.cur ?? -Infinity;
        case "value": return s.tryDeger;
        case "agirlik": return s.agirlik;
        case "toplam": return s.toplam ?? -Infinity;
        /* Veri yoksa (null) sıralamada EN SONA — "—" satırları listenin başında durup
           dolu olanları aşağı itseydi kolon işe yaramazdı. */
        default: return s.getiri[sirala.k] ?? -Infinity;
      }
    };
    return [...satirlar].sort((a, b) => {
      const x = deger(a), y = deger(b);
      const c = typeof x === "string" ? String(x).localeCompare(String(y), "tr") : (x as number) - (y as number);
      return sirala.asc ? c : -c;
    });
  }, [satirlar, sirala]);

  /* SIRALAMA ÖNCE, DİLİM SONRA: tersi olsaydı "Ağırlık ↓" yalnız görünen sayfayı sıralar ve
     tablo "en büyük pozisyonum ne" sorusuna yanlış cevap verirdi. Dilim cömert (25) çünkü bu
     liste zamanla değil PORTFÖY GENİŞLİĞİYLE büyür — 25 varlığın altında denetim hiç çıkmaz. */
  const sayfa = useSayfalama(sirali, 25, `${sirala.k}|${sirala.asc}`);

  if (satirlar.length === 0) {
    return <Empty>{pos.length === 0 ? "Bu portföyde işlem yok." : "Açık pozisyon yok — tümü kapanmış."}</Empty>;
  }

  const tikla = (k: Kolon) => setSirala((s) => (s.k === k ? { k, asc: !s.asc } : { k, asc: k === "sym" }));

  const Getiri = ({ v }: { v: number | null }) => (
    <span style={{ ...css.mono, fontSize: 12, color: v == null ? T.mut3 : v > 0 ? T.pos : v < 0 ? T.neg : T.mut }}>
      {v == null ? "—" : fmtPct(v, 2, true)}
    </span>
  );

  const th: React.CSSProperties = {
    fontSize: 10.5, color: T.mut, textTransform: "uppercase", letterSpacing: "0.03em", fontWeight: 700,
    padding: "8px 10px", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none",
    borderBottom: `1px solid ${T.line}`, background: T.panel,
  };
  const td: React.CSSProperties = {
    padding: "10px", whiteSpace: "nowrap", borderBottom: `1px solid ${T.line}`, fontSize: 12.5,
  };

  return (<>
    {/* Kap yatay kayar, SAYFA kaymaz. `overflow-x:auto` + `maxWidth:100%` şart: tablo
        min-content genişliğinde durur ve dar ekranda kabın dışına taşmaz. */}
    <div style={{ overflowX: "auto", maxWidth: "100%", margin: "0 -4px" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760 }}>
        <thead>
          <tr>
            {BASLIK.map((b) => (
              <th key={b.k} title={b.ipucu} onClick={() => tikla(b.k)}
                style={{ ...th, textAlign: b.sag ? "right" : "left", color: sirala.k === b.k ? T.acc : T.mut }}>
                {b.label}
                {sirala.k === b.k && <span style={{ marginLeft: 3 }}>{sirala.asc ? "↑" : "↓"}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sayfa.gorunen.map((s) => {
            const p = s.p;
            const acik = acikSym === `${p.type}:${p.sym}`;
            const adet = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "").replace(".", ","));
            return (
              <React.Fragment key={`${p.type}:${p.sym}`}>
                <tr onClick={() => setAcikSym(acik ? null : `${p.type}:${p.sym}`)}
                  title="Ayrıntı ve fiyat ayarı" style={{ cursor: "pointer", background: acik ? T.panel2 : undefined }}>
                  <td style={{ ...td, textAlign: "left" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: "grid", placeItems: "center",
                        background: T.panel2, color: TYPE_COLORS[p.type] || T.mut,
                        fontFamily: T.disp, fontSize: 11, fontWeight: 800, letterSpacing: "-0.03em",
                      }}>{p.sym.slice(0, 2).toLocaleUpperCase("tr")}</span>
                      <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        <span style={{ ...css.mono, fontWeight: 700, fontSize: 13 }}>{p.sym}</span>
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: TYPE_COLORS[p.type] || T.mut3 }}>
                          {p.type}{p.currency === "USD" ? " · USD" : ""}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: "right", ...css.mono, color: T.mut }}>{adet(p.qty)}</td>
                  <td style={{ ...td, textAlign: "right", ...css.mono }}>{fmtMoney(p.avg, p.currency, true)}</td>
                  <td style={{ ...td, textAlign: "right", ...css.mono }}>{p.cur != null ? fmtMoney(p.cur, p.currency, true) : "—"}</td>
                  <td style={{ ...td, textAlign: "right", ...css.mono, fontWeight: 600 }}>
                    {p.value != null ? fmtMoney(Math.round(convert(p.value, p.currency, ccy, rates)), ccy) : "—"}
                  </td>
                  <td style={{ ...td, textAlign: "right", ...css.mono, fontWeight: 600 }}>
                    {fmtPay(s.agirlik, 2)}
                  </td>
                  <td style={{ ...td, textAlign: "right" }}><Getiri v={s.getiri.gunluk} /></td>
                  <td style={{ ...td, textAlign: "right" }}><Getiri v={s.getiri.haftalik} /></td>
                  <td style={{ ...td, textAlign: "right" }}><Getiri v={s.getiri.aylik} /></td>
                  <td style={{ ...td, textAlign: "right" }}><Getiri v={s.getiri.uc} /></td>
                  <td style={{ ...td, textAlign: "right" }}><Getiri v={s.getiri.yillik} /></td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {/* "Toplam" rozeti: bu kolon diğerlerinden FARKLI bir şey ölçüyor
                        (senin K/Z'in), görsel olarak da ayrılsın. */}
                    <span style={{
                      ...css.mono, fontSize: 12, fontWeight: 600, padding: "3px 8px", borderRadius: 999,
                      background: s.toplam == null ? T.panel2 : s.toplam >= 0 ? T.posSoft : T.negSoft,
                      color: s.toplam == null ? T.mut3 : s.toplam >= 0 ? T.pos : T.neg,
                    }}>{s.toplam == null ? "—" : fmtPct(s.toplam, 2, true)}</span>
                  </td>
                </tr>
                {acik && (
                  <tr>
                    <td colSpan={BASLIK.length} style={{ padding: 0, background: T.panel2, borderBottom: `1px solid ${T.line}` }}>
                      <PozisyonAyrinti
                        p={p} now={data.now} reload={reload} nakitSayilir={cashFunds.has(p.sym)}
                        onNakitSay={() => toggleCashFund(p.sym)} onSymbol={onSymbol} solBosluk={10}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
      {/* Denetim kaydırma kabının DIŞINDA: içeride kalsaydı tablonun `minWidth:760`
          genişliğine yayılır ve mobilde sağdaki düğmeyi görmek için yatay kaydırmak
          gerekirdi — oysa sayfalama denetimi her zaman elin altında olmalı. */}
      <DahaFazla s={sayfa} ad="varlık" yon="fazla" />
    </>
  );
}
