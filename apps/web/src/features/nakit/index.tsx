import React, { useState, useMemo } from "react";
import { fmtD, type Day } from "@finans/engine";
import { T, css, tl } from "../../theme";
import { Money, Empty } from "../../ui";

/* ————— NAKİT AKIŞI (liste + takvim) ————— */
export function Nakit({ days }: { days: Day[] }) {
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
