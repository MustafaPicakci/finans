import React, { useState, useMemo } from "react";
import { fmtD, parseD, keyOf, type AllData, type Day } from "@finans/engine";
import { T, css, tl } from "../../theme";
import { maskBrief } from "../../privacy";
import { Money, Empty } from "../../ui";

/** Takvimde gösterilen gerçekleşen (defter) hareketi; `card` doluysa kart harcaması (nakdi o gün oynatmaz) */
type LedgerEv = { n: string; a: number; card?: string };

/* ————— NAKİT AKIŞI (liste + takvim) ————— */
export function Nakit({ days, data }: { days: Day[]; data: AllData }) {
  const [view, setView] = useState<"liste" | "takvim">("takvim");
  /* gerçekleşen hareketler (transactions + kart harcamaları) gün anahtarına göre — takvimde ✓ olarak
     işaretlenir. Projeksiyon geçmişi çizmediğinden içinde bulunulan ayın geçmiş günleri bu defterden gelir. */
  const ledger = useMemo(() => {
    const m = new Map<string, LedgerEv[]>();
    const push = (k: string, e: LedgerEv) => { if (!m.has(k)) m.set(k, []); m.get(k)!.push(e); };
    data.transactions.forEach((t) => push(t.date, { n: t.name, a: t.amount }));
    data.card_txs.forEach((ct) => push(ct.date, { n: ct.name, a: -ct.amount, card: data.cards.find((c) => c.id === ct.card_id)?.name || "kart" }));
    return m;
  }, [data]);
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
        <div style={{ display: "flex", gap: 6, overflowX: "auto", minWidth: 0 }}>
          {months.map((m, i) => (
            <button key={i} onClick={() => setMi(i)} style={{
              background: i === mi ? T.acc : T.panel2, color: i === mi ? T.accInk : T.mut,
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
      {view === "takvim" ? <Takvim key={cur.label} month={cur} ledger={ledger} /> : <Liste days={cur.days} />}
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

/** Etkin nakit = gün sonu nakit + para piyasası fonu (likit, nakit gibi değerlenir) */
const effCash = (d: Day) => d.bal + d.cashFunds;

function Takvim({ month, ledger }: { month: { y: number; mo: number; days: Day[] }; ledger: Map<string, LedgerEv[]> }) {
  const [selK, setSelK] = useState<string | null>(null);
  const todayK = keyOf(new Date());
  const byDate = new Map(month.days.map((d) => [d.date.getDate(), d]));
  const first = new Date(month.y, month.mo, 1);
  const daysInMonth = new Date(month.y, month.mo + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // Pazartesi=0
  const pad = (n: number) => String(n).padStart(2, "0");
  const kOf = (dd: number) => `${month.y}-${pad(month.mo + 1)}-${pad(dd)}`;
  const cells: (number | null)[] = []; // gün numarası; null = boş baş hücresi
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let dd = 1; dd <= daysInMonth; dd++) cells.push(dd);
  const wd = ["Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pz"];
  const kBrief = (v: number) => maskBrief(Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)));
  const check = <span style={{ fontSize: 9, color: T.pos, lineHeight: 1 }}>✓</span>; // gerçekleşen işareti

  const selDay = selK ? month.days.find((d) => d.k === selK) ?? null : null;
  const selLedger = selK ? ledger.get(selK) ?? [] : [];

  return (<>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 4, maxWidth: 480, margin: "0 auto" }}>
      {wd.map((w) => <div key={w} style={{ textAlign: "center", fontSize: 11, color: T.mut, padding: "2px 0" }}>{w}</div>)}
      {cells.map((dd, i) => {
        if (dd == null) return <div key={i} />;
        const d = byDate.get(dd) ?? null;
        const k = kOf(dd);
        const done = ledger.has(k) && k <= todayK; // o günün gerçekleşen hareketleri
        if (!d) {
          /* projeksiyon dışı gün: içinde bulunulan ayın GEÇMİŞ günleri (bakiye geçmişi tutulmadığından
             sayı yok) — gerçekleşen hareketleri ✓ ile işaretlenir, tıklayınca listelenir */
          if (k >= todayK) return <div key={i} />;
          const isSel = selK === k;
          return (
            <button key={i} onClick={() => setSelK(isSel ? null : k)} style={{
              aspectRatio: "1", border: `1px dashed ${isSel ? T.acc : T.line}`, borderRadius: 8,
              background: "transparent", cursor: "pointer", opacity: 0.65,
              display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "4px 5px", overflow: "hidden",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: T.mut3 }}>{dd}</span>
                {done && check}
              </div>
              <div />
            </button>
          );
        }
        const hasEv = d.ev.length > 0;
        const neg = effCash(d) < 0; // para piyasası fonu nakit gibi sayılır
        const isSel = selK === d.k;
        return (
          <button key={i} onClick={() => setSelK(isSel ? null : d.k)} style={{
            aspectRatio: "1", border: `1px solid ${isSel ? T.acc : neg ? T.neg : T.line}`, borderRadius: 8,
            background: neg ? T.negSoft : hasEv ? T.panel2 : "transparent", cursor: "pointer",
            display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "4px 5px", overflow: "hidden",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 3 }}>
              <span style={{ fontSize: 11, color: T.mut }}>{d.date.getDate()}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                {done && check}
                {hasEv && <span style={{ width: 5, height: 5, borderRadius: 3, background: T.acc }} />}
              </span>
            </div>
            <div style={{ textAlign: "right", lineHeight: 1.15 }}>
              <div style={{ ...css.mono, fontSize: 11, color: neg ? T.neg : T.text }}>{kBrief(effCash(d))}</div>
              {d.assets > 0 && <div style={{ ...css.mono, fontSize: 9, color: T.mut }}>Σ{kBrief(d.total)}</div>}
            </div>
          </button>
        );
      })}
    </div>
    <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 11, color: T.mut, flexWrap: "wrap" }}>
      <span><span style={{ ...css.mono, color: T.text }}>sayı</span> = etkin nakit (nakit + para piyasası)</span>
      <span><span style={{ ...css.mono, color: T.mut }}>Σ</span> = tüm varlık</span>
      <span><span style={{ color: T.neg }}>kırmızı</span> = eksi etkin nakit</span>
      <span><span style={{ color: T.pos }}>✓</span> = gerçekleşen hareket</span>
    </div>
    {selK && (selDay || selLedger.length > 0) && (() => {
      const date = selDay ? selDay.date : parseD(selK);
      const ledgerList = selLedger.length > 0 && (
        <div style={{ marginTop: selDay ? 10 : 0, ...(selDay ? { borderTop: `1px solid ${T.line}`, paddingTop: 8 } : {}) }}>
          <div style={{ ...css.label, marginBottom: 4 }}>gerçekleşen <span style={{ color: T.pos }}>✓</span></div>
          {selLedger.map((e, j) => (
            <div key={j} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 4 }}>
              <span style={{ color: T.mut }}>{e.n}{e.card && <span style={{ color: T.mut3 }}> · {e.card} 💳</span>}</span><Money v={e.a} sign />
            </div>
          ))}
          {selLedger.some((e) => e.card) && (
            <div style={{ fontSize: 11, color: T.mut3, marginTop: 6 }}>💳 kart harcaması — nakdi o gün değil, ekstre son ödeme günü etkiler</div>
          )}
        </div>
      );
      return (
      <div style={{ background: T.panel2, borderRadius: 10, padding: 12, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <div style={{ fontWeight: 700 }}>{fmtD(date, { day: "numeric", month: "long", weekday: "long" })}</div>
          {!selDay && <div style={{ fontSize: 11, color: T.mut3 }}>geçmiş gün — bakiye geçmişi tutulmuyor</div>}
        </div>
        {selDay && (() => {
          const eff = effCash(selDay);
          const hasPpf = selDay.cashFunds > 0;
          const other = selDay.assets - selDay.cashFunds; // para piyasası dışı portföy
          return (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div>
                <div style={css.label}>etkin nakit</div>
                <span style={{ ...css.mono, fontSize: 16, color: eff < 0 ? T.neg : T.pos }}>{tl.format(Math.round(eff))}</span>
              </div>
              {hasPpf && (<>
                <div><div style={css.label}>gün sonu nakit</div><span style={{ ...css.mono, fontSize: 16, color: selDay.bal < 0 ? T.neg : T.text }}>{tl.format(Math.round(selDay.bal))}</span></div>
                <div><div style={css.label}>para piyasası fonu</div><span style={{ ...css.mono, fontSize: 16, color: T.text }}>{tl.format(Math.round(selDay.cashFunds))}</span></div>
              </>)}
              <div><div style={css.label}>{hasPpf ? "diğer portföy" : "portföy"}</div><span style={{ ...css.mono, fontSize: 16, color: T.text }}>{tl.format(Math.round(other))}</span></div>
              <div><div style={css.label}>toplam varlık</div><span style={{ ...css.mono, fontSize: 16, color: T.acc }}>{tl.format(Math.round(selDay.total))}</span></div>
            </div>
          );
        })()}
        {selDay && selDay.ev.length > 0 && (
          <div style={{ marginTop: 10, borderTop: `1px solid ${T.line}`, paddingTop: 8 }}>
            <div style={{ ...css.label, marginBottom: 4 }}>planlanan hareketler</div>
            {selDay.ev.map((e, j) => (
              <div key={j} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 4 }}>
                <span style={{ color: T.mut }}>{e.n}</span><Money v={e.a} sign />
              </div>
            ))}
          </div>
        )}
        {ledgerList}
      </div>
      );
    })()}
  </>);
}
