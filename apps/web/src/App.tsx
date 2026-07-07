import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid,
  PieChart, Pie, Cell,
} from "recharts";
import { api, AllData, AssetType, Card, CardTx, Loan, Recurring, Trade } from "./api";

/* ————— tasarım jetonları ————— */
const T = {
  bg: "#0D1322", panel: "#151C2E", panel2: "#1B2438", line: "#263149",
  text: "#E9EEF8", mut: "#8B96AC", pos: "#3FD68F", neg: "#FF6B5E", acc: "#F0B23F",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
  disp: "'Space Grotesk', system-ui, sans-serif",
};
const TYPE_COLORS: Record<string, string> = {
  Nakit: "#5B8DEF", BIST: "#F0B23F", FON: "#3FD68F", ALTIN: "#E8C468", DOVIZ: "#9B7BF3", KRIPTO: "#FF8A5E",
};
const TYPE_HINT: Record<AssetType, string> = {
  BIST: "THYAO, ASELS…", FON: "TEFAS kodu: AFT…", ALTIN: "GRAM, CEYREK, ONS, GUMUS",
  DOVIZ: "USD, EUR, GBP", KRIPTO: "BTC, ETH",
};

/* ————— yardımcılar ————— */
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const parseD = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const fmtD = (d: Date, o?: Intl.DateTimeFormatOptions) =>
  d.toLocaleDateString("tr-TR", o || { day: "numeric", month: "long", year: "numeric" });
const keyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tl = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });
const tl2 = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2 });
const num = (v: string | number) => { const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? 0 : n; };
const hits = (date: Date, payDay: number) => {
  const dim = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return date.getDate() === Math.min(payDay, dim);
};
const monthIndex = (d: Date) => d.getFullYear() * 12 + d.getMonth();
const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const recActiveOn = (r: Recurring, d: Date) => {
  const ym = ymOf(d);
  if (r.from_month && ym < r.from_month) return false;
  if (r.to_month && ym > r.to_month) return false;
  return true;
};
const loanPayDay = (l: Loan) => parseD(l.first_date).getDate();
const loanRemaining = (l: Loan, asOf: Date) => {
  const first = parseD(l.first_date);
  let paid = monthIndex(asOf) - monthIndex(first);
  if (paid >= 0 && asOf.getDate() >= Math.min(loanPayDay(l), new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0).getDate())) paid += 1;
  return Math.max(0, l.total - Math.max(0, paid));
};
const loanActiveOn = (l: Loan, d: Date) => {
  const mi = monthIndex(d) - monthIndex(parseD(l.first_date));
  return mi >= 0 && mi < l.total;
};

/* ————— kredi kartı ekstre matematiği ————— */
const clampDay = (y: number, m: number, day: number) =>
  new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
/** Harcamanın girdiği ilk kesim tarihi (kesim günü dahil) */
const firstCutoff = (purchase: Date, statementDay: number) => {
  let c = clampDay(purchase.getFullYear(), purchase.getMonth(), statementDay);
  if (purchase > c) c = clampDay(purchase.getFullYear(), purchase.getMonth() + 1, statementDay);
  return c;
};
/** Kesimden sonraki ilk son ödeme tarihi */
const dueOf = (cutoff: Date, dueDay: number) => {
  let d = clampDay(cutoff.getFullYear(), cutoff.getMonth(), dueDay);
  if (d <= cutoff) d = clampDay(cutoff.getFullYear(), cutoff.getMonth() + 1, dueDay);
  return d;
};
type Share = { due: Date; amount: number; idx: number; total: number };
/** Bir harcamanın taksit paylarını son ödeme tarihleriyle döndürür */
function txShares(tx: CardTx, card: Card): Share[] {
  const fc = firstCutoff(parseD(tx.date), card.statement_day);
  const per = tx.amount / tx.installments;
  const out: Share[] = [];
  for (let i = 0; i < tx.installments; i++) {
    const cut = clampDay(fc.getFullYear(), fc.getMonth() + i, card.statement_day);
    out.push({ due: dueOf(cut, card.due_day), amount: per, idx: i + 1, total: tx.installments });
  }
  return out;
}
type CardInfo = {
  card: Card; debt: number; nextDue: Date | null; nextAmount: number;
  statements: { due: Date; amount: number }[];
};
/** Kart başına: güncel borç (bugünden sonra vadesi gelen paylar), yaklaşan ekstreler */
function cardInfos(cards: Card[], txs: CardTx[], today: Date): CardInfo[] {
  return cards.map((card) => {
    const byDue = new Map<string, { due: Date; amount: number }>();
    let debt = 0;
    txs.filter((t) => t.card_id === card.id).forEach((t) => {
      txShares(t, card).forEach((s) => {
        if (s.due >= today) {
          debt += s.amount;
          const k = keyOf(s.due);
          if (!byDue.has(k)) byDue.set(k, { due: s.due, amount: 0 });
          byDue.get(k)!.amount += s.amount;
        }
      });
    });
    const statements = [...byDue.values()].sort((a, b) => +a.due - +b.due);
    return {
      card, debt,
      nextDue: statements[0]?.due ?? null,
      nextAmount: statements[0]?.amount ?? 0,
      statements,
    };
  });
}

/* ————— projeksiyon ————— */
type Day = { date: Date; k: string; net: number; bal: number; assets: number; total: number; ev: { n: string; a: number }[] };
function project(data: AllData, months: number): Day[] {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setMonth(end.getMonth() + months);
  const oneMap = new Map<string, { n: string; a: number }[]>();
  data.oneoffs.forEach((o) => {
    if (!oneMap.has(o.date)) oneMap.set(o.date, []);
    oneMap.get(o.date)!.push({ n: o.name, a: o.amount });
  });
  /* güncel fiyat haritası; geçmiş günlerde de bugünkü fiyatla değerlenir (fiyat geçmişi tutulmuyor) */
  const priceMap = new Map(data.prices.map((p) => [`${p.asset_type}:${p.symbol}`, p.price]));
  /* o güne dek elde tutulan miktarı çıkarmak için işlemleri tarihe göre sırala */
  const sortedTrades = [...data.trades].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const assetsOn = (dayKey: string) => {
    const qty = new Map<string, number>();
    for (const t of sortedTrades) {
      if (t.date > dayKey) break;
      const k = `${t.asset_type}:${t.symbol}`;
      qty.set(k, (qty.get(k) || 0) + (t.side === "ALIŞ" ? t.qty : -t.qty));
    }
    let v = 0;
    qty.forEach((q, k) => { const p = priceMap.get(k); if (p && q > 0) v += q * p; });
    return v;
  };
  let bal = data.accounts.reduce((s, a) => s + a.balance, 0);
  /* kart ekstre ödemeleri: son ödeme tarihine gider olarak düşer */
  const stmtMap = new Map<string, { n: string; a: number }[]>();
  cardInfos(data.cards, data.card_txs, start).forEach((ci) => {
    ci.statements.forEach((s) => {
      const k = keyOf(s.due);
      if (!stmtMap.has(k)) stmtMap.set(k, []);
      stmtMap.get(k)!.push({ n: `${ci.card.name} ekstresi`, a: -s.amount });
    });
  });
  const days: Day[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ev: { n: string; a: number }[] = [];
    data.recurring.forEach((r) => {
      if (recActiveOn(r, d) && hits(d, r.day)) ev.push({ n: r.name, a: r.kind === "income" ? r.amount : -r.amount });
    });
    data.loans.forEach((l) => {
      if (loanActiveOn(l, d) && hits(d, loanPayDay(l)))
        ev.push({ n: `${l.name} (kalan ${loanRemaining(l, d) })`, a: -l.amount });
    });
    (stmtMap.get(keyOf(d)) || []).forEach((e) => ev.push(e));
    (oneMap.get(keyOf(d)) || []).forEach((e) => ev.push(e));
    const net = ev.reduce((s, e) => s + e.a, 0);
    bal += net;
    const k = keyOf(d);
    const assets = assetsOn(k);
    days.push({ date: new Date(d), k, net, bal, assets, total: bal + assets, ev });
  }
  return days;
}

