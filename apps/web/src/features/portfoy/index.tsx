import React, { useEffect, useMemo, useState } from "react";
import {
  convert, positions, openPositions, groupTradesByPortfolio, portfolioValueTry, pnlPct,
  type AllData, type HistoryRange, type Position, type Rates, type Currency, type PortfolioKey,
} from "@finans/engine";
import { api } from "../../api";
import { T, css, fmtMoney, fmtPct, TYPE_COLORS } from "../../theme";
import { Empty, Field, Aciklama, SilDugmesi, useSayfalama, DahaFazla } from "../../ui";
import { Hareketler } from "./Hareketler";
import { DegerGrafigi } from "./DegerGrafigi";
import { VarlikTakibi } from "./VarlikTakibi";
import { VarlikTablosu } from "./VarlikTablosu";
import { PozisyonAyrinti } from "./PozisyonAyrinti";
import { AlokasyonSeridi, PortfoyHero, SonAylar, VarlikTreemap } from "./Gorsel";

/* ————— PORTFÖY SEKMESİ — İKİ SEVİYE (Faz 31) —————
   Sekme eskiden TEK uzun sayfaydı: pozisyonlar, değer grafiği, varlık takibi, hareketler ve
   portföy tanımları alt alta diziliyordu. Mobilde bu yedi ekran boyuydu ve asıl soru
   ("elimde ne var, ne kazandırıyor?") sayfanın en üstünde bir saniye görünüp kayboluyordu.

   Artık gezinme iki seviyeli:
     SEVİYE 1 — Liste: portföy toplamları + portföy grupları (tıklanabilir) + açık pozisyonlar.
                Detay analizi YOKTUR; ekran tek soruya cevap verir.
     SEVİYE 2 — Detay: bir gruba (ya da "Tüm portföy"e) tıklayınca açılır. Değer grafiği,
                varlık takibi, hareketler ve kapanan pozisyonlar buradadır.

   Detay AYNI SEKMEDE tam ekran açılır (modal değil): `.tab-grid`'in animasyon dolgusu
   `position:fixed` için kapsayıcı blok yarattığından modal portal gerektirir (CLAUDE.md,
   Faz 24 kural 5) ve uzun detay içeriği katman içinde kaydırmak mobilde sıkışık durur. */

/** Bir görünümün kapsamı: `"all"` tüm portföy, sayı bir grup id'si, `null` "Gruplanmamış" */
type Sel = "all" | PortfolioKey;
/** Hangi seviyedeyiz. `null` = liste. Nesne sarmalaması şart: `null` zaten geçerli bir
    kapsamdır (Gruplanmamış), düz `Sel | null` ikisini birbirine karıştırırdı. */
type Detay = { scope: Sel } | null;


/* K/Z gösterimi. `pct` verilirse tutarın yanında oranı da yazar — mutlak tutar tek başına
   ölçeksizdir (₺3.000 kâr, 10 binlik pozisyonda %30, 300 binlikte %1). Oran maliyet 0 ise
   (tamamı bedelsiz gelen pozisyon) null gelir ve hiç yazılmaz. */
const Signed = ({ v, ccy, size = 12, pct, bold }: { v: number; ccy: Currency; size?: number; pct?: number | null; bold?: boolean }) => (
  <span style={{ ...css.mono, fontSize: size, fontWeight: bold ? 600 : undefined, color: v > 0 ? T.pos : v < 0 ? T.neg : T.mut }}>
    {v > 0 ? "+" : ""}{fmtMoney(v, ccy)}
    {pct != null && <span style={{ opacity: 0.75 }}> ({fmtPct(pct)})</span>}
  </span>
);

/** Geri oku — tipografik "‹" yerine SVG (⏻/◐ gibi karakterler Android'de tofu ▯ çiziliyordu) */
const OkSol = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
/** Satırın "içine girilebilir" olduğunu söyleyen sağ ok */
const OkSag = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 18l6-6-6-6" />
  </svg>
);

