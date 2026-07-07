import React, { useState, useEffect, useMemo, useCallback } from "react";
import { project, positions, cardInfos } from "@finans/engine";
import { api } from "./api";
import { T, css, tl } from "./theme";
import { Center } from "./ui";
import { Ozet } from "./features/ozet";
import { Nakit } from "./features/nakit";
import { Butce } from "./features/butce";
import { Borclar } from "./features/borc";
import { Kartlar } from "./features/kart";
import { Portfoy } from "./features/portfoy";

/* ————— ana uygulama ————— */
export default function App() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.all>> | null>(null);
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
