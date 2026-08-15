import React, { useMemo, useState } from "react";
import {
  parseD, fmtD, ymOf, tradeLedger, summarizeTrades,
  type AllData, type AssetType, type Currency, type Trade, type TradeEntry,
} from "@finans/engine";
import { api } from "../../api";
import { T, css, fmtMoney, TYPE_COLORS } from "../../theme";
import { Empty, FiltreSeridi, SilDugmesi } from "../../ui";
import { EditSheet, type EditTarget } from "../../EditSheet";

/* ————— HAREKETLER (İŞLEM GEÇMİŞİ) —————
   "Hangi varlık ne zaman girdi/çıktı, ortalama maliyetim nasıl değişti, ne kazandım."
   Satır modeli engine'den gelir (`tradeLedger`): her işlemin öncesi/sonrası adet + ortalama maliyet,
   satışta gerçekleşen K/Z. Defter **seçili portföyün** işlemleriyle hesaplanır — grup başına ayrı
   ortalama maliyet (bkz. groupTradesByPortfolio). Filtreler defterden SONRA uygulanır: sembolü
   süzmek geçmişin matematiğini değiştirmez, sadece görünen satırları kısar. */

type Side = "hepsi" | Trade["side"];
/** Pozisyon olaylarının rozet renkleri (Faz 21) — temettü/bedelsiz alış-satıştan görsel olarak ayrılır */
const SIDE_SOFT: Record<Trade["side"], string> = {
  "ALIŞ": T.posSoft, "SATIŞ": T.negSoft, "TEMETTÜ": "var(--cat-5-soft, " + T.panel2 + ")", "BEDELSİZ": T.panel2,
};
const SIDE_INK: Record<Trade["side"], string> = {
  "ALIŞ": T.pos, "SATIŞ": T.neg, "TEMETTÜ": "var(--cat-5)", "BEDELSİZ": "var(--cat-3)",
};
type Range = 3 | 6 | 12 | 0; // 0 = tümü

const RANGES: { v: Range; label: string }[] = [
  { v: 3, label: "3 ay" }, { v: 6, label: "6 ay" }, { v: 12, label: "1 yıl" }, { v: 0, label: "Tümü" },
];

/** N ay öncesinin ISO tarihi (0 → sınır yok) */
const sinceOf = (months: Range): string => {
  if (!months) return "";
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
};

const MONTH_FMT: Intl.DateTimeFormatOptions = { month: "long", year: "numeric" };