/** Bir kapsamın özet rakamları — hem grup satırlarında hem başlıklarda kullanılır (TRY) */
type Ozet = { value: number; unreal: number; realized: number; pct: number | null; acik: number };

function ozetle(pos: Position[], rates: Rates): Ozet {
  const unreal = pos.reduce((s, p) => s + convert(p.unreal ?? 0, p.currency, "TRY", rates), 0);
  /* Toplam K/Z oranı: yüzdeler ORTALANAMAZ (₺100'lük %50 ile ₺100.000'lik %1 aynı ağırlıkta
     değil) — toplam K/Z, toplam maliyete bölünür. Fiyatı olmayan pozisyon iki toplama da girmez. */
  const cost = pos.reduce((s, p) => s + (p.unreal != null ? convert(p.qty * p.avg, p.currency, "TRY", rates) : 0), 0);
  return {
    value: portfolioValueTry(pos, rates),
    unreal,
    /* Gerçekleşen K/Z SÜZÜLMEMİŞ listeden gelir: çoğu zaten kapanmış pozisyonlardan doğar,
       açık pozisyonlarla birlikte süzmek geçmiş kârı sessizce silerdi. */
    realized: pos.reduce((s, p) => s + convert(p.realized, p.currency, "TRY", rates), 0),
    pct: pnlPct(unreal, cost),
    acik: openPositions(pos).length,
  };
}

export function Portfoy({ data, pos: allPos, rates, ccy, reload }: {
  data: AllData; pos: Position[]; rates: Rates; ccy: Currency; reload: () => void;
}) {
  const [detay, setDetay] = useState<Detay>(null);

  /* Portföy grupları (Faz 11): gruplama işlem düzeyinde, pozisyonlar grup başına AYRI hesaplanır —
     aynı sembol iki portföyde ayrı ortalama maliyetle durur. "Tüm portföy" kapsamında App'in
     hesapladığı birleşik pozisyon listesi kullanılır (net varlıkla birebir aynı rakam). */
  const byPortfolio = useMemo(() => groupTradesByPortfolio(data.trades), [data.trades]);
  const tradesOf = (s: Sel) => (s === "all" ? data.trades : byPortfolio.get(s) ?? []);
  const posOf = (s: Sel) => (s === "all" ? allPos : positions(tradesOf(s), data.prices));

  /* Açık detayın grubu silinirse listeye dön — aksi halde erişilemeyen boş bir ekranda kalınırdı. */
  useEffect(() => {
    if (detay && detay.scope !== "all" && detay.scope !== null && !data.portfolios.some((p) => p.id === detay.scope)) {
      setDetay(null);
    }
  }, [data.portfolios, detay]);

  /* Seviye değişince sayfa başa sarılır: detaya girince tarayıcı kaydırma konumunu koruyor ve
     ekran ortasından açılıyordu (yeni başlık hiç görülmüyordu). */
  useEffect(() => { window.scrollTo({ top: 0 }); }, [detay]);

  if (detay) {
    return (
      <PortfoyDetay
        data={data} scope={detay.scope} trades={tradesOf(detay.scope)} pos={posOf(detay.scope)}
        rates={rates} ccy={ccy} reload={reload} onBack={() => setDetay(null)}
      />
    );
  }
  return (
    <PortfoyListe
      data={data} allPos={allPos} rates={rates} ccy={ccy} reload={reload}
      tradesOf={tradesOf} posOf={posOf} onOpen={(scope) => setDetay({ scope })}
    />
  );
}

/* ————— SEVİYE 1: LİSTE ————— */