/* ————— portföy ————— */
type Position = {
  type: AssetType; sym: string; qty: number; avg: number; realized: number;
  cur: number | null; value: number | null; unreal: number | null; updated: string | null; source: string | null;
};
function positions(trades: Trade[], prices: AllData["prices"]): Position[] {
  const pm = new Map(prices.map((p) => [`${p.asset_type}:${p.symbol}`, p]));
  const by = new Map<string, { type: AssetType; sym: string; qty: number; cost: number; realized: number }>();
  [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id).forEach((t) => {
    const k = `${t.asset_type}:${t.symbol}`;
    if (!by.has(k)) by.set(k, { type: t.asset_type, sym: t.symbol, qty: 0, cost: 0, realized: 0 });
    const p = by.get(k)!;
    if (t.side === "ALIŞ") { p.qty += t.qty; p.cost += t.qty * t.price + (t.fee || 0); }
    else {
      const avg = p.qty > 0 ? p.cost / p.qty : 0;
      p.realized += t.qty * (t.price - avg) - (t.fee || 0);
      p.cost -= Math.min(t.qty, p.qty) * avg;
      p.qty -= t.qty;
    }
  });
  return [...by.values()].map((p) => {
    const price = pm.get(`${p.type}:${p.sym}`);
    const cur = price?.price ?? null;
    const avg = p.qty > 0 ? p.cost / p.qty : 0;
    return {
      type: p.type, sym: p.sym, qty: p.qty, avg, realized: p.realized, cur,
      value: cur != null ? p.qty * cur : null,
      unreal: cur != null && p.qty > 0 ? p.qty * (cur - avg) : null,
      updated: price?.updated_at ?? null,
      source: price?.source ?? null,
    };
  }).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
}

/* ————— UI parçaları ————— */
const css: Record<string, React.CSSProperties> = {
  card: { background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14, padding: 16 },
  label: { fontSize: 11, color: T.mut, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 },
  input: {
    width: "100%", boxSizing: "border-box", background: T.panel2, border: `1px solid ${T.line}`,
    borderRadius: 8, color: T.text, padding: "9px 10px", fontSize: 14, fontFamily: T.mono, outline: "none",
  },
  btn: {
    background: T.acc, color: "#1A1408", border: "none", borderRadius: 8, padding: "10px 16px",
    fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: T.disp,
  },
  ghost: {
    background: "none", color: T.mut, border: `1px solid ${T.line}`, borderRadius: 8, padding: "9px 14px",
    fontWeight: 500, fontSize: 13, cursor: "pointer", fontFamily: T.disp,
  },
  del: { background: "none", border: "none", color: T.mut, cursor: "pointer", fontSize: 16, padding: 4 },
  mono: { fontFamily: T.mono, fontVariantNumeric: "tabular-nums" },
};
const Field = ({ label, children, flex }: { label: string; children: React.ReactNode; flex?: number }) => (
  <div style={{ flex: flex || 1, minWidth: 120 }}><div style={css.label}>{label}</div>{children}</div>
);
const Money = ({ v, size = 14, sign, mut }: { v: number; size?: number; sign?: boolean; mut?: boolean }) => (
  <span style={{ ...css.mono, fontSize: size, color: mut ? T.mut : v > 0 ? (sign ? T.pos : T.text) : v < 0 ? T.neg : T.mut }}>
    {v > 0 && sign ? "+" : ""}{tl.format(v)}
  </span>
);
const Empty = ({ children }: { children: React.ReactNode }) => (
  <div style={{ color: T.mut, fontSize: 13, padding: "18px 0", textAlign: "center" }}>{children}</div>
);
const Row = ({ children, last }: { children: React.ReactNode; last?: boolean }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 0", borderBottom: last ? "none" : `1px solid ${T.line}` }}>
    {children}
  </div>
);