export function Hareketler({ data, trades, scopeLabel, reload, symbol, onSymbol }: {
  data: AllData;
  /** defterin kapsamı — seçili portföyün işlemleri (veya tümü) */
  trades: Trade[];
  scopeLabel: string | null;
  reload: () => void;
  /** dışarıdan (pozisyon satırına tıklayarak) seçilen sembol filtresi */
  symbol: string | null;
  onSymbol: (s: string | null) => void;
}) {
  const [side, setSide] = useState<Side>("hepsi");
  const [type, setType] = useState<AssetType | "hepsi">("hepsi");
  const [range, setRange] = useState<Range>(0);
  const [editing, setEditing] = useState<EditTarget | null>(null);

  const ledger = useMemo(() => tradeLedger(trades), [trades]);
  const since = sinceOf(range);
  const shown = useMemo(() => ledger.filter((e) => (
    (symbol == null || e.trade.symbol.toUpperCase() === symbol.toUpperCase()) &&
    (side === "hepsi" || e.trade.side === side) &&
    (type === "hepsi" || e.trade.asset_type === type) &&
    (!since || e.trade.date >= since)
  )).reverse(), [ledger, symbol, side, type, since]); // en yeni üstte

  /* Özet para birimi başına ayrı — TRY ile USD'yi tek rakamda toplamak yanıltıcı olurdu
     (FX kuru işlem anındaki değil bugünkü olurdu). */
  const summaries = useMemo(() => {
    const ccys = [...new Set(shown.map((e) => e.trade.currency ?? "TRY"))] as Currency[];
    return ccys.map((c) => ({ ccy: c, s: summarizeTrades(shown.filter((e) => (e.trade.currency ?? "TRY") === c)) }));
  }, [shown]);

  const symbols = useMemo(
    () => [...new Set(trades.map((t) => t.symbol.toUpperCase()))].sort(),
    [trades],
  );
  const filtered = symbol != null || side !== "hepsi" || type !== "hepsi" || range !== 0;
  const clear = () => { onSymbol(null); setSide("hepsi"); setType("hepsi"); setRange(0); };

  return (
    <div style={css.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>
          Hareketler
          {scopeLabel && <span style={{ fontSize: 12, fontWeight: 400, color: T.mut, marginLeft: 8 }}>— {scopeLabel}</span>}
        </div>
        <div style={{ fontSize: 12, color: T.mut }}>{shown.length} işlem</div>
      </div>

      {/* Filtreler tek çukur şeritte (FiltreSeridi) — buradaki hiçbir düğme veri değiştirmez.
          Eskiden bu kontroller kartın yüzeyinde, eylem düğmeleriyle aynı görünümdeydi. */}
      <FiltreSeridi sag={filtered
        ? <button type="button" style={{ ...css.ghost, padding: "5px 10px", fontSize: 11.5 }} onClick={clear}>temizle</button>
        : undefined}>
        <select style={{ ...css.input, width: "auto", padding: "6px 8px", fontSize: 12.5 }} value={symbol ?? ""} onChange={(e) => onSymbol(e.target.value || null)}>
          <option value="">Tüm semboller</option>
          {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select style={{ ...css.input, width: "auto", padding: "6px 8px", fontSize: 12.5 }} value={type} onChange={(e) => setType(e.target.value as AssetType | "hepsi")}>
          <option value="hepsi">Tüm türler</option>
          {(["BIST", "FON", "ALTIN", "DOVIZ", "KRIPTO", "ETF"] as AssetType[]).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: `1px solid ${T.line}` }}>
          {(["hepsi", "ALIŞ", "SATIŞ", "TEMETTÜ", "BEDELSİZ"] as Side[]).map((s) => (
            <button key={s} type="button" onClick={() => setSide(s)} style={{
              padding: "6px 9px", border: "none", cursor: "pointer", fontSize: 11.5, fontFamily: T.disp, fontWeight: side === s ? 700 : 500,
              background: side === s ? (s === "hepsi" ? T.panel : SIDE_SOFT[s]) : T.panel2,
              color: side === s ? (s === "hepsi" ? T.text : SIDE_INK[s]) : T.mut,
            }}>{s === "hepsi" ? "Hepsi" : s}</button>
          ))}
        </div>
        <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: `1px solid ${T.line}` }}>
          {RANGES.map((r) => (
            <button key={r.v} type="button" onClick={() => setRange(r.v)} style={{
              padding: "6px 10px", border: "none", cursor: "pointer", fontSize: 12, fontFamily: T.disp,
              fontWeight: range === r.v ? 700 : 500,
              background: range === r.v ? T.panel : T.panel2, color: range === r.v ? T.acc : T.mut,
            }}>{r.label}</button>
          ))}
        </div>
      </FiltreSeridi>

      {/* dönem özeti — para birimi başına */}
      {summaries.map(({ ccy, s }) => (
        <div key={ccy} style={{
          display: "flex", gap: 14, flexWrap: "wrap", alignItems: "baseline",
          background: T.panel2, borderRadius: 8, padding: "8px 12px", marginBottom: 8, fontSize: 12, color: T.mut,
        }}>
          {summaries.length > 1 && <b style={{ color: T.text }}>{ccy}</b>}
          <span>alış <span style={{ ...css.mono, color: T.text }}>{fmtMoney(Math.round(s.buy), ccy)}</span></span>
          <span>satış <span style={{ ...css.mono, color: T.text }}>{fmtMoney(Math.round(s.sell), ccy)}</span></span>
          {s.fee > 0 && <span>komisyon <span style={{ ...css.mono, color: T.text }}>{fmtMoney(s.fee, ccy, true)}</span></span>}
          {/* Temettü gerçekleşen K/Z'nin İÇİNDE sayılır; ayrıca gösterilir çünkü satış kârından
              farklı bir getiri kalitesidir (pozisyonu küçültmeden gelen nakit). */}
          {s.dividend > 0 && <span>temettü <span style={{ ...css.mono, color: "var(--cat-5)" }}>{fmtMoney(Math.round(s.dividend), ccy)}</span></span>}
          <span>gerçekleşen K/Z <span style={{ ...css.mono, color: s.realized > 0 ? T.pos : s.realized < 0 ? T.neg : T.text }}>
            {s.realized > 0 ? "+" : ""}{fmtMoney(Math.round(s.realized), ccy)}
          </span></span>
        </div>
      ))}

      {shown.length === 0 && <Empty>{filtered ? "Bu filtreye uyan işlem yok." : "Kayıtlı işlem yok."}</Empty>}

      {/* aya göre gruplanmış hareket listesi */}
      {shown.map((e, i) => {
        const ym = ymOf(parseD(e.trade.date));
        const prevYm = i > 0 ? ymOf(parseD(shown[i - 1].trade.date)) : null;
        return (
          <React.Fragment key={e.trade.id}>
            {ym !== prevYm && (
              <div style={{
                fontSize: 11, fontWeight: 700, color: T.mut, textTransform: "uppercase", letterSpacing: "0.04em",
                padding: "10px 0 6px", borderBottom: `1px solid ${T.line}`, marginBottom: 2,
              }}>{fmtD(parseD(e.trade.date), MONTH_FMT)}</div>
            )}
            <HareketRow e={e} data={data} reload={reload} onSymbol={onSymbol} onEdit={setEditing} />
          </React.Fragment>
        );
      })}
      {editing && <EditSheet data={data} target={editing} reload={reload} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Tek hareket: üst satır ne olduğu, alt satır pozisyona etkisi (adet ve ortalama maliyet değişimi) */
function HareketRow({ e, data, reload, onSymbol, onEdit }: {
  e: TradeEntry; data: AllData; reload: () => void; onSymbol: (s: string | null) => void;
  onEdit: (t: EditTarget) => void;
}) {
  const t = e.trade;
  const ccy = (t.currency ?? "TRY") as Currency;
  const buy = t.side === "ALIŞ";
  const bonus = t.side === "BEDELSİZ", div = t.side === "TEMETTÜ";
  const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""));
  return (
    <div style={{ padding: "10px 0", borderBottom: `1px solid ${T.line}` }}>
      {/* Satır TEK SOL KENARA hizalı üç katmandır — kimlik, ayrıntı, etki. Eskiden ayrıntı
          satırı `marginLeft:60` ile içerliydi (artık var olmayan bir tarih sütununun kalıntısı)
          ve grup seçici satırın ortasında kocaman bir kutu olarak duruyordu; bilgi yarı solda
          yarı ortada kalıyordu. Kutu gitti (bkz. inline-select), girintiler tek hizaya geldi. */}
      <div className="ui-row" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="row-lead" style={{
          fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, flexShrink: 0,
          background: SIDE_SOFT[t.side], color: SIDE_INK[t.side],
        }}>{t.side}</span>
        {/* Satırın kimliği semboldür. Tarih 2. satıra indi: ay başlıkları (AĞUSTOS 2026) zaten
            bağlamı veriyor, gün tek başına 1. satırda yer kaplamayı hak etmiyor. */}
        {/* flex:1 + tutarda marginLeft:auto → tutarlar MASAÜSTÜNDE de sağ kolonda hizalanır
            (row-amount kuralı yalnız mobil medya sorgusunda; geniş ekranda hepsi sola yığılıyordu) */}
        <span className="row-title" style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0, flex: 1 }}>
          <button type="button" onClick={() => onSymbol(t.symbol.toUpperCase())} title="Bu sembolün hareketlerini süz"
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", ...css.mono, fontWeight: 600, fontSize: 14, color: T.acc, minHeight: 0 }}>
            {t.symbol}
          </button>
          <span style={{ fontSize: 10, fontWeight: 700, color: TYPE_COLORS[t.asset_type] || T.mut, flexShrink: 0 }}>{t.asset_type}</span>
        </span>
        {/* İşlem büyüklüğü — nötr ve işaretsiz. Yönü ALIŞ/SATIŞ rozeti söyler; kırmızı/yeşil bu
            ekranda yalnız gerçekleşen K/Z'ye ayrılmıştır (işaretli tutar "zarar" gibi okunuyordu).
            Ayrıca portföy işlemi hesaba bağlı değilse hiçbir bakiyeyi oynatmaz — eksi işareti bunu da
            yanlış ima ediyordu. */}
        <span className="row-amount" style={{ ...css.mono, fontSize: 13.5, marginLeft: "auto", color: bonus ? T.mut3 : T.text }}
          title={bonus ? "bedelsizde para hareketi yoktur" : buy ? "ödenen (komisyon dahil)" : div ? "hesaba giren temettü" : "ele geçen (komisyon düşülmüş)"}>
          {bonus ? "—" : fmtMoney(Math.round(Math.abs(e.cash)), ccy)}
        </span>
        <button className="row-end" style={css.edit} title="İşlemi düzenle" onClick={() => onEdit({ kind: "trade", row: t })}>✎</button>
        <SilDugmesi ad={<>{t.side} · {t.symbol} · {num(t.qty)} adet</>} title="İşlemi sil"
          onSil={async () => { await api.del("trades", t.id); reload(); }}
          sonuc={<>Pozisyon ve ortalama maliyet yeniden hesaplanır.{t.account_id != null && " Tutar bağlı hesaba geri işlenir."}</>} />
      </div>

      {/* 2. katman: ne zaman, ne kadar, hangi grupta — hepsi aynı sol kenardan başlar */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 3, fontSize: 12, color: T.mut }}>
        <span style={{ ...css.mono, color: T.mut3 }}>{fmtD(parseD(t.date), { day: "2-digit", month: "short" })}</span>
        <span>
          {bonus
            ? <>{num(t.qty)} adet bedelsiz · <span style={{ color: T.mut3 }}>ort. {fmtMoney(e.avgBefore, ccy, true)} → {fmtMoney(e.avgAfter, ccy, true)}</span></>
            : <>{num(t.qty)} × <span style={css.mono}>{fmtMoney(t.price, ccy, true)}</span>
              {t.fee > 0 && <span style={{ color: T.mut3 }}> · {div ? "stopaj" : "kom."} {fmtMoney(t.fee, ccy, true)}</span>}</>}
        </span>
        {data.portfolios.length > 0 && (
          /* inline-select: kutu değil metin gibi görünür, üstüne gelince/odaklanınca kenarlık
             kazanır. Tek tıkla grup atama korunur (✎ formundan yapmak çok daha yavaş), ama
             salt-okunur bir listenin ortasında kalıcı bir giriş kutusu gibi durmaz. */
          <select className="inline-select" title="Portföy grubu"
            style={{ ...css.input, width: "auto", maxWidth: 150, padding: "1px 4px", fontSize: 11.5, color: T.mut3 }}
            value={t.portfolio_id ?? ""}
            onChange={async (ev) => { await api.setTradePortfolio(t.id, ev.target.value ? +ev.target.value : null); reload(); }}>
            <option value="">Gruplanmamış</option>
            {data.portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>

      {/* 3. katman: pozisyona etkisi ("lot" satırı) */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 3, fontSize: 11.5, color: T.mut3 }}>
        <span>
          adet <span style={css.mono}>{num(e.qtyBefore)}</span> → <span style={{ ...css.mono, color: T.mut }}>{num(e.qtyAfter)}</span>
        </span>
        {buy && (
          <span>
            ort. maliyet <span style={css.mono}>{e.qtyBefore > 0 ? fmtMoney(e.avgBefore, ccy, true) : "—"}</span>
            {" → "}<span style={{ ...css.mono, color: T.mut }}>{fmtMoney(e.avgAfter, ccy, true)}</span>
          </span>
        )}
        {!buy && (
          <span>
            gerçekleşen{" "}
            <span style={{ ...css.mono, color: e.realized > 0 ? T.pos : e.realized < 0 ? T.neg : T.mut }}>
              {e.realized > 0 ? "+" : ""}{fmtMoney(Math.round(e.realized), ccy)}
            </span>
            <span style={{ color: T.mut3 }}> (ort. {fmtMoney(e.avgBefore, ccy, true)})</span>
          </span>
        )}
        {e.closed && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: T.panel2, color: T.mut }}>
            pozisyon kapandı
          </span>
        )}
      </div>
    </div>
  );
}