function PortfoyListe({ data, allPos, rates, ccy, reload, tradesOf, posOf, onOpen }: {
  data: AllData; allPos: Position[]; rates: Rates; ccy: Currency; reload: () => void;
  tradesOf: (s: Sel) => ReturnType<() => AllData["trades"]>;
  posOf: (s: Sel) => Position[];
  onOpen: (s: Sel) => void;
}) {
  const [range, setRange] = useState<HistoryRange>("1A");
  const toplam = useMemo(() => ozetle(allPos, rates), [allPos, rates]);

  /* "Gruplanmamış" satırı yalnız HEM gruplanmış HEM gruplanmamış işlem varken anlamlı:
     hiçbiri gruplanmamışsa birebir "Tüm portföy" ile aynıdır (gereksiz satır), hepsi
     gruplanmışsa zaten boştur. Böylece satır "atamayı unuttuklarım" görünümü olarak iş görür. */
  const ungroupedCount = tradesOf(null).length;
  const hasUngrouped = ungroupedCount > 0 && ungroupedCount < data.trades.length;

  const satirlar = useMemo(() => {
    const out: { scope: Sel; ad: string; not: string | null; ozet: Ozet }[] = [
      { scope: "all", ad: "Tüm portföy", not: null, ozet: toplam },
    ];
    for (const p of data.portfolios) out.push({ scope: p.id, ad: p.name, not: p.note, ozet: ozetle(posOf(p.id), rates) });
    if (hasUngrouped) out.push({ scope: null, ad: "Gruplanmamış", not: "henüz bir portföye atanmamış işlemler", ozet: ozetle(posOf(null), rates) });
    return out;
  }, [data.portfolios, data.trades, data.prices, rates, toplam, hasUngrouped]);

  return (<>
    {/* HERO KARTI: değer + dönem kârı + seyir + dağılım, sonra gruplara giriş.
        Fiyat yenileme düğmesi BİLEREK yok: App kabuğu zaten hem masaüstü üst çubuğunda hem
        mobil ⋯ menüsünde "Fiyatları yenile" sunuyor; karttaki üçüncü kopya, ekranın ilk
        bakışta cevaplaması gereken soruyla ("ne kadarım var, ne kazandırıyor") yarışıyordu. */}
    <div style={css.card}>
      <PortfoyHero
        trades={data.trades} priceHistory={data.price_history} rates={rates} ccy={ccy}
        deger={toplam.value} unreal={toplam.unreal} unrealPct={toplam.pct} realized={toplam.realized}
        etiket="Portföy değeri" range={range} onRange={setRange}
      />
      <AlokasyonSeridi pos={allPos} rates={rates} ccy={ccy} />
    </div>

    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Portföyler</div>
      <Aciklama k="portfoy-gruplari" label="portföy grubu ne işe yarar?">
        Varlıklarını mantıksal olarak ayır (ör. <b>Alfa Portföy</b>, <b>Emeklilik</b>, <b>Büyüme</b>).
        Gruplama <b>işlem düzeyindedir</b>: aynı sembolü iki portföyde ayrı ortalama maliyetle tutabilirsin.
        Net varlık ve alokasyon değişmez — bu yalnız takip/raporlama içindir.
        Bir portföye <b>tıklayınca</b> değer grafiği, varlık takibi ve hareket geçmişi açılır.
      </Aciklama>
      {satirlar.map((r) => (
        <PortfoySatiri key={String(r.scope)} ad={r.ad} not={r.not} ozet={r.ozet} ccy={ccy} rates={rates} onClick={() => onOpen(r.scope)} />
      ))}
      <YeniPortfoy reload={reload} />
    </div>

    {/* ALT KART: "elimde ne var, ne kazandırıyor" — ekranın asıl sorusu */}
    <div style={css.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Açık Pozisyonlar</div>
        <div style={{ fontSize: 12, color: T.mut }}>{toplam.acik} varlık</div>
      </div>
      <PozisyonListesi data={data} pos={allPos} ccy={ccy} rates={rates} reload={reload} />
    </div>
  </>);
}

/** Portföy grubu satırı — tıklanınca detayına girilir */
function PortfoySatiri({ ad, not, ozet, ccy, rates, onClick }: {
  ad: string; not: string | null; ozet: Ozet; ccy: Currency; rates: Rates; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} title={`${ad} detayını aç`}
      className="ui-row"
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
        padding: "11px 10px", marginBottom: 6, borderRadius: 10, cursor: "pointer",
        background: T.panel2, border: `1px solid ${T.line}`, color: T.text, fontFamily: T.disp, flexWrap: "wrap",
      }}>
      <span className="row-title" style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
        <span style={{ fontWeight: 700, fontSize: 13.5 }}>{ad}</span>
        <span style={{ fontSize: 11, color: T.mut3 }}>
          {ozet.acik} açık pozisyon{not ? ` · ${not}` : ""}
        </span>
      </span>
      <span className="row-amount" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, marginLeft: "auto" }}>
        <span style={{ ...css.mono, fontSize: 14, fontWeight: 600 }}>
          {fmtMoney(Math.round(convert(ozet.value, "TRY", ccy, rates)), ccy)}
        </span>
        <Signed v={Math.round(convert(ozet.unreal, "TRY", ccy, rates))} ccy={ccy} size={11} pct={ozet.pct} />
      </span>
      <span className="row-end" style={{ color: T.mut3, display: "grid", placeItems: "center", flexShrink: 0 }}><OkSag /></span>
    </button>
  );
}