/* ————— ana uygulama ————— */
export default function App() {
  const [data, setData] = useState<AllData | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"ozet" | "nakit" | "butce" | "borc" | "kart" | "portfoy">("ozet");

  const reload = useCallback(() => api.all().then(setData).catch((e) => setErr(String(e))), []);
  useEffect(() => { reload(); }, [reload]);

  const days = useMemo(() => (data ? project(data, Number(data.settings.horizon || 6)) : []), [data]);
  const pos = useMemo(() => (data ? positions(data.trades, data.prices) : []), [data]);
  const cash = useMemo(() => (data ? data.accounts.reduce((s, a) => s + a.balance, 0) : 0), [data]);
  const portValue = useMemo(() => pos.reduce((s, p) => s + (p.value ?? 0), 0), [pos]);
  const cardDebt = useMemo(() => {
    if (!data) return 0;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return cardInfos(data.cards, data.card_txs, t).reduce((s, c) => s + c.debt, 0);
  }, [data]);

  if (err) return <Center>API'ye ulaşılamadı: {err}. Sunucu çalışıyor mu? (npm run dev)</Center>;
  if (!data) return <Center>Yükleniyor…</Center>;

  const tabs: [typeof tab, string][] = [
    ["ozet", "Özet"], ["nakit", "Nakit Akışı"], ["butce", "Bütçe"], ["borc", "Borçlar"],
    ["kart", "Kartlar"], ["portfoy", "Portföy"],
  ];

  return (
    <div style={{ background: T.bg, minHeight: "100vh", color: T.text, fontFamily: T.disp }}>
      <style>{`
        input:focus,select:focus{border-color:${T.acc}!important}
        button:active{transform:scale(0.97)}
        ::-webkit-scrollbar{height:6px;width:6px} ::-webkit-scrollbar-thumb{background:${T.line};border-radius:3px}
      `}</style>
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: `${T.bg}F2`, backdropFilter: "blur(8px)", borderBottom: `1px solid ${T.line}` }}>
        <div style={{ maxWidth: 920, margin: "0 auto", padding: "14px 16px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontSize: 11, color: T.mut, letterSpacing: "0.1em" }}>NET VARLIK</div>
              <div style={{ ...css.mono, fontSize: 28, fontWeight: 600 }}>{tl.format(cash + portValue - cardDebt)}</div>
            </div>
            <div style={{ textAlign: "right", fontSize: 12, color: T.mut }}>
              nakit <span style={{ ...css.mono, color: T.text }}>{tl.format(cash)}</span>
              {" · "}portföy <span style={{ ...css.mono, color: T.text }}>{tl.format(portValue)}</span>
              {cardDebt > 0 && <>{" · "}kart borcu <span style={{ ...css.mono, color: T.neg }}>−{tl.format(cardDebt)}</span></>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 10, overflowX: "auto" }}>
            {tabs.map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} style={{
                background: "none", border: "none", cursor: "pointer", padding: "10px 12px", fontSize: 14,
                fontFamily: T.disp, fontWeight: tab === k ? 700 : 400, whiteSpace: "nowrap",
                color: tab === k ? T.acc : T.mut, borderBottom: `2px solid ${tab === k ? T.acc : "transparent"}`,
              }}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 920, margin: "0 auto", padding: 16, display: "grid", gap: 14 }}>
        {tab === "ozet" && <Ozet data={data} days={days} pos={pos} cash={cash} portValue={portValue} reload={reload} />}
        {tab === "nakit" && <Nakit days={days} />}
        {tab === "butce" && <Butce data={data} reload={reload} />}
        {tab === "borc" && <Borclar data={data} reload={reload} />}
        {tab === "kart" && <Kartlar data={data} reload={reload} />}
        {tab === "portfoy" && <Portfoy data={data} pos={pos} reload={reload} />}
      </div>
    </div>
  );
}
const Center = ({ children }: { children: React.ReactNode }) => (
  <div style={{ background: T.bg, minHeight: "100vh", color: T.mut, display: "grid", placeItems: "center", fontFamily: T.disp, padding: 24, textAlign: "center" }}>
    {children}
  </div>
);

/* ————— ÖZET ————— */
function Ozet({ data, days, pos, cash, portValue, reload }: {
  data: AllData; days: Day[]; pos: Position[]; cash: number; portValue: number; reload: () => void;
}) {
  const minDay = days.reduce((m, d) => (d.bal < m.bal ? d : m), days[0] ?? { bal: 0, date: new Date() } as Day);
  const negDays = days.filter((d) => d.bal < 0).length;
  const chart = days
    .filter((_, i) => i % Math.max(1, Math.floor(days.length / 240)) === 0)
    .map((d) => ({ x: fmtD(d.date, { day: "numeric", month: "short" }), bal: Math.round(d.bal) }));
  const upcoming = days.filter((d) => d.ev.length).slice(0, 20)
    .flatMap((d) => d.ev.map((e) => ({ ...e, date: d.date }))).slice(0, 6);
  const alloc = [
    { name: "Nakit", value: Math.max(0, cash) },
    ...Object.entries(pos.reduce((m, p) => {
      if (p.value) m[p.type] = (m[p.type] || 0) + p.value; return m;
    }, {} as Record<string, number>)).map(([name, value]) => ({ name, value })),
  ].filter((a) => a.value > 0);

  return (<>
    <div style={{ ...css.card, paddingBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Nakit Haritası</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {days.length > 0 && (
            <div style={{
              background: minDay.bal < 0 ? "#3A1712" : T.panel2, border: `1px solid ${minDay.bal < 0 ? T.neg : T.line}`,
              borderRadius: 20, padding: "4px 12px", fontSize: 12, ...css.mono,
            }}>
              en düşük: {fmtD(minDay.date, { day: "numeric", month: "short" })} ·{" "}
              <span style={{ color: minDay.bal < 0 ? T.neg : T.pos }}>{tl.format(Math.round(minDay.bal))}</span>
            </div>
          )}
          <select style={{ ...css.input, width: 90, padding: "5px 8px", fontSize: 12 }} value={data.settings.horizon || "6"}
            onChange={async (e) => { await api.put("settings", { horizon: e.target.value }); reload(); }}>
            {[3, 6, 12, 24].map((m) => <option key={m} value={m}>{m} ay</option>)}
          </select>
        </div>
      </div>
      {negDays > 0 && <div style={{ color: T.neg, fontSize: 12, marginTop: 6 }}>⚠ {negDays} gün eksi bakiyede görünüyorsunuz.</div>}
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
              labelStyle={{ color: T.mut }} formatter={(v: number) => [tl.format(v), "Bakiye"]} />
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
        {upcoming.length === 0 ? <Empty>Bütçe sekmesinden gelir/gider ekleyin.</Empty> : upcoming.map((e, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: i < upcoming.length - 1 ? `1px solid ${T.line}` : "none" }}>
            <div style={{ fontSize: 13 }}>
              <span style={{ ...css.mono, color: T.mut, marginRight: 8 }}>{fmtD(e.date, { day: "2-digit", month: "short" })}</span>{e.n}
            </div>
            <Money v={e.a} sign />
          </div>
        ))}
      </div>
    </div>
  </>);
}

/* ————— NAKİT AKIŞI (liste + takvim) ————— */
function Nakit({ days }: { days: Day[] }) {
  const [view, setView] = useState<"liste" | "takvim">("takvim");
  const months = useMemo(() => {
    const m = new Map<string, { label: string; y: number; mo: number; days: Day[] }>();
    days.forEach((d) => {
      const k = `${d.date.getFullYear()}-${d.date.getMonth()}`;
      if (!m.has(k)) m.set(k, { label: fmtD(d.date, { month: "long", year: "numeric" }), y: d.date.getFullYear(), mo: d.date.getMonth(), days: [] });
      m.get(k)!.days.push(d);
    });
    return [...m.values()];
  }, [days]);
  const [mi, setMi] = useState(0);
  const cur = months[Math.min(mi, months.length - 1)];
  if (!cur) return <div style={css.card}><Empty>Projeksiyon boş.</Empty></div>;

  return (
    <div style={css.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
          {months.map((m, i) => (
            <button key={i} onClick={() => setMi(i)} style={{
              background: i === mi ? T.acc : T.panel2, color: i === mi ? "#1A1408" : T.mut,
              border: `1px solid ${i === mi ? T.acc : T.line}`, borderRadius: 20, padding: "6px 12px",
              fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", fontFamily: T.disp, fontWeight: i === mi ? 700 : 400,
            }}>{m.label}</button>
          ))}
        </div>
        <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: `1px solid ${T.line}` }}>
          {(["takvim", "liste"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: "6px 12px", border: "none", cursor: "pointer", fontSize: 12, fontFamily: T.disp, fontWeight: view === v ? 700 : 400,
              background: view === v ? T.panel2 : "transparent", color: view === v ? T.acc : T.mut, textTransform: "capitalize",
            }}>{v}</button>
          ))}
        </div>
      </div>
      {view === "takvim" ? <Takvim month={cur} /> : <Liste days={cur.days} />}
    </div>
  );
}

