import React from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid,
  PieChart, Pie, Cell,
} from "recharts";
import {
  fmtD, parseD, convert, portfolioValueHistory, depositValueOn,
  type AllData, type Day, type Position, type Rates, type Currency,
} from "@finans/engine";
import { api } from "../../api";
import { T, css, tl, TYPE_COLORS } from "../../theme";
import { Money, Empty } from "../../ui";

export type OzetSummary = {
  netWorthTry: number; cash: number; portValueTry: number; depositsValueTry: number;
  cardDebt: number; loanDebt: number; accountCount: number; portTypes: string[];
  cardsWaiting: number; loansActive: number;
};

/** Sabit WxH kutuda alan+çizgi path'i (net varlık hero sparkline'ı) */
function sparkPath(vals: number[], W: number, H: number, pad = 6): { line: string; area: string } {
  if (vals.length < 2) return { line: "", area: "" };
  const n = vals.length, mn = Math.min(...vals), mx = Math.max(...vals), rng = (mx - mn) || 1;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (n - 1);
  const y = (v: number) => (H - pad) - ((v - mn) / rng) * (H - 2 * pad);
  const line = "M" + vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" L");
  const area = `${line} L${x(n - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
  return { line, area };
}

/* Özet grafikleri TRY canonical'dır (nakit projeksiyonu + portföy değeri geçmişi hep TRY).
   Hero net varlık + KPI kartları buradadır (değerler App.tsx'te TRY hesaplanıp görüntü birimine çevrilerek gelir).
   Hesap/mevduat yönetimi Hesaplar sekmesindedir; burada yalnız özet + "Yönet" kısayolu. */
export function Ozet({ data, days, pos, cash, rates, reload, summary, m, ccy, onGoAccounts }: {
  data: AllData; days: Day[]; pos: Position[]; cash: number; rates: Rates; reload: () => void;
  summary: OzetSummary; m: (v: number, dec?: boolean) => string; ccy: Currency; onGoAccounts: () => void;
}) {
  /* Likit (etkin) nakit = harcanabilir nakit + "nakit say" işaretli para piyasası fonları.
     Takvimle aynı tanım; portföy/hisse/vadeli buna girmez (onlar toplam varlıkta). */
  const eff = (d: Day) => d.bal + d.cashFunds;
  const minDay = days.reduce((m, d) => (eff(d) < eff(m) ? d : m), days[0] ?? { bal: 0, cashFunds: 0, date: new Date() } as Day);
  const chart = days
    .filter((_, i) => i % Math.max(1, Math.floor(days.length / 240)) === 0)
    .map((d) => ({ x: fmtD(d.date, { day: "numeric", month: "short" }), bal: Math.round(eff(d)) }));
  const upcoming = days.filter((d) => d.ev.length).slice(0, 20)
    .flatMap((d) => d.ev.map((e) => ({ ...e, date: d.date }))).slice(0, 6);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  /* runway: likit nakitin ilk kez sıfırın altına düştüğü gün — "param ne zaman biter" */
  const runwayDay = days.find((d) => eff(d) < 0);
  const runwayIn = runwayDay ? Math.round((runwayDay.date.getTime() - today.getTime()) / 86_400_000) : null;
  const depositsValue = data.deposits.reduce((s, d) => s + depositValueOn(d, today), 0);
  const alloc = [
    { name: "Nakit", value: Math.max(0, cash) },
    ...Object.entries(pos.reduce((m, p) => {
      if (p.value) m[p.type] = (m[p.type] || 0) + convert(p.value, p.currency, "TRY", rates); return m;
    }, {} as Record<string, number>)).map(([name, value]) => ({ name, value })),
    { name: "Vadeli", value: depositsValue },
  ].filter((a) => a.value > 0);
  const valueHistory = portfolioValueHistory(data.trades, data.price_history, rates)
    .map((v) => ({ x: fmtD(parseD(v.date), { day: "numeric", month: "short" }), value: Math.round(v.value) }));

  /* Hero sparkline: yakın vadeli likit nakit eğilimi (net varlık geçmişi tutulmadığından dekoratif ama anlamlı) */
  const sparkVals = days.length >= 2
    ? days.filter((_, i) => i % Math.max(1, Math.floor(days.length / 56)) === 0).map(eff)
    : [];
  const sp = sparkPath(sparkVals, 560, 90, 6);

  const kpis: { name: string; color: string; val: string; sub: string; neg?: boolean }[] = [
    { name: "Nakit", color: "var(--type-nakit)", val: m(summary.cash), sub: `${summary.accountCount} hesap` },
    { name: "Portföy", color: T.acc, val: m(summary.portValueTry), sub: summary.portTypes.length ? summary.portTypes.join(" · ") : "henüz işlem yok" },
    { name: "Kart Borcu", color: T.neg, neg: summary.cardDebt > 0, val: (summary.cardDebt > 0 ? "−" : "") + m(summary.cardDebt), sub: summary.cardsWaiting > 0 ? `${summary.cardsWaiting} ekstre bekliyor` : "borç yok" },
    { name: "Kredi Borcu", color: T.neg, neg: summary.loanDebt > 0, val: (summary.loanDebt > 0 ? "−" : "") + m(summary.loanDebt), sub: summary.loansActive > 0 ? `${summary.loansActive} aktif kredi` : "borç yok" },
  ];

  return (<>
    <div className="hero-grid">
      <div style={{ ...css.card, display: "flex", flexDirection: "column", padding: "24px 26px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: T.mut3 }}>Net Varlık</div>
        <div className="nw-value" style={{ ...css.mono, fontSize: 44, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 8, lineHeight: 1 }}>{m(summary.netWorthTry)}</div>
        <div style={{ fontSize: 12.5, color: T.mut3, marginTop: 8 }}>nakit + portföy{summary.depositsValueTry > 0 ? " + vadeli" : ""} − kart borcu − kredi borcu</div>
        {sp.line && (
          <svg viewBox="0 0 560 90" preserveAspectRatio="none" style={{ width: "100%", height: 66, marginTop: "auto", overflow: "visible" }}>
            <defs><linearGradient id="nwg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.acc} stopOpacity={0.22} /><stop offset="100%" stopColor={T.acc} stopOpacity={0} /></linearGradient></defs>
            <path d={sp.area} fill="url(#nwg)" />
            <path d={sp.line} fill="none" stroke={T.acc} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <div className="grid2">
        {kpis.map((k) => (
          <div key={k.name} style={{ ...css.card, padding: "16px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 500, color: T.mut }}>
              <span style={{ width: 8, height: 8, borderRadius: 3, background: k.color }} />{k.name}
            </div>
            <div style={{ ...css.mono, fontSize: 21, fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap", marginTop: 7, color: k.neg ? T.neg : T.text }}>{k.val}</div>
            <div style={{ fontSize: 11.5, color: T.mut3, marginTop: 3 }}>{k.sub}</div>
          </div>
        ))}
      </div>
    </div>

    <div style={{ ...css.card, paddingBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Nakit Haritası</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {days.length > 0 && (
            <div style={{
              background: eff(minDay) < 0 ? T.negSoft : T.panel2, border: `1px solid ${eff(minDay) < 0 ? T.neg : T.line}`,
              borderRadius: 20, padding: "4px 12px", fontSize: 12, ...css.mono,
            }}>
              en düşük: {fmtD(minDay.date, { day: "numeric", month: "short" })} ·{" "}
              <span style={{ color: eff(minDay) < 0 ? T.neg : T.pos }}>{tl.format(Math.round(eff(minDay)))}</span>
            </div>
          )}
          <select style={{ ...css.input, width: 90, padding: "5px 8px", fontSize: 12 }} value={data.settings.horizon || "6"}
            onChange={async (e) => { await api.put("settings", { horizon: e.target.value }); reload(); }}>
            {[3, 6, 12, 24].map((m) => <option key={m} value={m}>{m} ay</option>)}
          </select>
        </div>
      </div>
      <div style={{ fontSize: 11, color: T.mut, marginTop: 4 }}>
        Likit nakit = hesap bakiyeleri + “nakit say” işaretli para piyasası fonları. Portföy, hisse ve vadeli mevduat buna dahil değildir (onlar toplam varlıkta).
      </div>
      {runwayDay ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: runwayIn! <= 0 ? T.neg : T.warn, background: runwayIn! <= 0 ? T.negSoft : T.warnSoft, borderRadius: 10, padding: "8px 12px", fontSize: 13, marginTop: 8, fontWeight: 500 }}>
          {runwayIn! <= 0
            ? <>⚠ Likit nakitiniz şu an ekside ({tl.format(Math.round(eff(runwayDay)))}). Gelir kalemi girmemiş veya bir hesap bakiyesi eksi olabilir.</>
            : <>⚠ Likit nakitiniz <b>{fmtD(runwayDay.date, { day: "numeric", month: "long" })}</b> dolayında tükeniyor (~{runwayIn} gün sonra).</>}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: T.pos, background: T.posSoft, borderRadius: 10, padding: "8px 12px", fontSize: 13, marginTop: 8, fontWeight: 500 }}>
          ✓ Seçili {data.settings.horizon || "6"} ay boyunca likit nakitiniz eksiye düşmüyor.
        </div>
      )}
      <div style={{ height: 220, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chart} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={T.acc} stopOpacity={0.45} />
                <stop offset="100%" stopColor={T.acc} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={T.line} strokeDasharray="2 6" vertical={false} />
            <XAxis dataKey="x" tick={{ fill: T.mut, fontSize: 10, fontFamily: T.mono }} tickLine={false} axisLine={{ stroke: T.line }} minTickGap={40} />
            <YAxis tick={{ fill: T.mut, fontSize: 10, fontFamily: T.mono }} tickLine={false} axisLine={false} width={52}
              tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
            <Tooltip contentStyle={{ background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 8, fontFamily: T.mono, fontSize: 12 }}
              labelStyle={{ color: T.mut }} formatter={(v: number) => [tl.format(v), "Likit nakit"]} />
            <ReferenceLine y={0} stroke={T.neg} strokeDasharray="4 4" />
            <Area type="monotone" dataKey="bal" stroke={T.acc} strokeWidth={2} fill="url(#g)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
      <div style={css.card}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Varlık Dağılımı</div>
        {alloc.length === 0 ? <Empty>Hesap bakiyesi veya işlem ekleyin.</Empty> : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 130, height: 130 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={alloc} dataKey="value" innerRadius={38} outerRadius={60} strokeWidth={0}>
                    {alloc.map((a) => <Cell key={a.name} fill={TYPE_COLORS[a.name] || T.mut} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ flex: 1, display: "grid", gap: 4 }}>
              {alloc.map((a) => (
                <div key={a.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span><span style={{ color: TYPE_COLORS[a.name] || T.mut }}>●</span> {a.name}</span>
                  <span style={css.mono}>{tl.format(Math.round(a.value))}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div style={css.card}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Yaklaşan Hareketler</div>
        {upcoming.length === 0 ? <Empty>Plan sekmesinden gelir/gider ekleyin.</Empty> : upcoming.map((e, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: i < upcoming.length - 1 ? `1px solid ${T.line}` : "none" }}>
            <div style={{ fontSize: 13 }}>
              <span style={{ ...css.mono, color: T.mut, marginRight: 8 }}>{fmtD(e.date, { day: "2-digit", month: "short" })}</span>{e.n}
            </div>
            <Money v={e.a} sign />
          </div>
        ))}
      </div>
    </div>

    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Portföy Değeri Geçmişi</div>
      <div style={{ fontSize: 12, color: T.mut, marginBottom: 8 }}>
        Fiyat yenilendikçe (otomatik veya elle) o günün kaydı tutulur. Nakit geçmişi tutulmadığından bu net varlık değil, yalnızca portföy değeridir.
      </div>
      {valueHistory.length < 2 ? (
        <Empty>Yeterli fiyat geçmişi birikince burada bir grafik görünecek — fiyatları birkaç gün yeniledikçe dolar.</Empty>
      ) : (
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={valueHistory} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="gv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={T.pos} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={T.pos} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={T.line} strokeDasharray="2 6" vertical={false} />
              <XAxis dataKey="x" tick={{ fill: T.mut, fontSize: 10, fontFamily: T.mono }} tickLine={false} axisLine={{ stroke: T.line }} minTickGap={40} />
              <YAxis tick={{ fill: T.mut, fontSize: 10, fontFamily: T.mono }} tickLine={false} axisLine={false} width={52}
                tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
              <Tooltip contentStyle={{ background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 8, fontFamily: T.mono, fontSize: 12 }}
                labelStyle={{ color: T.mut }} formatter={(v: number) => [tl.format(v), "Portföy Değeri"]} />
              <Area type="monotone" dataKey="value" stroke={T.pos} strokeWidth={2} fill="url(#gv)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>

    <div style={css.card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Hesaplar</div>
          <div style={{ fontSize: 12, color: T.mut3, marginTop: 2 }}>bakiye güncelleme ve vadeli mevduat Hesaplar sekmesinde</div>
        </div>
        <button style={{ ...css.ghost, padding: "7px 13px" }} onClick={onGoAccounts}>Yönet →</button>
      </div>
      {data.accounts.length === 0
        ? <Empty>Henüz hesap yok. Hesaplar sekmesinden ekleyebilirsin.</Empty>
        : data.accounts.map((a, i) => (
          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 13, padding: "12px 0", borderBottom: i < data.accounts.length - 1 ? `1px solid ${T.line2}` : "none" }}>
            <span style={{ width: 34, height: 34, borderRadius: 10, background: T.panel2, display: "grid", placeItems: "center", fontSize: 14, color: "var(--type-nakit)" }}>◈</span>
            <div style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>{a.name}</div>
            <span style={{ ...css.mono, fontSize: 14, fontWeight: 500 }}>{m(a.balance)}</span>
          </div>
        ))}
    </div>

  </>);
}