/** Yeni portföy grubu ekleme — tanım formu, listenin altında (işlem girişi değil, o global "+ Ekle"de) */
function YeniPortfoy({ reload }: { reload: () => void }) {
  const [acik, setAcik] = useState(false);
  const [f, setF] = useState({ name: "", note: "" });
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return;
    await api.post("portfolios", { name: f.name.trim(), note: f.note.trim() || null });
    setF({ name: "", note: "" });
    setAcik(false);
    reload();
  };
  if (!acik) {
    return (
      <button type="button" onClick={() => setAcik(true)} style={{ ...css.ghost, fontSize: 12.5, padding: "7px 12px", marginTop: 2 }}>
        + Yeni portföy
      </button>
    );
  }
  return (
    <form onSubmit={add} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
      <Field label="Ad" flex={2}>
        <input style={css.input} value={f.name} autoFocus placeholder="örn. Alfa Portföy" onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Field>
      <Field label="Not (ops.)" flex={2}>
        <input style={css.input} value={f.note} placeholder="örn. büyüme hisseleri" onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Field>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
        <button type="submit" style={{ ...css.btn, opacity: f.name.trim() ? 1 : 0.4 }} disabled={!f.name.trim()}>Ekle</button>
        <button type="button" style={css.ghost} onClick={() => setAcik(false)}>Vazgeç</button>
      </div>
    </form>
  );
}

/* ————— SEVİYE 2: DETAY ————— */

