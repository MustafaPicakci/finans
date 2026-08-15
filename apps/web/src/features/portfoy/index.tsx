import React, { useEffect, useMemo, useState } from "react";
import {
  parseD, fmtD, num, convert, positions, groupTradesByPortfolio, portfolioValueTry, pnlPct,
  type AllData, type Position, type Rates, type Currency, type AssetType, type PortfolioKey,
} from "@finans/engine";
import { api } from "../../api";
import { T, css, fmtMoney, TYPE_COLORS } from "../../theme";
import { Empty, Row, Field, Aciklama, FiltreSeridi, SilDugmesi } from "../../ui";
import { Hareketler } from "./Hareketler";
import { DegerGrafigi } from "./DegerGrafigi";
import type { AddKind } from "../forms";

/** İşaretli tutar, verilen para biriminde (Money bileşeni TRY'ye sabit olduğundan native gösterim için) */
/* K/Z gösterimi. `pct` verilirse tutarın yanında oranı da yazar — mutlak tutar tek başına
   ölçeksizdir (₺3.000 kâr, 10 binlik pozisyonda %30, 300 binlikte %1). Oran maliyet 0 ise
   (tamamı bedelsiz gelen pozisyon) null gelir ve hiç yazılmaz. */
const Signed = ({ v, ccy, size = 12, pct }: { v: number; ccy: Currency; size?: number; pct?: number | null }) => (
  <span style={{ ...css.mono, fontSize: size, color: v > 0 ? T.pos : v < 0 ? T.neg : T.mut }}>
    {v > 0 ? "+" : ""}{fmtMoney(v, ccy)}
    {pct != null && <span style={{ opacity: 0.75 }}> ({v > 0 ? "+" : ""}%{(pct * 100).toFixed(1).replace(".", ",")})</span>}
  </span>
);

/* ————— PORTFÖY ————— */
/* İşlem (alış/satış) girişi global "+" akışındadır; burada pozisyonlar, fiyatlar ve geçmiş var.
   Pozisyon satırları kendi doğal (native) para biriminde; başlık toplamları görüntü birimine çevrilir. */

/* Pozisyonlar varlık sınıfına göre gruplanır; sırası burada tanımlıdır */
const POS_GROUPS: { key: string; title: string; types: AssetType[] }[] = [
  { key: "maden", title: "Kıymetli Madenler", types: ["ALTIN"] },
  { key: "bist", title: "BIST Hisse & Fonlar", types: ["BIST", "FON"] },
  { key: "abd", title: "ABD Borsası & ETF", types: ["ETF"] },
  { key: "kripto", title: "Kripto", types: ["KRIPTO"] },
  { key: "doviz", title: "Döviz", types: ["DOVIZ"] },
];
/** Seçili portföy şeridi: "Tümü" | bir grup id'si | `null` (Gruplanmamış) */
type Sel = "all" | PortfolioKey;