function Liste({ days }: { days: Day[] }) {
  const eventDays = days.filter((d) => d.ev.length);
  const last = days[days.length - 1];
  return (<>
    {eventDays.length === 0 && <Empty>Bu ayda planlı hareket yok.</Empty>}
    {eventDays.map((d) => (
      <div key={d.k} style={{ padding: "10px 0", borderBottom: `1px solid ${T.line}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ ...css.mono, fontSize: 13, color: T.acc }}>{fmtD(d.date, { day: "2-digit", month: "short", weekday: "short" })}</div>
          <div style={{ fontSize: 11, color: T.mut }}>
            nakit <span style={{ ...css.mono, color: d.bal < 0 ? T.neg : T.text, fontSize: 13 }}>{tl.format(Math.round(d.bal))}</span>
            {d.assets > 0 && <> · varlık <span style={{ ...css.mono, color: T.text, fontSize: 13 }}>{tl.format(Math.round(d.total))}</span></>}
          </div>
        </div>
        {d.ev.map((e, j) => (
          <div key={j} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 4 }}>
            <span style={{ color: T.mut }}>{e.n}</span><Money v={e.a} sign />
          </div>
        ))}
      </div>
    ))}
    {last && (
      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Ay sonu nakit</span>
        <span style={{ ...css.mono, fontWeight: 600, fontSize: 15, color: last.bal < 0 ? T.neg : T.pos }}>{tl.format(Math.round(last.bal))}</span>
      </div>
    )}
  </>);
}

function Takvim({ month }: { month: { y: number; mo: number; days: Day[] } }) {
  const [sel, setSel] = useState<Day | null>(null);
  const byDate = new Map(month.days.map((d) => [d.date.getDate(), d]));
  const first = new Date(month.y, month.mo, 1);
  const daysInMonth = new Date(month.y, month.mo + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // Pazartesi=0
  const cells: (Day | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let dd = 1; dd <= daysInMonth; dd++) cells.push(byDate.get(dd) ?? null);
  const wd = ["Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pz"];
  const kBrief = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)));

  return (<>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
      {wd.map((w) => <div key={w} style={{ textAlign: "center", fontSize: 11, color: T.mut, padding: "2px 0" }}>{w}</div>)}
      {cells.map((d, i) => {
        if (!d) return <div key={i} />;
        const hasEv = d.ev.length > 0;
        const neg = d.bal < 0;
        const isSel = sel?.k === d.k;
        return (
          <button key={i} onClick={() => setSel(isSel ? null : d)} style={{
            aspectRatio: "1", border: `1px solid ${isSel ? T.acc : neg ? T.neg : T.line}`, borderRadius: 8,
            background: neg ? "#2A1310" : hasEv ? T.panel2 : "transparent", cursor: "pointer",
            display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "4px 5px", overflow: "hidden",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: T.mut }}>{d.date.getDate()}</span>
              {hasEv && <span style={{ width: 5, height: 5, borderRadius: 3, background: T.acc }} />}
            </div>
            <div style={{ textAlign: "right", lineHeight: 1.15 }}>
              <div style={{ ...css.mono, fontSize: 11, color: neg ? T.neg : T.text }}>{kBrief(d.bal)}</div>
              {d.assets > 0 && <div style={{ ...css.mono, fontSize: 9, color: T.mut }}>Σ{kBrief(d.total)}</div>}
            </div>
          </button>
        );
      })}
    </div>
    <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 11, color: T.mut, flexWrap: "wrap" }}>
      <span><span style={{ ...css.mono, color: T.text }}>sayı</span> = gün sonu nakit</span>
      <span><span style={{ ...css.mono, color: T.mut }}>Σ</span> = nakit + portföy</span>
      <span><span style={{ color: T.neg }}>kırmızı</span> = eksi bakiye</span>
    </div>
    {sel && (
      <div style={{ background: T.panel2, borderRadius: 10, padding: 12, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <div style={{ fontWeight: 700 }}>{fmtD(sel.date, { day: "numeric", month: "long", weekday: "long" })}</div>
        </div>
        <div style={{ display: "flex", gap: 16, marginBottom: sel.ev.length ? 8 : 0, flexWrap: "wrap" }}>
          <div><div style={css.label}>gün sonu nakit</div><span style={{ ...css.mono, fontSize: 16, color: sel.bal < 0 ? T.neg : T.pos }}>{tl.format(Math.round(sel.bal))}</span></div>
          <div><div style={css.label}>portföy</div><span style={{ ...css.mono, fontSize: 16, color: T.text }}>{tl.format(Math.round(sel.assets))}</span></div>
          <div><div style={css.label}>toplam varlık</div><span style={{ ...css.mono, fontSize: 16, color: T.acc }}>{tl.format(Math.round(sel.total))}</span></div>
        </div>
        {sel.ev.map((e, j) => (
          <div key={j} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 4 }}>
            <span style={{ color: T.mut }}>{e.n}</span><Money v={e.a} sign />
          </div>
        ))}
      </div>
    )}
  </>);
}

/* ————— BÜTÇE (hesaplar + gelir/gider + tek seferlik) ————— */
function Butce({ data, reload }: { data: AllData; reload: () => void }) {
  const [acc, setAcc] = useState({ name: "", balance: "" });
  const [rec, setRec] = useState({ kind: "income" as Recurring["kind"], name: "", amount: "", day: "", from_month: "", to_month: "" });
  const [changing, setChanging] = useState<Recurring | null>(null);
  const [chVal, setChVal] = useState({ amount: "", from_month: "" });
  const [one, setOne] = useState({ name: "", amount: "", date: todayStr(), type: "gider" });
  const recOk = rec.name && num(rec.amount) > 0 && +rec.day >= 1 && +rec.day <= 31;
  const oneOk = one.name && num(one.amount) > 0 && one.date;
  const curYm = ymOf(new Date());
  const prevYm = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    return ymOf(d);
  };
  const fmtYm = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("tr-TR", { month: "short", year: "numeric" });
  };
  /* "2026-8", "2026.08", "2026/8" → "2026-08"; geçersizse null (string karşılaştırması bozulmasın) */
  const normYm = (s: string): string | null => {
    const m = s.trim().match(/^(\d{4})[-./](\d{1,2})$/);
    if (!m) return null;
    const mo = Number(m[2]);
    return mo >= 1 && mo <= 12 ? `${m[1]}-${String(mo).padStart(2, "0")}` : null;
  };
  const chYm = normYm(chVal.from_month || curYm);
  /* "Değiştir": eski kaydı yeni tutarın geçerli olacağı aydan bir önceki ayda bitir, yeni değerle yeni kayıt aç */
  const applyChange = async (r: Recurring) => {
    if (!chYm) return; // geçersiz ay: buton zaten kapalı
    await api.put(`recurring/${r.id}`, { to_month: prevYm(chYm) });
    await api.post("recurring", {
      kind: r.kind, name: r.name, amount: num(chVal.amount), day: r.day,
      from_month: chYm, to_month: null,
    });
    setChanging(null); setChVal({ amount: "", from_month: "" }); reload();
  };

  return (<>
    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Hesaplar (Nakit)</div>
      <div style={{ fontSize: 12, color: T.mut, marginBottom: 8 }}>Banka, cüzdan… Bakiyeye tıklayıp güncelleyebilirsin; toplamı projeksiyonun başlangıcıdır.</div>
      {data.accounts.length === 0 && <Empty>Henüz hesap yok.</Empty>}
      {data.accounts.map((a, i) => (
        <Row key={a.id} last={i === data.accounts.length - 1}>
          <div style={{ flex: 1, fontSize: 14 }}>{a.name}</div>
          <input style={{ ...css.input, width: 130, textAlign: "right" }} inputMode="decimal" defaultValue={a.balance}
            onBlur={async (e) => { const v = num(e.target.value); if (v !== a.balance) { await api.put(`accounts/${a.id}`, { balance: v }); reload(); } }} />
          <button style={css.del} onClick={async () => { await api.del("accounts", a.id); reload(); }}>✕</button>
        </Row>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <Field label="Hesap adı" flex={2}><input style={css.input} value={acc.name} placeholder="örn. Vakıfbank" onChange={(e) => setAcc({ ...acc, name: e.target.value })} /></Field>
        <Field label="Bakiye (₺)"><input style={css.input} inputMode="decimal" value={acc.balance} onChange={(e) => setAcc({ ...acc, balance: e.target.value })} /></Field>
      </div>
      <button style={{ ...css.btn, marginTop: 10, opacity: acc.name ? 1 : 0.4 }} disabled={!acc.name}
        onClick={async () => { await api.post("accounts", { name: acc.name, balance: num(acc.balance) }); setAcc({ name: "", balance: "" }); reload(); }}>
        Hesap Ekle
      </button>
    </div>

    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Düzenli Gelir & Giderler</div>
      {data.recurring.length === 0 && <Empty>Maaş, kira, faturalar… her ay tekrarlayan kalemler.</Empty>}
      {data.recurring.map((r, i) => {
        const period = (r.from_month || r.to_month)
          ? `${r.from_month ? fmtYm(r.from_month) : "baştan"} – ${r.to_month ? fmtYm(r.to_month) : "süresiz"}`
          : "süresiz";
        const ended = r.to_month && r.to_month < curYm;
        return (
          <div key={r.id} style={{ padding: "9px 0", borderBottom: i === data.recurring.length - 1 ? "none" : `1px solid ${T.line}`, opacity: ended ? 0.5 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14 }}>{r.name} {ended && <span style={{ fontSize: 11, color: T.mut }}>· bitti</span>}</div>
                <div style={{ fontSize: 11, color: T.mut }}>her ayın {r.day}. günü · {period}</div>
              </div>
              <Money v={r.kind === "income" ? r.amount : -r.amount} sign />
              <button style={{ ...css.ghost, padding: "5px 10px", fontSize: 12 }}
                onClick={() => { setChanging(changing?.id === r.id ? null : r); setChVal({ amount: String(r.amount), from_month: curYm }); }}>
                Değiştir
              </button>
              <button style={css.del} onClick={async () => { await api.del("recurring", r.id); reload(); }}>✕</button>
            </div>
            {changing?.id === r.id && (
              <div style={{ background: T.panel2, borderRadius: 8, padding: 10, marginTop: 8 }}>
                <div style={{ fontSize: 12, color: T.mut, marginBottom: 8 }}>
                  Yeni tutar girilen aydan itibaren geçerli olur; eski tutar bir önceki aya kadar geçmiş projeksiyonda korunur.
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <Field label="Yeni tutar (₺)"><input style={css.input} inputMode="decimal" value={chVal.amount} onChange={(e) => setChVal({ ...chVal, amount: e.target.value })} /></Field>
                  <Field label="Geçerli ay (YYYY-AA)"><input style={css.input} placeholder={curYm} value={chVal.from_month} onChange={(e) => setChVal({ ...chVal, from_month: e.target.value })} /></Field>
                  <button style={{ ...css.btn, opacity: num(chVal.amount) > 0 && chYm ? 1 : 0.4 }} disabled={!(num(chVal.amount) > 0 && chYm)} onClick={() => applyChange(r)}>Uygula</button>
                </div>
                {chVal.from_month && !chYm && <div style={{ fontSize: 11, color: T.neg, marginTop: 6 }}>Ay biçimi YYYY-AA olmalı, örn. {curYm}</div>}
              </div>
            )}
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <Field label="Tür">
          <select style={css.input} value={rec.kind} onChange={(e) => setRec({ ...rec, kind: e.target.value as Recurring["kind"] })}>
            <option value="income">Gelir</option><option value="expense">Gider</option>
          </select>
        </Field>
        <Field label="Ad" flex={2}><input style={css.input} value={rec.name} placeholder="örn. Maaş" onChange={(e) => setRec({ ...rec, name: e.target.value })} /></Field>
        <Field label="Tutar (₺)"><input style={css.input} inputMode="decimal" value={rec.amount} onChange={(e) => setRec({ ...rec, amount: e.target.value })} /></Field>
        <Field label="Gün (1-31)"><input style={css.input} inputMode="numeric" value={rec.day} onChange={(e) => setRec({ ...rec, day: e.target.value })} /></Field>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <Field label="Başlangıç ayı (ops.)"><input style={css.input} placeholder="YYYY-AA, boş=baştan" value={rec.from_month} onChange={(e) => setRec({ ...rec, from_month: e.target.value })} /></Field>
        <Field label="Bitiş ayı (ops.)"><input style={css.input} placeholder="YYYY-AA, boş=süresiz" value={rec.to_month} onChange={(e) => setRec({ ...rec, to_month: e.target.value })} /></Field>
      </div>
      <button style={{ ...css.btn, marginTop: 10, opacity: recOk ? 1 : 0.4 }} disabled={!recOk}
        onClick={async () => {
          await api.post("recurring", {
            kind: rec.kind, name: rec.name, amount: num(rec.amount), day: +rec.day,
            from_month: rec.from_month.trim() || null, to_month: rec.to_month.trim() || null,
          });
          setRec({ kind: rec.kind, name: "", amount: "", day: "", from_month: "", to_month: "" }); reload();
        }}>Ekle</button>
    </div>

    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Tek Seferlik Kalemler</div>
      {data.oneoffs.length === 0 && <Empty>Tatil, prim, vergi iadesi gibi tek seferlik gelir/giderler.</Empty>}
      {data.oneoffs.map((o, i) => (
        <Row key={o.id} last={i === data.oneoffs.length - 1}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14 }}>{o.name}</div>
            <div style={{ fontSize: 11, color: T.mut, ...css.mono }}>{fmtD(parseD(o.date), { day: "2-digit", month: "short", year: "numeric" })}</div>
          </div>
          <Money v={o.amount} sign />
          <button style={css.del} onClick={async () => { await api.del("oneoffs", o.id); reload(); }}>✕</button>
        </Row>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <Field label="Ad" flex={2}><input style={css.input} value={one.name} placeholder="örn. Tatil" onChange={(e) => setOne({ ...one, name: e.target.value })} /></Field>
        <Field label="Tutar (₺)"><input style={css.input} inputMode="decimal" value={one.amount} onChange={(e) => setOne({ ...one, amount: e.target.value })} /></Field>
        <Field label="Tarih"><input type="date" style={css.input} value={one.date} onChange={(e) => setOne({ ...one, date: e.target.value })} /></Field>
        <Field label="Tür">
          <select style={css.input} value={one.type} onChange={(e) => setOne({ ...one, type: e.target.value })}>
            <option value="gider">Gider (−)</option><option value="gelir">Gelir (+)</option>
          </select>
        </Field>
      </div>
      <button style={{ ...css.btn, marginTop: 10, opacity: oneOk ? 1 : 0.4 }} disabled={!oneOk}
        onClick={async () => {
          await api.post("oneoffs", { name: one.name, date: one.date, amount: (one.type === "gider" ? -1 : 1) * num(one.amount) });
          setOne({ name: "", amount: "", date: todayStr(), type: "gider" }); reload();
        }}>Ekle</button>
    </div>
  </>);
}

/* ————— BORÇLAR ————— */
function Borclar({ data, reload }: { data: AllData; reload: () => void }) {
  const [f, setF] = useState({ name: "", amount: "", first_date: todayStr(), total: "" });
  const ok = f.name && num(f.amount) > 0 && f.first_date && +f.total >= 1;
  const now = new Date();
  const totalDebt = data.loans.reduce((s, l) => s + l.amount * loanRemaining(l, now), 0);
  return (
    <div style={css.card}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Kredi & Taksitler</div>
        <div style={{ fontSize: 12, color: T.mut }}>toplam kalan borç <span style={{ ...css.mono, color: T.neg }}>{tl.format(totalDebt)}</span></div>
      </div>
      <div style={{ fontSize: 12, color: T.mut, margin: "4px 0 8px" }}>İlk taksit tarihi + toplam taksit sayısını gir; kalan taksit her ay otomatik azalır, bitince projeksiyondan düşer.</div>
      {data.loans.length === 0 && <Empty>Kredi, kredi kartı taksidi veya senet ekleyin.</Empty>}
      {data.loans.map((l, i) => {
        const rem = loanRemaining(l, now);
        return (
          <Row key={l.id} last={i === data.loans.length - 1}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14 }}>{l.name} {rem === 0 && <span style={{ fontSize: 11, color: T.pos }}>· bitti</span>}</div>
              <div style={{ fontSize: 11, color: T.mut }}>
                ayın {loanPayDay(l)}. günü · <b style={{ color: T.acc }}>{rem}</b>/{l.total} taksit kaldı · kalan{" "}
                <span style={css.mono}>{tl.format(l.amount * rem)}</span>
              </div>
            </div>
            <span style={{ ...css.mono, color: rem ? T.neg : T.mut, fontSize: 14 }}>{tl.format(l.amount)}/ay</span>
            <button style={css.del} onClick={async () => { await api.del("loans", l.id); reload(); }}>✕</button>
          </Row>
        );
      })}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <Field label="Ad" flex={2}><input style={css.input} value={f.name} placeholder="örn. İhtiyaç kredisi" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Aylık taksit (₺)"><input style={css.input} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="İlk taksit tarihi"><input type="date" style={css.input} value={f.first_date} onChange={(e) => setF({ ...f, first_date: e.target.value })} /></Field>
        <Field label="Toplam taksit"><input style={css.input} inputMode="numeric" value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} /></Field>
      </div>
      <button style={{ ...css.btn, marginTop: 10, opacity: ok ? 1 : 0.4 }} disabled={!ok}
        onClick={async () => {
          await api.post("loans", { name: f.name, amount: num(f.amount), first_date: f.first_date, total: +f.total });
          setF({ name: "", amount: "", first_date: todayStr(), total: "" }); reload();
        }}>Ekle</button>
    </div>
  );
}

/* ————— KARTLAR ————— */
function Kartlar({ data, reload }: { data: AllData; reload: () => void }) {
  const [cf, setCf] = useState({ name: "", limit_amount: "", statement_day: "", due_day: "" });
  const [tf, setTf] = useState({ card_id: 0, date: todayStr(), name: "", amount: "", installments: "1" });
  const cardOk = cf.name && +cf.statement_day >= 1 && +cf.statement_day <= 31 && +cf.due_day >= 1 && +cf.due_day <= 31;
  const txOk = tf.card_id > 0 && tf.name && num(tf.amount) > 0 && tf.date && +tf.installments >= 1;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const infos = cardInfos(data.cards, data.card_txs, today);
  const totalDebt = infos.reduce((s, c) => s + c.debt, 0);

  return (<>
    <div style={css.card}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Kredi Kartları</div>
        {totalDebt > 0 && (
          <div style={{ fontSize: 12, color: T.mut }}>toplam kart borcu <span style={{ ...css.mono, color: T.neg }}>{tl.format(totalDebt)}</span></div>
        )}
      </div>
      <div style={{ fontSize: 12, color: T.mut, margin: "4px 0 8px" }}>
        Harcamalar kesim gününe göre ekstreye dağılır; her ekstre son ödeme tarihinde nakit akışına gider olarak düşer. Geçmiş vadeli ekstreler ödendi varsayılır.
      </div>
      {infos.length === 0 && <Empty>Henüz kart yok. Aşağıdan ekleyin.</Empty>}
      {infos.map((ci, i) => {
        const usage = ci.card.limit_amount > 0 ? Math.min(1, ci.debt / ci.card.limit_amount) : 0;
        return (
          <div key={ci.card.id} style={{ padding: "12px 0", borderBottom: i < infos.length - 1 ? `1px solid ${T.line}` : "none" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{ci.card.name}</span>
                <span style={{ fontSize: 11, color: T.mut, marginLeft: 8 }}>kesim {ci.card.statement_day} · son ödeme {ci.card.due_day}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ ...css.mono, fontSize: 14, color: ci.debt > 0 ? T.neg : T.mut }}>{tl.format(Math.round(ci.debt))}</span>
                <button style={css.del} onClick={async () => { await api.del("cards", ci.card.id); reload(); }}>✕</button>
              </div>
            </div>
            {ci.card.limit_amount > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ height: 6, background: T.panel2, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${usage * 100}%`, height: "100%", background: usage > 0.8 ? T.neg : usage > 0.5 ? T.acc : T.pos }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: T.mut, marginTop: 4 }}>
                  <span>kullanılabilir <span style={css.mono}>{tl.format(Math.round(ci.card.limit_amount - ci.debt))}</span></span>
                  <span>limit <span style={css.mono}>{tl.format(ci.card.limit_amount)}</span></span>
                </div>
              </div>
            )}
            {ci.statements.slice(0, 3).map((s, j) => (
              <div key={j} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: j === 0 ? 8 : 4 }}>
                <span style={{ color: T.mut }}>
                  {j === 0 ? "sıradaki ekstre" : "sonraki"} · <span style={css.mono}>{fmtD(s.due, { day: "2-digit", month: "short" })}</span>
                </span>
                <span style={{ ...css.mono, color: T.text }}>{tl.format(Math.round(s.amount))}</span>
              </div>
            ))}
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <Field label="Kart adı" flex={2}><input style={css.input} value={cf.name} placeholder="örn. Yapı Kredi" onChange={(e) => setCf({ ...cf, name: e.target.value })} /></Field>
        <Field label="Limit (₺)"><input style={css.input} inputMode="decimal" value={cf.limit_amount} onChange={(e) => setCf({ ...cf, limit_amount: e.target.value })} /></Field>
        <Field label="Kesim günü"><input style={css.input} inputMode="numeric" value={cf.statement_day} onChange={(e) => setCf({ ...cf, statement_day: e.target.value })} /></Field>
        <Field label="Son ödeme günü"><input style={css.input} inputMode="numeric" value={cf.due_day} onChange={(e) => setCf({ ...cf, due_day: e.target.value })} /></Field>
      </div>
      <button style={{ ...css.btn, marginTop: 10, opacity: cardOk ? 1 : 0.4 }} disabled={!cardOk}
        onClick={async () => {
          await api.post("cards", { name: cf.name, limit_amount: num(cf.limit_amount), statement_day: +cf.statement_day, due_day: +cf.due_day });
          setCf({ name: "", limit_amount: "", statement_day: "", due_day: "" }); reload();
        }}>Kart Ekle</button>
    </div>

    {data.cards.length > 0 && (
      <div style={css.card}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Kart Harcaması Ekle</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Field label="Kart">
            <select style={css.input} value={tf.card_id} onChange={(e) => setTf({ ...tf, card_id: +e.target.value })}>
              <option value={0}>Seç…</option>
              {data.cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Tarih"><input type="date" style={css.input} value={tf.date} onChange={(e) => setTf({ ...tf, date: e.target.value })} /></Field>
          <Field label="Açıklama" flex={2}><input style={css.input} value={tf.name} placeholder="örn. Telefon" onChange={(e) => setTf({ ...tf, name: e.target.value })} /></Field>
          <Field label="Toplam tutar (₺)"><input style={css.input} inputMode="decimal" value={tf.amount} onChange={(e) => setTf({ ...tf, amount: e.target.value })} /></Field>
          <Field label="Taksit"><input style={css.input} inputMode="numeric" value={tf.installments} onChange={(e) => setTf({ ...tf, installments: e.target.value })} /></Field>
        </div>
        {txOk && +tf.installments > 1 && (
          <div style={{ fontSize: 12, color: T.mut, marginTop: 8 }}>
            aylık pay: <span style={{ ...css.mono, color: T.text }}>{tl2.format(num(tf.amount) / +tf.installments)}</span> × {tf.installments}
          </div>
        )}
        <button style={{ ...css.btn, marginTop: 10, opacity: txOk ? 1 : 0.4 }} disabled={!txOk}
          onClick={async () => {
            await api.post("cardtxs", { card_id: tf.card_id, date: tf.date, name: tf.name, amount: num(tf.amount), installments: +tf.installments });
            setTf({ ...tf, name: "", amount: "", installments: "1" }); reload();
          }}>Harcamayı Kaydet</button>
      </div>
    )}

    {data.card_txs.length > 0 && (
      <div style={css.card}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Kart Harcamaları</div>
        {[...data.card_txs].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).map((t, i, arr) => {
          const card = data.cards.find((c) => c.id === t.card_id);
          const shares = card ? txShares(t, card) : [];
          const remaining = shares.filter((s) => s.due >= today);
          return (
            <Row key={t.id} last={i === arr.length - 1}>
              <span style={{ ...css.mono, fontSize: 12, color: T.mut, width: 74 }}>{fmtD(parseD(t.date), { day: "2-digit", month: "short", year: "2-digit" })}</span>
              <span style={{ flex: 1, fontSize: 13 }}>
                {t.name} <span style={{ color: T.mut, fontSize: 11 }}>{card?.name}</span>
                {t.installments > 1 && (
                  <span style={{ fontSize: 11, color: T.acc, marginLeft: 6 }}>
                    {t.installments - remaining.length}/{t.installments} ödendi
                  </span>
                )}
              </span>
              <span style={{ ...css.mono, fontSize: 13 }}>{tl.format(Math.round(t.amount))}</span>
              <button style={css.del} onClick={async () => { await api.del("cardtxs", t.id); reload(); }}>✕</button>
            </Row>
          );
        })}
      </div>
    )}
  </>);
}