function PortfoyDetay({ data, scope, trades, pos, rates, ccy, reload, onBack }: {
  data: AllData; scope: Sel; trades: AllData["trades"]; pos: Position[];
  rates: Rates; ccy: Currency; reload: () => void; onBack: () => void;
}) {
  // hareket listesinin sembol filtresi — açılan pozisyon satırından da dolar
  const [symFilter, setSymFilter] = useState<string | null>(null);
  const [sekme, setSekme] = useState<DetaySekme>("varliklar");
  const grup = typeof scope === "number" ? data.portfolios.find((p) => p.id === scope) ?? null : null;
  const ad = scope === "all" ? "Tüm portföy" : scope === null ? "Gruplanmamış" : grup?.name ?? "Portföy";
  const ozet = useMemo(() => ozetle(pos, rates), [pos, rates]);
  /* Grafik/hareketler başlığındaki kapsam etiketi: "Tüm portföy"de gereksiz (zaten hepsi). */
  const scopeLabel = scope === "all" ? null : ad;

  /* "Hareketlerini gör" düğmesi hem sembolü süzer hem İşlem Geçmişi sekmesine geçer —
     yoksa düğmeye basınca görünürde hiçbir şey olmuyordu (liste başka sekmedeydi). */
  const hareketlereGit = (s: string) => { setSymFilter(s); setSekme("hareketler"); };

  return (<>
    {/* ——— BAŞLIK KARTI: kimlik + aylık ritim ——— */}
    <div style={css.card}>
      <button type="button" onClick={onBack}
        style={{
          ...css.ghost, display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: 12.5, padding: "6px 12px", marginBottom: 12,
        }}>
        <OkSol /> Tüm Portföyler
      </button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 240, flex: "1 1 260px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            {/* Grubun ADI ve NOTU burada düzenlenir: bu ekran o grubun kendi ekranıdır.
                "Tüm portföy" ve "Gruplanmamış" gerçek kayıt değildir — düzenlenemez. */}
            {grup
              ? <GrupBasligi grup={grup} reload={reload} />
              : <div style={{ fontWeight: 700, fontSize: 19 }}>{ad}</div>}
            {grup && (
              <SilDugmesi ad={grup.name} title="Portföyü sil"
                onSil={async () => { await api.del("portfolios", grup.id); onBack(); reload(); }}
                sonuc={<>İçindeki <b>{trades.length} işlem silinmez</b>, "Gruplanmamış"a döner. Net varlık ve alokasyon değişmez.</>} />
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            <Rozet>{ozet.acik} varlık</Rozet>
            <Rozet>{trades.length} işlem</Rozet>
          </div>
          <div style={{ ...css.mono, fontSize: 26, fontWeight: 700, lineHeight: 1.1, marginTop: 12 }}>
            {fmtMoney(Math.round(convert(ozet.value, "TRY", ccy, rates)), ccy)}
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 5, fontSize: 12, color: T.mut }}>
            <span>açık K/Z <Signed v={Math.round(convert(ozet.unreal, "TRY", ccy, rates))} ccy={ccy} pct={ozet.pct} /></span>
            <span>gerç. K/Z <Signed v={Math.round(convert(ozet.realized, "TRY", ccy, rates))} ccy={ccy} /></span>
          </div>
        </div>
        <div style={{ flex: "1 1 260px", minWidth: 240 }}>
          <SonAylar trades={trades} priceHistory={data.price_history} rates={rates} />
        </div>
      </div>
      <AlokasyonSeridi pos={pos} rates={rates} ccy={ccy} />
    </div>

    {/* ——— PERFORMANS: yüzde modunda açılır (buradaki soru "nasıl gittim") ——— */}
    <DegerGrafigi
      trades={trades} priceHistory={data.price_history} benchmarks={data.benchmark_history}
      rates={rates} ccy={ccy} height={210} scopeLabel={scopeLabel}
      title="Performans Analizi" altBaslik="TL bazlı kümülatif getiri (para akışı arındırılmış)"
      defaultMode="PCT"
    />

    {/* ——— DAĞILIM: boyut = ağırlık, renk = performans ——— */}
    <VarlikTreemap pos={pos} priceHistory={data.price_history} rates={rates} ccy={ccy} />

    {/* ——— SEKMELER ———
        Kartları alt alta yığmak yerine tek kartta değiştiriyoruz: üç liste de uzun ve aynı
        anda hiçbiri diğerinin yanında okunmuyor; yığılınca ekran yine kilometrelerce oluyordu. */}
    <div style={css.card}>
      {/* Şerit SARMAZ, yatay KAYAR: 390px'te üç etiket tek satıra sığmıyor ve sarmalandığında
          alt çizgi ikiye bölünüp "sekme" hissi kayboluyordu. Kaydırma mobilde standart desen. */}
      <div style={{
        display: "flex", gap: 2, borderBottom: `1px solid ${T.line}`, marginBottom: 12,
        flexWrap: "nowrap", overflowX: "auto", maxWidth: "100%",
      }}>
        {DETAY_SEKMELER.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setSekme(k)} style={{
            padding: "9px 13px", border: "none", background: "none", cursor: "pointer",
            fontFamily: T.disp, fontSize: 13, fontWeight: sekme === k ? 700 : 500,
            color: sekme === k ? T.acc : T.mut, minHeight: 0, whiteSpace: "nowrap", flexShrink: 0,
            borderBottom: `2px solid ${sekme === k ? T.acc : "transparent"}`, marginBottom: -1,
          }}>{label}</button>
        ))}
      </div>

      {sekme === "varliklar" && (
        <VarlikTablosu data={data} pos={pos} ccy={ccy} rates={rates} reload={reload} onSymbol={hareketlereGit} />
      )}
      {sekme === "takip" && (
        <VarlikTakibi data={data} trades={trades} pos={pos} rates={rates} scopeLabel={null} govdesiz />
      )}
      {sekme === "hareketler" && (
        <Hareketler data={data} trades={trades} reload={reload} scopeLabel={null}
          symbol={symFilter} onSymbol={setSymFilter} govdesiz />
      )}
    </div>
  </>);
}

