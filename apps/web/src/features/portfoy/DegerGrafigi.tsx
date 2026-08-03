import React, { useMemo, useState } from "react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import {
  fmtD, parseD, convert, portfolioValueHistory, sliceValueHistory, bucketValueHistory, historyChange,
  type Currency, type HistoryRange, type PriceHistoryEntry, type Rates, type Trade,
} from "@finans/engine";
import { T, css, fmtMoney } from "../../theme";
import { Empty } from "../../ui";

/* ————— PORTFÖY DEĞER GRAFİĞİ (Faz 13) —————
   Aralık seçici (1H/1A/3A/6A/1Y/Tümü) + seçili dönemin değişimi (mutlak + %).
   Dürüst kısıt: `price_history` günde bir anlık görüntü tutar, yani en küçük çözünürlük GÜNDÜR —
   aralık düğmeleri pencereyi daraltır, veriyi sıklaştırmaz. Geriye dönük uydurma veri yok:
   fiyat çekmeye başlanmadan önceki günler grafikte hiç yoktur. Uzun pencerelerde noktalar
   seyreltilir (her kovanın son değeri = o dönemin kapanışı). */

const RANGES: { v: HistoryRange; label: string }[] = [
  { v: "1H", label: "1H" }, { v: "1A", label: "1A" }, { v: "3A", label: "3A" },
  { v: "6A", label: "6A" }, { v: "1Y", label: "1Y" }, { v: "TÜM", label: "Tümü" },
];
/** Ekranda okunabilir kalması için pencere başına en fazla nokta */
const MAX_POINTS = 90;

export function DegerGrafigi({ trades, priceHistory, rates, ccy, title = "Portföy Değeri", scopeLabel, height = 220 }: {
  trades: Trade[]; priceHistory: PriceHistoryEntry[]; rates: Rates; ccy: Currency;
  title?: string; scopeLabel?: string | null; height?: number;
}) {
  const [range, setRange] = useState<HistoryRange>("1A");

  /* Tam geçmiş bir kez hesaplanır (TRY), aralık ondan kesilir — düğmeye basınca yeniden hesap yok */
  const full = useMemo(() => portfolioValueHistory(trades, priceHistory, rates), [trades, priceHistory, rates]);
  const points = useMemo(() => bucketValueHistory(sliceValueHistory(full, range), MAX_POINTS), [full, range]);
  const change = useMemo(() => historyChange(points), [points]);

  const chartData = points.map((p) => ({
    x: fmtD(parseD(p.date), range === "1H" || range === "1A" ? { day: "numeric", month: "short" } : { month: "short", year: "2-digit" }),
    date: p.date,
    value: Math.round(convert(p.value, "TRY", ccy, rates)),
  }));
  const up = change.abs >= 0;
  const changeCcy = Math.round(convert(change.abs, "TRY", ccy, rates));
  /* Seçili aralıkta veri yoksa hangi aralıkta olduğunu söyle — boş grafiğe bakıp "bozuk" sanılmasın */
  const emptyHint = full.length === 0
    ? "Fiyat geçmişi birikince burada bir grafik görünecek — fiyatları birkaç gün yeniledikçe dolar."
    : `Bu aralıkta kayıt yok (toplam ${full.length} günlük geçmiş var). Daha geniş bir aralık seç.`;

  return (
    <div style={{ ...css.card, paddingBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
          {scopeLabel && <span style={{ fontSize: 12, color: T.mut }}>— {scopeLabel}</span>}
          {points.length >= 2 && (
            <span style={{ ...css.mono, fontSize: 12.5, color: up ? T.pos : T.neg }}>
              {up ? "▲" : "▼"} {up ? "+" : "−"}{fmtMoney(Math.abs(changeCcy), ccy)}
              {change.pct != null && <span style={{ color: T.mut, marginLeft: 6 }}>
                ({up ? "+" : ""}{change.pct.toFixed(1).replace(".", ",")}%)
              </span>}
            </span>
          )}
        </div>
        <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: `1px solid ${T.line}` }}>
          {RANGES.map((r) => (
            <button key={r.v} type="button" onClick={() => setRange(r.v)} style={{
              padding: "5px 10px", border: "none", cursor: "pointer", fontSize: 11.5, fontFamily: T.disp,
              fontWeight: range === r.v ? 700 : 500,
              background: range === r.v ? T.panel : T.panel2, color: range === r.v ? T.acc : T.mut,
            }}>{r.label}</button>
          ))}
        </div>
      </div>

      {points.length < 2 ? (
        <Empty>{emptyHint}</Empty>
      ) : (<>
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="dgv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={up ? T.pos : T.neg} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={up ? T.pos : T.neg} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={T.line} strokeDasharray="2 6" vertical={false} />
              <XAxis dataKey="x" tick={{ fill: T.mut, fontSize: 10, fontFamily: T.mono }} tickLine={false} axisLine={{ stroke: T.line }} minTickGap={40} />
              <YAxis tick={{ fill: T.mut, fontSize: 10, fontFamily: T.mono }} tickLine={false} axisLine={false} width={52}
                domain={["auto", "auto"]}
                tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
              <Tooltip contentStyle={{ background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 8, fontFamily: T.mono, fontSize: 12 }}
                labelStyle={{ color: T.mut }}
                labelFormatter={(_l, p) => (p?.[0]?.payload ? fmtD(parseD(p[0].payload.date), { day: "numeric", month: "long", year: "numeric" }) : "")}
                formatter={(v: number) => [fmtMoney(v, ccy), title]} />
              <Area type="monotone" dataKey="value" stroke={up ? T.pos : T.neg} strokeWidth={2} fill="url(#dgv)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div style={{ fontSize: 11, color: T.mut3, padding: "6px 2px 4px" }}>
          {points.length} gün · günlük kapanış fiyatlarıyla{ccy !== "TRY" ? ` · ${ccy} karşılığı güncel kurla` : ""}
          {full.length > points.length && range !== "TÜM" && <> · toplam {full.length} günlük geçmiş var</>}
        </div>
      </>)}
    </div>
  );
}