export function Portfoy({ data, pos: allPos, rates, ccy, reload, onAdd }: {
  data: AllData; pos: Position[]; rates: Rates; ccy: Currency; reload: () => void; onAdd: (k: AddKind) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<Sel>("all");
  /* Varlık sınıfı kartları: "Tümü"nde hepsi KAPALI başlar (birleşik liste uzun; önce özet, isteyen açar),
     tek bir portföy seçiliyken açık başlar (zaten dar bir liste). Kullanıcının açıp kapaması korunur;
     yalnız seçim değişince varsayılana döner. */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(POS_GROUPS.map((g) => g.key)));
  useEffect(() => {
    setCollapsed(sel === "all" ? new Set(POS_GROUPS.map((g) => g.key)) : new Set());
  }, [sel]);
  /* Seçili grup ortadan kalkarsa (silindi, ya da son gruplanmamış işlem bir gruba atandı)
     seçim "Tümü"ye döner — aksi halde erişilemeyen boş bir görünümde kalınırdı. */
  useEffect(() => {
    if (sel !== "all" && sel !== null && !data.portfolios.some((p) => p.id === sel)) setSel("all");
  }, [data.portfolios, sel]);
  // hareket listesinin sembol filtresi — pozisyon satırına tıklayınca da dolar
  const [symFilter, setSymFilter] = useState<string | null>(null);

  /* Portföy grupları (Faz 11): gruplama işlem düzeyinde, pozisyonlar grup başına AYRI hesaplanır —
     aynı sembol iki portföyde ayrı ortalama maliyetle durur. "Tümü" seçiliyken App'in hesapladığı
     birleşik pozisyon listesi kullanılır (net varlıkla birebir aynı rakam). */
  const byPortfolio = useMemo(() => groupTradesByPortfolio(data.trades), [data.trades]);
  const groupValue = (k: PortfolioKey) => {
    const tr = byPortfolio.get(k);
    return tr ? portfolioValueTry(positions(tr, data.prices), rates) : 0;
  };
  const selTrades = sel === "all" ? data.trades : byPortfolio.get(sel) ?? [];
  const pos = useMemo(
    () => (sel === "all" ? allPos : positions(selTrades, data.prices)),
    [sel, allPos, selTrades, data.prices],
  );
  /* "Gruplanmamış" çipi yalnız HEM gruplanmış HEM gruplanmamış işlem varken anlamlı:
     hiçbiri gruplanmamışsa birebir "Tümü" ile aynı listedir (gereksiz çip), hepsi gruplanmışsa
     zaten boştur. Böylece çip "atamayı unuttuklarım" görünümü olarak iş görür. */
  const ungroupedCount = byPortfolio.get(null)?.length ?? 0;
  const hasUngrouped = ungroupedCount > 0 && ungroupedCount < data.trades.length;
  const showStrip = data.portfolios.length > 0;

  const totUnreal = pos.reduce((s, p) => s + convert(p.unreal ?? 0, p.currency, ccy, rates), 0);
  const totReal = pos.reduce((s, p) => s + convert(p.realized, p.currency, ccy, rates), 0);
  /* Toplam açık K/Z oranı: yüzdeler ORTALANAMAZ (₺100'lük %50 ile ₺100.000'lik %1 aynı ağırlıkta
     değil) — toplam K/Z, toplam maliyete bölünür. Fiyatı olmayan pozisyon her iki toplama da girmez. */
  const totCost = pos.reduce((s, p) => s + (p.unreal != null ? convert(p.qty * p.avg, p.currency, ccy, rates) : 0), 0);
  const totUnrealPct = pnlPct(totUnreal, totCost);
  const lastUpdate = data.prices.reduce((m, p) => (p.updated_at > m ? p.updated_at : m), "");

  /* Para piyasası (nakit sayılan) fonlar — Nakit Akışı takviminde nakit gibi değerlenir */
  const cashFunds = new Set((data.settings.cash_funds || "").split(",").map((s) => s.trim()).filter(Boolean));
  const toggleCashFund = async (sym: string) => {
    const next = new Set(cashFunds);
    next.has(sym) ? next.delete(sym) : next.add(sym);
    await api.put("settings", { cash_funds: [...next].join(",") });
    reload();
  };

  const refresh = async () => {
    setBusy(true);
    try { await api.refreshPrices(); await reload(); } finally { setBusy(false); }
  };

  return (<>
    <div style={css.card}>
      {/* Başlık satırı = KİMLİK + ÖZET + tek eylem (fiyat tazeleme, ikon).
          "+ İşlem" düğmesi kaldırıldı: işlem girişinin tek kapısı global "+ Ekle" (CLAUDE.md'deki
          kural); sekmeye ikinci bir giriş noktası koymak hem kuralı deler hem de filtre
          çipleriyle aynı hizada durup "bu da mı filtre?" karışıklığı yaratıyordu. */}
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10, alignItems: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Pozisyonlar</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: T.mut }}>
          <span>gerç. K/Z <Signed v={Math.round(totReal)} ccy={ccy} /></span>
          <span>açık K/Z <Signed v={Math.round(totUnreal)} ccy={ccy} pct={totUnrealPct} /></span>
          <button className="icon-btn" onClick={refresh} disabled={busy}
            title={busy ? "Yenileniyor…" : "Fiyatları yenile"} aria-label="Fiyatları yenile"
            style={{
              width: 32, height: 32, borderRadius: 9, border: `1px solid ${T.line}`, background: T.panel,
              color: T.mut, cursor: busy ? "default" : "pointer", display: "grid", placeItems: "center",
              fontSize: 14, flexShrink: 0, opacity: busy ? 0.6 : 1,
            }}>
            <span style={{ display: "inline-block", animation: busy ? "spin 1s linear infinite" : "none" }}>↻</span>
          </button>
        </div>
      </div>
      {showStrip && <FiltreSeridi>
        <PortfolioChip label="Tümü" value={portfolioValueTry(allPos, rates)} ccy={ccy} rates={rates} active={sel === "all"} onClick={() => setSel("all")} />
        {data.portfolios.map((p) => (
          <PortfolioChip key={p.id} label={p.name} title={p.note ?? undefined} value={groupValue(p.id)} ccy={ccy} rates={rates}
            active={sel === p.id} onClick={() => setSel(p.id)} />
        ))}
        {(hasUngrouped || sel === null) && (
          <PortfolioChip label="Gruplanmamış" value={groupValue(null)} ccy={ccy} rates={rates} active={sel === null} onClick={() => setSel(null)} />
        )}
      </FiltreSeridi>}
      {lastUpdate && <div style={{ fontSize: 11, color: T.mut, marginBottom: 6 }}>son güncelleme: {lastUpdate}</div>}
      <Aciklama k="fiyat-kutusu" label="fiyat kutuları nasıl çalışır?">
        Her satırdaki kutu o varlığın <b>güncel birim fiyatıdır</b> — pozisyon değeri, açık K/Z ve net varlık bununla hesaplanır.
        Fonlar (TEFAS) otomatik çekilemiyor; onları elle yaz. Elle girdiğin fiyat <b>oto</b> tazelemede değişmez;
        otomatik fiyata dönmek için <b>sıfırla</b>’ya bas.
      </Aciklama>
      {pos.length === 0 && (
        <Empty>{sel === "all" ? "Henüz işlem yok. İlk alışınızı yukarıdan kaydedin." : "Bu portföyde açık pozisyon yok."}</Empty>
      )}
      {POS_GROUPS.map((g) => {
        const items = pos
          .filter((p) => g.types.includes(p.type))
          .sort((a, b) => convert(b.value ?? 0, b.currency, ccy, rates) - convert(a.value ?? 0, a.currency, ccy, rates));
        if (items.length === 0) return null;
        const gValue = items.reduce((s, p) => s + convert(p.value ?? 0, p.currency, ccy, rates), 0);
        const gUnreal = items.reduce((s, p) => s + convert(p.unreal ?? 0, p.currency, ccy, rates), 0);
        // grup oranı da toplam K/Z ÷ toplam maliyet (yüzde ortalaması alınmaz — bkz. totUnrealPct)
        const gCost = items.reduce((s, p) => s + (p.unreal != null ? convert(p.qty * p.avg, p.currency, ccy, rates) : 0), 0);
        const isCollapsed = collapsed.has(g.key);
        const toggle = () => setCollapsed((prev) => {
          const next = new Set(prev);
          next.has(g.key) ? next.delete(g.key) : next.add(g.key);
          return next;
        });
        return (
          <div key={g.key} style={{ marginBottom: isCollapsed ? 4 : 12 }}>
            <div onClick={toggle} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, cursor: "pointer",
              padding: "8px 10px", borderRadius: 8, background: T.panel2, userSelect: "none",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, color: T.mut, width: 10 }}>{isCollapsed ? "▸" : "▾"}</span>
                <span style={{ fontWeight: 700, fontSize: 13, color: TYPE_COLORS[g.types[0]] || T.text }}>{g.title}</span>
                <span style={{ fontSize: 11, color: T.mut }}>{items.length} varlık</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 11, color: T.mut }}>açık K/Z <Signed v={Math.round(gUnreal)} ccy={ccy} size={11} pct={pnlPct(gUnreal, gCost)} /></span>
                <span style={{ ...css.mono, fontSize: 13, fontWeight: 600 }}>{fmtMoney(Math.round(gValue), ccy)}</span>
              </div>
            </div>
            {!isCollapsed && items.map((p) => (
            <div key={`${p.type}:${p.sym}`} style={{ padding: "10px 0 10px 10px", borderBottom: `1px solid ${T.line}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, marginRight: 8, background: T.panel2, color: TYPE_COLORS[p.type] || T.mut }}>{p.type}</span>
                  <button type="button" onClick={() => setSymFilter(p.sym)} title="Bu varlığın hareketlerini gör"
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer", ...css.mono, fontWeight: 600, fontSize: 15, color: T.acc }}>
                    {p.sym}
                  </button>
                  {p.currency === "USD" && <span style={{ fontSize: 10, fontWeight: 700, color: T.mut3, marginLeft: 6 }}>USD</span>}
                  <span style={{ fontSize: 12, color: T.mut, marginLeft: 8 }}>{p.qty} adet · ort. <span style={css.mono}>{fmtMoney(p.avg, p.currency, true)}</span></span>
                </div>
                {p.value != null && <span style={{ ...css.mono, fontSize: 14 }}>{fmtMoney(Math.round(p.value), p.currency)}</span>}
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                <input key={`${p.sym}-${p.cur}`} style={{ ...css.input, width: 120, padding: "6px 8px", fontSize: 13 }} inputMode="decimal"
                  placeholder={`güncel fiyat ${p.currency === "USD" ? "$" : "TL"}`} defaultValue={p.cur ?? ""}
                  onBlur={async (e) => {
                    const v = num(e.target.value);
                    if (v > 0 && v !== p.cur) { await api.put("prices", { symbol: p.sym, asset_type: p.type, price: v, currency: p.currency }); reload(); }
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
                {p.type === "FON" && (
                  <button
                    title={cashFunds.has(p.sym) ? "Nakit sayımından çıkar" : "Para piyasası fonu — nakit gibi say (takvimde etkin nakite eklenir)"}
                    onClick={() => toggleCashFund(p.sym)}
                    style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, cursor: "pointer",
                      border: `1px solid ${cashFunds.has(p.sym) ? T.pos : T.line}`,
                      background: cashFunds.has(p.sym) ? T.posSoft : "transparent",
                      color: cashFunds.has(p.sym) ? T.pos : T.mut,
                    }}>{cashFunds.has(p.sym) ? "✓ nakit sayılır" : "nakit say"}</button>
                )}
                {p.unreal != null && <span style={{ fontSize: 12, color: T.mut }}>açık K/Z: <Signed v={Math.round(p.unreal)} ccy={p.currency} pct={p.unrealPct} /></span>}
                {p.realized !== 0 && <span style={{ fontSize: 12, color: T.mut }}>gerçekleşen: <Signed v={Math.round(p.realized)} ccy={p.currency} /></span>}
              </div>
            </div>
            ))}
          </div>
        );
      })}
    </div>

    {/* Seçili portföyün değer seyri — aralık seçici ile (grafik grubun işlemlerinden hesaplanır) */}
    <DegerGrafigi
      trades={selTrades} priceHistory={data.price_history} rates={rates} ccy={ccy} height={200}
      scopeLabel={sel === "all" ? null : sel === null ? "Gruplanmamış" : data.portfolios.find((p) => p.id === sel)?.name ?? null}
    />

    <Hareketler
      data={data} trades={selTrades} reload={reload}
      scopeLabel={sel === "all" ? null : sel === null ? "Gruplanmamış" : data.portfolios.find((p) => p.id === sel)?.name ?? null}
      symbol={symFilter} onSymbol={setSymFilter}
    />

    <PortfolioManager data={data} rates={rates} ccy={ccy} reload={reload} groupValue={groupValue} />
  </>);
}

/** Portföy şeridi düğmesi — grup adı + o grubun güncel değeri */
function PortfolioChip({ label, value, ccy, rates, active, onClick, title }: {
  label: string; value: number; ccy: Currency; rates: Rates; active: boolean; onClick: () => void; title?: string;
}) {
  return (
    <button type="button" title={title} onClick={onClick} style={{
      ...css.chip, display: "flex", alignItems: "baseline", gap: 6,
      borderColor: active ? T.acc : T.line, color: active ? T.acc : T.text,
      background: active ? T.panel : T.panel2, fontWeight: active ? 700 : 560,
    }}>
      {label}
      <span style={{ ...css.mono, fontSize: 11, color: T.mut }}>{fmtMoney(Math.round(convert(value, "TRY", ccy, rates)), ccy)}</span>
    </button>
  );
}

/** Portföy grubu tanımları: ekle / sil. Silinen grubun işlemleri kaybolmaz, "Gruplanmamış"a döner. */
function PortfolioManager({ data, rates, ccy, reload, groupValue }: {
  data: AllData; rates: Rates; ccy: Currency; reload: () => void; groupValue: (k: PortfolioKey) => number;
}) {
  const [f, setF] = useState({ name: "", note: "" });
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return;
    await api.post("portfolios", { name: f.name.trim(), note: f.note.trim() || null });
    setF({ name: "", note: "" });
    reload();
  };
  const count = (id: number) => data.trades.filter((t) => t.portfolio_id === id).length;
  return (
    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Portföyler</div>
      <Aciklama k="portfoy-gruplari" label="portföy grubu ne işe yarar?">
        Varlıklarını mantıksal olarak ayır (ör. <b>Alfa Portföy</b>, <b>Emeklilik</b>, <b>Büyüme</b>).
        Gruplama <b>işlem düzeyindedir</b>: aynı sembolü iki portföyde ayrı ortalama maliyetle tutabilirsin.
        Net varlık ve alokasyon değişmez — bu yalnız takip/raporlama içindir.
      </Aciklama>
      <form onSubmit={add} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Field label="Ad" flex={2}>
          <input style={css.input} value={f.name} placeholder="örn. Alfa Portföy" onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Not (ops.)" flex={2}>
          <input style={css.input} value={f.note} placeholder="örn. büyüme hisseleri" onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button type="submit" style={{ ...css.btn, opacity: f.name.trim() ? 1 : 0.4 }} disabled={!f.name.trim()}>Ekle</button>
        </div>
      </form>
      {data.portfolios.length === 0 && <Empty>Henüz portföy yok. Ekleyince işlem formunda seçilebilir olur.</Empty>}
      {data.portfolios.map((p, i, arr) => (
        <Row key={p.id} last={i === arr.length - 1}>
          {/* Faz 18: ad ve not satır içinde düzenlenir (sil+yeniden ekle işlemleri Gruplanmamış'a
              düşürür, yani grubu yeniden kurmak elle yeniden atama demek olurdu). */}
          {/* flexWrap: iki giriş alanı + sayaç dar ekranda tek satıra sığmıyor, sarmalanmazsa
              ad kutusu 40px'e eziliyordu (bkz. row-title kuralı — o dış satırı sarar, bu içini) */}
          <span className="row-title" style={{ flex: 1, fontSize: 13, display: "flex", gap: 6, alignItems: "center", minWidth: 0, flexWrap: "wrap" }}>
            <input style={{ ...css.input, fontWeight: 700, fontSize: 13, padding: "3px 6px", border: "1px solid transparent", background: "transparent", width: 130 }}
              defaultValue={p.name} key={`n${p.name}`} title="Portföy adı (düzenlemek için tıkla)"
              onFocus={(e) => { e.target.style.borderColor = T.line; e.target.style.background = T.panel2; }}
              onBlur={async (e) => {
                e.target.style.borderColor = "transparent"; e.target.style.background = "transparent";
                const v = e.target.value.trim();
                if (v && v !== p.name) { await api.put(`portfolios/${p.id}`, { name: v }); reload(); }
                else e.target.value = p.name;
              }} />
            <input style={{ ...css.input, color: T.mut, fontSize: 12, padding: "3px 6px", border: "1px solid transparent", background: "transparent", flex: 1, minWidth: 60 }}
              defaultValue={p.note ?? ""} key={`t${p.note ?? ""}`} placeholder="not ekle…" title="Not"
              onFocus={(e) => { e.target.style.borderColor = T.line; e.target.style.background = T.panel2; }}
              onBlur={async (e) => {
                e.target.style.borderColor = "transparent"; e.target.style.background = "transparent";
                const v = e.target.value.trim();
                if (v !== (p.note ?? "")) { await api.put(`portfolios/${p.id}`, { note: v || null }); reload(); }
              }} />
            <span style={{ color: T.mut3, fontSize: 11, whiteSpace: "nowrap" }}>{count(p.id)} işlem</span>
          </span>
          <span className="row-amount" style={{ ...css.mono, fontSize: 13 }}>{fmtMoney(Math.round(convert(groupValue(p.id), "TRY", ccy, rates)), ccy)}</span>
          {/* native confirm() yerine ortak SilDugmesi — tüm silmeler aynı onay kutusunu kullanır */}
          <SilDugmesi ad={p.name} title="Portföyü sil"
            onSil={async () => { await api.del("portfolios", p.id); reload(); }}
            sonuc={<>İçindeki <b>{count(p.id)} işlem silinmez</b>, "Gruplanmamış"a döner. Net varlık ve alokasyon değişmez.</>} />
        </Row>
      ))}
    </div>
  );
}