/** Detay sekmeleri — referans paneldeki "Mevcut Varlıklar | İşlem Geçmişi" düzeninin karşılığı;
    aradaki "Varlık Takibi" bizim eklememiz (pozisyon ömürleri + dönem akışı, Faz 31). */
type DetaySekme = "varliklar" | "takip" | "hareketler";
const DETAY_SEKMELER: [DetaySekme, string][] = [
  ["varliklar", "Mevcut Varlıklar"],
  ["takip", "Varlık Takibi"],
  ["hareketler", "İşlem Geçmişi"],
];

/** Küçük nötr etiket (varlık sayısı, işlem sayısı) */
const Rozet = ({ children }: { children: React.ReactNode }) => (
  <span style={{
    fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
    background: T.panel2, color: T.mut, border: `1px solid ${T.line}`,
  }}>{children}</span>
);

/** Detay başlığında grup adı + notu satır içinde düzenlenir (sil+yeniden ekle işlemleri
    "Gruplanmamış"a düşürürdü, yani grubu yeniden kurmak elle yeniden atama demek olurdu). */
function GrupBasligi({ grup, reload }: { grup: AllData["portfolios"][number]; reload: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <input
        key={`n${grup.name}`} defaultValue={grup.name} title="Portföy adı (düzenlemek için tıkla)"
        style={{ ...css.input, fontFamily: T.disp, fontWeight: 700, fontSize: 19, padding: "2px 6px", border: "1px solid transparent", background: "transparent", width: "100%", maxWidth: 260 }}
        onFocus={(e) => { e.target.style.borderColor = T.line; e.target.style.background = T.panel2; }}
        onBlur={async (e) => {
          e.target.style.borderColor = "transparent"; e.target.style.background = "transparent";
          const v = e.target.value.trim();
          if (v && v !== grup.name) { await api.put(`portfolios/${grup.id}`, { name: v }); reload(); }
          else e.target.value = grup.name;
        }} />
      <input
        key={`t${grup.note ?? ""}`} defaultValue={grup.note ?? ""} placeholder="not ekle…" title="Not"
        style={{ ...css.input, fontFamily: T.disp, color: T.mut, fontSize: 12, padding: "2px 6px", border: "1px solid transparent", background: "transparent", width: "100%", maxWidth: 260 }}
        onFocus={(e) => { e.target.style.borderColor = T.line; e.target.style.background = T.panel2; }}
        onBlur={async (e) => {
          e.target.style.borderColor = "transparent"; e.target.style.background = "transparent";
          const v = e.target.value.trim();
          if (v !== (grup.note ?? "")) { await api.put(`portfolios/${grup.id}`, { note: v || null }); reload(); }
        }} />
    </div>
  );
}

/* ————— PAYLAŞILAN: AÇIK POZİSYON LİSTESİ —————
   Hem liste hem detay ekranı aynı bileşeni kullanır; iki kopya olsaydı fiyat girişi ya da
   "nakit say" düğmesi yalnız birinde güncellenirdi.

   Faz 31'de iki şey değişti:
   1) VARLIK SINIFI AKORDEONU KALKTI. Liste artık DÜZ ve DEĞERE göre sıralı — "en büyük
      pozisyonum ne?" sorusu tek bakışta cevaplanıyor. Sınıf bilgisi satırdaki rozette kalır,
      sınıf dağılımını da alokasyon şeridi çok daha iyi anlatıyor (akordeon kapalıyken
      dağılımı hiç söylemiyordu, açıkken de kafada toplamak gerekiyordu).
   2) FORM KUTULARI SATIRDAN ÇIKTI. Her satırda duran fiyat giriş kutusu + "oto" rozeti +
      "sıfırla" düğmesi, varlık listesini bir ayar ekranına benzetiyordu. Artık satıra
      dokununca AÇILIYOR. Tek istisna: fiyatı hiç bilinmeyen varlık — orada giriş kutusu
      kendiliğinden açık gelir, çünkü o satır gerçekten eylem bekliyor. */