/* ————— PORTFÖY ————— */
function Portfoy({ data, pos, reload }: { data: AllData; pos: Position[]; reload: () => void }) {
  const [f, setF] = useState({
    date: todayStr(), asset_type: "BIST" as AssetType, symbol: "", side: "ALIŞ" as Trade["side"],
    qty: "", price: "", fee: "",
  });
  const [busy, setBusy] = useState(false);
  const ok = f.symbol && num(f.qty) > 0 && num(f.price) > 0 && f.date;
  const totUnreal = pos.reduce((s, p) => s + (p.unreal ?? 0), 0);
  const totReal = pos.reduce((s, p) => s + p.realized, 0);
  const lastUpdate = data.prices.reduce((m, p) => (p.updated_at > m ? p.updated_at : m), "");

  const refresh = async () => {
    setBusy(true);
    try { await api.refreshPrices(); await reload(); } finally { setBusy(false); }
  };

  return (<>
    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Yeni İşlem</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Field label="Tarih"><input type="date" style={css.input} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Varlık türü">
          <select style={css.input} value={f.asset_type} onChange={(e) => setF({ ...f, asset_type: e.target.value as AssetType, symbol: "" })}>
            {(["BIST", "FON", "ALTIN", "DOVIZ", "KRIPTO"] as AssetType[]).map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Sembol">
          <input style={{ ...css.input, textTransform: "uppercase" }} placeholder={TYPE_HINT[f.asset_type]}
            value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="İşlem">
          <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: `1px solid ${T.line}` }}>
            {(["ALIŞ", "SATIŞ"] as const).map((s) => (
              <button key={s} onClick={() => setF({ ...f, side: s })} style={{
                flex: 1, padding: "9px 0", border: "none", cursor: "pointer", fontWeight: 700, fontSize: 12, fontFamily: T.disp,
                background: f.side === s ? (s === "ALIŞ" ? T.pos : T.neg) : T.panel2,
                color: f.side === s ? "#0D1322" : T.mut,
              }}>{s}</button>
            ))}
          </div>
        </Field>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <Field label="Adet / Miktar"><input style={css.input} inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
        <Field label="Birim fiyat (₺)"><input style={css.input} inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        <Field label="Komisyon (₺)"><input style={css.input} inputMode="decimal" value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} /></Field>
      </div>
      {ok && (
        <div style={{ fontSize: 12, color: T.mut, marginTop: 8 }}>
          İşlem tutarı: <span style={{ ...css.mono, color: T.text }}>{tl2.format(num(f.qty) * num(f.price))}</span>
        </div>
      )}
      <button style={{ ...css.btn, marginTop: 10, opacity: ok ? 1 : 0.4 }} disabled={!ok}
        onClick={async () => {
          await api.post("trades", { ...f, symbol: f.symbol.trim(), qty: num(f.qty), price: num(f.price), fee: num(f.fee) });
          setF({ ...f, qty: "", price: "", fee: "" }); reload();
        }}>İşlemi Kaydet</button>
    </div>

    <div style={css.card}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6, marginBottom: 10, alignItems: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Pozisyonlar</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: T.mut }}>
          <span>gerç. K/Z <Money v={Math.round(totReal)} sign size={12} /></span>
          <span>açık K/Z <Money v={Math.round(totUnreal)} sign size={12} /></span>
          <button style={css.ghost} onClick={refresh} disabled={busy}>{busy ? "Yenileniyor…" : "Fiyatları Yenile"}</button>
        </div>
      </div>
      {lastUpdate && <div style={{ fontSize: 11, color: T.mut, marginBottom: 6 }}>son güncelleme: {lastUpdate}</div>}
      <div style={{ fontSize: 11, color: T.mut, marginBottom: 8, lineHeight: 1.5 }}>
        Her satırdaki kutu o varlığın <b>güncel birim fiyatıdır</b> — pozisyon değeri, açık K/Z ve net varlık bununla hesaplanır.
        Fonlar (TEFAS) otomatik çekilemiyor; onları elle yaz. Elle girdiğin fiyat <b>oto</b> tazelemede değişmez;
        otomatik fiyata dönmek için <b>sıfırla</b>’ya bas.
      </div>
      {pos.length === 0 && <Empty>Henüz işlem yok. İlk alışınızı yukarıdan kaydedin.</Empty>}
      {pos.map((p) => (
        <div key={`${p.type}:${p.sym}`} style={{ padding: "10px 0", borderBottom: `1px solid ${T.line}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, marginRight: 8, background: T.panel2, color: TYPE_COLORS[p.type] || T.mut }}>{p.type}</span>
              <span style={{ ...css.mono, fontWeight: 600, fontSize: 15, color: T.acc }}>{p.sym}</span>
              <span style={{ fontSize: 12, color: T.mut, marginLeft: 8 }}>{p.qty} adet · ort. <span style={css.mono}>{tl2.format(p.avg)}</span></span>
            </div>
            {p.value != null && <span style={{ ...css.mono, fontSize: 14 }}>{tl.format(Math.round(p.value))}</span>}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
            <input key={`${p.sym}-${p.cur}`} style={{ ...css.input, width: 120, padding: "6px 8px", fontSize: 13 }} inputMode="decimal"
              placeholder="güncel fiyat ₺" defaultValue={p.cur ?? ""}
              onBlur={async (e) => {
                const v = num(e.target.value);
                if (v > 0 && v !== p.cur) { await api.put("prices", { symbol: p.sym, asset_type: p.type, price: v }); reload(); }
              }} />
            {p.source === "manual" && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, background: T.panel2, color: T.acc }}>elle</span>
            )}
            {p.source === "auto" && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, background: T.panel2, color: T.mut }}>oto</span>
            )}
            {p.cur == null && (
              <span style={{ fontSize: 11, color: T.neg }}>fiyat yok — elle gir</span>
            )}
            {p.cur != null && (
              <button style={{ ...css.del, fontSize: 12 }} title="fiyatı sil, otomatiğe dön"
                onClick={async () => { await api.delPrice(p.type, p.sym); reload(); }}>sıfırla</button>
            )}
            {p.unreal != null && <span style={{ fontSize: 12, color: T.mut }}>açık K/Z: <Money v={Math.round(p.unreal)} sign size={12} /></span>}
            {p.realized !== 0 && <span style={{ fontSize: 12, color: T.mut }}>gerçekleşen: <Money v={Math.round(p.realized)} sign size={12} /></span>}
          </div>
        </div>
      ))}
    </div>

    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>İşlem Geçmişi</div>
      {data.trades.length === 0 && <Empty>Kayıtlı işlem yok.</Empty>}
      {[...data.trades].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).map((t, i, arr) => (
        <Row key={t.id} last={i === arr.length - 1}>
          <span style={{ ...css.mono, fontSize: 12, color: T.mut, width: 74 }}>{fmtD(parseD(t.date), { day: "2-digit", month: "short", year: "2-digit" })}</span>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
            background: t.side === "ALIŞ" ? "#12312A" : "#3A1712", color: t.side === "ALIŞ" ? T.pos : T.neg,
          }}>{t.side}</span>
          <span style={{ flex: 1, fontSize: 13 }}>
            <b style={css.mono}>{t.symbol}</b> <span style={{ color: T.mut, fontSize: 11 }}>{t.asset_type}</span>{" "}
            <span style={{ color: T.mut }}>{t.qty} × {tl2.format(t.price)}</span>
          </span>
          <span style={{ ...css.mono, fontSize: 13 }}>{tl.format(Math.round(t.qty * t.price))}</span>
          <button style={css.del} onClick={async () => { await api.del("trades", t.id); reload(); }}>✕</button>
        </Row>
      ))}
    </div>
  </>);
}