function PozisyonListesi({ data, pos, ccy, rates, reload, onSymbol }: {
  data: AllData; pos: Position[]; ccy: Currency; rates: Rates; reload: () => void;
  /** verilirse açılan satırda "hareketlerini gör" çıkar (detayda listeyi süzer) */
  onSymbol?: (s: string) => void;
}) {
  /* Listede YALNIZ elde tutulanlar görünür. `positions()` bilerek işlem görmüş her sembolü
     döndürür (kapananların gerçekleşen K/Z'si toplamlarda gerekli) — süzülmediği için satılmış
     hisseler "0 adet · ort. 0,00" diye listede duruyordu. */
  const acikPos = useMemo(
    () => openPositions(pos).sort((a, b) =>
      convert(b.value ?? 0, b.currency, "TRY", rates) - convert(a.value ?? 0, a.currency, "TRY", rates)),
    [pos, rates],
  );
  const toplamTry = useMemo(
    () => acikPos.reduce((s, p) => s + convert(p.value ?? 0, p.currency, "TRY", rates), 0),
    [acikPos, rates],
  );

  /* Para piyasası (nakit sayılan) fonlar — Nakit Akışı takviminde nakit gibi değerlenir */
  const cashFunds = new Set((data.settings.cash_funds || "").split(",").map((s) => s.trim()).filter(Boolean));
  const toggleCashFund = async (sym: string) => {
    const next = new Set(cashFunds);
    next.has(sym) ? next.delete(sym) : next.add(sym);
    await api.put("settings", { cash_funds: [...next].join(",") });
    reload();
  };

  /* Bu liste diğer sayfalananlardan CİNS OLARAK farklı: satır sayısı işlem sayısıyla değil
     KAÇ FARKLI VARLIK TUTTUĞUNLA sınırlı ve sattığında satır kaybolur — zamanla monoton
     büyümüyor. Bu yüzden dilim cömert: 25 pozisyonun altında `DahaFazla` hiç render edilmez
     (tek sayfaya sığıyor), yani normal kullanıcı hiçbir şey görmez. Çok sayıda fon tutan
     uç durum için de sayfa şişmez. */
  const s = useSayfalama(acikPos, 25);

  if (acikPos.length === 0) {
    return <Empty>{pos.length === 0
      ? "Henüz işlem yok. İlk alışını global + Ekle ile kaydet."
      : "Açık pozisyon yok — tümü kapanmış."}</Empty>;
  }

  return (<>
    {s.gorunen.map((p, i) => (
      <VarlikSatiri
        key={`${p.type}:${p.sym}`} p={p} ccy={ccy} rates={rates} reload={reload}
        agirlik={toplamTry > 0 ? convert(p.value ?? 0, p.currency, "TRY", rates) / toplamTry : null}
        nakitSayilir={cashFunds.has(p.sym)} onNakitSay={() => toggleCashFund(p.sym)}
        onSymbol={onSymbol} son={i === s.gorunen.length - 1 && s.toplam === s.gosterilen}
      />
    ))}
    <DahaFazla s={s} ad="pozisyon" yon="fazla" />
  </>);
}

/** Tek varlık satırı: üstte kimlik + değer, altta adet/ağırlık + K/Z. Dokununca ayrıntı açılır. */
function VarlikSatiri({ p, ccy, rates, reload, agirlik, nakitSayilir, onNakitSay, onSymbol, son }: {
  p: Position; ccy: Currency; rates: Rates; reload: () => void;
  agirlik: number | null; nakitSayilir: boolean; onNakitSay: () => void;
  onSymbol?: (s: string) => void; son: boolean;
}) {
  /* Fiyatı olmayan varlık ayrıntısı AÇIK gelir: o satır bir eylem bekliyor ("elle gir"),
     kapalı gelseydi kullanıcı neden değersiz göründüğünü göremezdi. */
  const [acik, setAcik] = useState(p.cur == null);
  /* Ondalık ayırıcı VİRGÜL — `toFixed` nokta üretiyor ve listede "0.05 adet" diye
     görünüyordu, oysa yanındaki her tutar "₺12.500" biçiminde (nokta = binlik). */
  const adet = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "").replace(".", ","));
  const yukari = (p.unreal ?? 0) >= 0;

  return (
    <div style={{ borderBottom: son && !acik ? "none" : `1px solid ${T.line}` }}>
      <div className="ui-row" onClick={() => setAcik((v) => !v)}
        title={acik ? "Ayrıntıyı kapat" : "Ayrıntı ve fiyat ayarı"}
        style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 2px", cursor: "pointer", userSelect: "none" }}>
        {/* Monogram: SEMBOLÜN ilk iki harfi, varlık sınıfının rengiyle. Önce varlık TÜRÜNÜN
            ilk üç harfi yazılıyordu ve "BIST" → "BIS" diye kesilip yazım hatası gibi
            duruyordu; üstelik aynı sınıftaki iki hisse birbirinden ayırt edilemiyordu.
            Renk alokasyon şeridindeki dilimle eşleşir — "şeritteki mor hangisiydi" cevabı. */}
        <span className="row-lead" style={{
          width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: "grid", placeItems: "center",
          background: T.panel2, color: TYPE_COLORS[p.type] || T.mut,
          fontFamily: T.disp, fontSize: 12.5, fontWeight: 800, letterSpacing: "-0.03em",
        }}>{p.sym.slice(0, 2).toLocaleUpperCase("tr")}</span>

        <span className="row-title" style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
          <span style={{ display: "flex", alignItems: "baseline", gap: 5, flexWrap: "wrap" }}>
            <span style={{ ...css.mono, fontWeight: 700, fontSize: 15 }}>{p.sym}</span>
            {p.currency === "USD" && <span style={{ fontSize: 9.5, fontWeight: 700, color: T.mut3 }}>USD</span>}
            {nakitSayilir && (
              <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 999, background: T.posSoft, color: T.pos }}>nakit</span>
            )}
          </span>
          <span style={{ fontSize: 11.5, color: T.mut3 }}>
            <span style={{ color: TYPE_COLORS[p.type] || T.mut3, fontWeight: 600 }}>{p.type}</span>
            {" · "}{adet(p.qty)} adet
            {/* Yalnız oran yazılır, "portföy" kelimesi değil: 390px'te alt satırı sarmalayıp
                tek başına "portföy" kalan ikinci bir satır açıyordu. Neyin oranı olduğunu
                hemen üstteki alokasyon şeridi zaten söylüyor. */}
            {agirlik != null && agirlik > 0 && <> · %{(agirlik * 100).toFixed(agirlik < 0.1 ? 1 : 0).replace(".", ",")}</>}
          </span>
        </span>

        <span className="row-amount" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, marginLeft: "auto" }}>
          <span style={{ ...css.mono, fontSize: 14.5, fontWeight: 600 }}>
            {p.value != null ? fmtMoney(Math.round(p.value), p.currency) : "—"}
          </span>
          {p.unreal != null
            ? <span style={{ ...css.mono, fontSize: 11.5, color: yukari ? T.pos : T.neg }}>
              {yukari ? "▲" : "▼"} {yukari ? "+" : ""}{fmtMoney(Math.round(p.unreal), p.currency)}
              {p.unrealPct != null && <> ({fmtPct(p.unrealPct)})</>}
            </span>
            : <span style={{ fontSize: 11, color: T.neg }}>fiyat yok</span>}
        </span>
      </div>

      {acik && (
        <PozisyonAyrinti
          p={p} reload={reload} nakitSayilir={nakitSayilir} onNakitSay={onNakitSay}
          onSymbol={onSymbol} solBosluk={46}
        />
      )}
    </div>
  );
}
