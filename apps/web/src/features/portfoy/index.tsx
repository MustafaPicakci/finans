import React, { useEffect, useMemo, useState } from "react";
import {
  convert, positions, openPositions, groupTradesByPortfolio, portfolioValueTry, pnlPct,
  type AllData, type HistoryRange, type Position, type Rates, type Currency, type PortfolioKey,
} from "@finans/engine";
import { api } from "../../api";
import { T, css, fmtMoney, fmtPct, TYPE_COLORS } from "../../theme";
import { Empty, Aciklama, SilDugmesi, Modal, useSayfalama, DahaFazla } from "../../ui";
import { Bolum, Etiketli, FormAlt, Segment, girdi } from "../forms/parcalar";
import { Hareketler } from "./Hareketler";
import { DegerGrafigi } from "./DegerGrafigi";
import { VarlikTakibi } from "./VarlikTakibi";
import { VarlikTablosu } from "./VarlikTablosu";
import { PozisyonSayfasi } from "./PozisyonAyrinti";
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
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

/* ————— SEVİYE 1: LİSTE —————
   Yeniden tasarım (Ekim 2026, grup 4): "Tüm portföy" artık Portföyler listesinin bir satırı DEĞİL —
   üst kart zaten tüm portföyün kartıdır, detayına sağ üstteki "Ayrıntı ›" ile girilir (aynı rakam
   iki kez, biri kartta biri satırda yazılıyordu). Masaüstünde üst kart | portföyler yan yana. */

function PortfoyListe({ data, allPos, rates, ccy, reload, tradesOf, posOf, onOpen }: {
  data: AllData; allPos: Position[]; rates: Rates; ccy: Currency; reload: () => void;
  tradesOf: (s: Sel) => ReturnType<() => AllData["trades"]>;
  posOf: (s: Sel) => Position[];
  onOpen: (s: Sel) => void;
}) {
  const [range, setRange] = useState<HistoryRange>("1A");
  const [yeniGrup, setYeniGrup] = useState(false);
  const toplam = useMemo(() => ozetle(allPos, rates), [allPos, rates]);

  /* "Gruplanmamış" satırı yalnız HEM gruplanmış HEM gruplanmamış işlem varken anlamlı:
     hiçbiri gruplanmamışsa birebir "Tüm portföy" ile aynıdır (gereksiz satır), hepsi
     gruplanmışsa zaten boştur. Böylece satır "atamayı unuttuklarım" görünümü olarak iş görür. */
  const ungroupedCount = tradesOf(null).length;
  const hasUngrouped = ungroupedCount > 0 && ungroupedCount < data.trades.length;

  const satirlar = useMemo(() => {
    const out: { scope: Sel; ad: string; not: string | null; ozet: Ozet }[] = [];
    for (const p of data.portfolios) out.push({ scope: p.id, ad: p.name, not: p.note, ozet: ozetle(posOf(p.id), rates) });
    if (hasUngrouped) out.push({ scope: null, ad: "Gruplanmamış", not: "henüz bir portföye atanmamış işlemler", ozet: ozetle(posOf(null), rates) });
    return out;
  }, [data.portfolios, data.trades, data.prices, rates, hasUngrouped]);

  return (<>
    <div className="port-ust">
      {/* ÜST KART: değer + dönem kârı + seyir + dağılım.
          Fiyat yenileme düğmesi BİLEREK yok: App kabuğu zaten hem masaüstü üst çubuğunda hem
          Menü'de "Fiyatları yenile" sunuyor; karttaki üçüncü kopya, ekranın ilk bakışta
          cevaplaması gereken soruyla ("ne kadarım var, ne kazandırıyor") yarışıyordu. */}
      <div style={css.card}>
        <PortfoyHero
          trades={data.trades} priceHistory={data.price_history} rates={rates} ccy={ccy}
          deger={toplam.value} unreal={toplam.unreal} unrealPct={toplam.pct} realized={toplam.realized}
          etiket="Portföy değeri" range={range} onRange={setRange}
          sag={data.trades.length > 0 && (
            <button type="button" onClick={() => onOpen("all")} style={baglanti}>Ayrıntı <OkSag /></button>
          )}
        />
        <AlokasyonSeridi pos={allPos} rates={rates} ccy={ccy} />
      </div>

      <div style={css.card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <div style={{ fontWeight: 700, fontSize: 16, flex: 1 }}>Portföyler</div>
          <button type="button" onClick={() => setYeniGrup(true)} style={baglanti}>+ Portföy</button>
        </div>
        <Aciklama k="portfoy-gruplari" label="portföy grubu ne işe yarar?">
          Varlıklarını mantıksal olarak ayır (ör. <b>Alfa Portföy</b>, <b>Emeklilik</b>, <b>Büyüme</b>).
          Gruplama <b>işlem düzeyindedir</b>: aynı sembolü iki portföyde ayrı ortalama maliyetle tutabilirsin.
          Net varlık ve alokasyon değişmez — bu yalnız takip/raporlama içindir.
          Bir portföye <b>dokununca</b> getiri grafiği, varlık takibi ve işlem geçmişi açılır.
        </Aciklama>
        {satirlar.length === 0
          ? <div style={{ fontSize: 13.5, color: T.mut, padding: "8px 0" }}>Henüz portföy grubun yok. Tüm portföyün ayrıntısı üstteki karttan açılır.</div>
          : satirlar.map((r, i) => (
            <PortfoySatiri key={String(r.scope)} ad={r.ad} not={r.not} ozet={r.ozet} ccy={ccy} rates={rates}
              ilk={i === 0} onClick={() => onOpen(r.scope)} />
          ))}
      </div>
    </div>

    {/* ALT KART: "elimde ne var, ne kazandırıyor" — ekranın asıl sorusu */}
    <div style={css.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Açık pozisyonlar</div>
        <div style={{ fontSize: 13, color: T.mut }}>{toplam.acik} varlık</div>
      </div>
      <PozisyonListesi data={data} pos={allPos} ccy={ccy} rates={rates} reload={reload} />
    </div>

    {yeniGrup && <GrupSayfasi grup={null} islem={0} reload={reload} onClose={() => setYeniGrup(false)} />}
  </>);
}

/** Kart başlığındaki metin bağlantısı ("Ayrıntı ›", "+ Portföy") — eylem ama birincil değil */
const baglanti: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 2, background: "none", border: "none", padding: "4px 0",
  color: T.acc, fontFamily: T.disp, fontSize: 14, fontWeight: 600, cursor: "pointer", minHeight: 0, whiteSpace: "nowrap",
};

/** Portföy grubu satırı — dokununca detayına girilir */
function PortfoySatiri({ ad, not, ozet, ccy, rates, onClick, ilk }: {
  ad: string; not: string | null; ozet: Ozet; ccy: Currency; rates: Rates; onClick: () => void; ilk: boolean;
}) {
  return (
    <button type="button" onClick={onClick} title={`${ad} detayını aç`} className="liste-satir"
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
        padding: "12px 6px", margin: "0 -6px", boxSizing: "content-box", cursor: "pointer",
        background: "transparent", border: "none", borderTop: ilk ? "none" : `1px solid ${T.line2}`, borderRadius: 8,
        color: T.text, fontFamily: T.disp,
      }}>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
        <span style={{ fontWeight: 600, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ad}</span>
        <span style={{ fontSize: 12.5, color: T.mut, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {ozet.acik} açık pozisyon{not ? ` · ${not}` : ""}
        </span>
      </span>
      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
        <span style={{ ...css.mono, fontSize: 15, fontWeight: 600 }}>
          {fmtMoney(Math.round(convert(ozet.value, "TRY", ccy, rates)), ccy)}
        </span>
        <Signed v={Math.round(convert(ozet.unreal, "TRY", ccy, rates))} ccy={ccy} size={12.5} pct={ozet.pct} />
      </span>
      <span style={{ color: T.mut3, display: "grid", placeItems: "center", flexShrink: 0 }}><OkSag /></span>
    </button>
  );
}

/** Portföy grubu ekle/düzenle sayfası. Grup bir TANIM kaydıdır: adı ve notu burada, silme de burada
    (Kartlar/Hesaplar'daki desen — eskiden detay başlığında satır içi input + çıplak ✕ vardı). */
function GrupSayfasi({ grup, islem, reload, onClose, onSilindi }: {
  grup: AllData["portfolios"][number] | null; islem: number; reload: () => void; onClose: () => void; onSilindi?: () => void;
}) {
  const [f, setF] = useState({ name: grup?.name ?? "", note: grup?.note ?? "" });
  const ok = !!f.name.trim();
  const kaydet = async () => {
    if (!ok) return;
    const govde = { name: f.name.trim(), note: f.note.trim() || null };
    if (grup) await api.put(`portfolios/${grup.id}`, govde);
    else await api.post("portfolios", govde);
    reload(); onClose();
  };
  return (
    <Modal title={grup ? "Portföyü düzenle" : "Portföy ekle"} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); kaydet(); }}>
        <Bolum>
          <Etiketli etiket="Ad">
            <input autoFocus={!grup} style={girdi} value={f.name} placeholder="örn. Emeklilik" onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Etiketli>
          <Etiketli etiket="Not (isteğe bağlı)">
            <input style={girdi} value={f.note} placeholder="örn. uzun vadeli fonlar" onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Etiketli>
          {!grup && (
            <div style={{ fontSize: 13, color: T.mut, lineHeight: 1.45 }}>
              İşlemleri gruba alış/satış formundaki <b>Portföy</b> satırından atarsın; var olan bir işlemi taşımak için işlemi düzenle.
            </div>
          )}
        </Bolum>
        <FormAlt ok={ok} reason="Portföyün adını yaz." editing etiket={grup ? "Değişikliği kaydet" : "Portföyü ekle"}
          sonuc={grup ? <>Ad ve not değişir; işlemler ve rakamlar aynı kalır.</> : <>Yeni grup boş açılır — net varlık ve alokasyon değişmez.</>}
          sil={grup ? (
            <SilDugmesi ad={grup.name} title="Portföyü sil" ikon="Sil" className="form-sil"
              style={{ color: T.neg, fontSize: 14.5, fontWeight: 600, padding: "8px 6px" }}
              onSil={async () => { await api.del("portfolios", grup.id); onClose(); onSilindi?.(); reload(); }}
              sonuc={<>İçindeki <b>{islem} işlem silinmez</b>, "Gruplanmamış"a döner. Net varlık ve alokasyon değişmez.</>} />
          ) : undefined} />
      </form>
    </Modal>
  );
}

/* ————— SEVİYE 2: DETAY —————
   Yeniden tasarım (grup 4): başlık ← + ad + "N varlık · N işlem · not" + Düzenle (yalnız gerçek
   grupta); son ayların getirisi küçük kutular; masaüstünde getiri grafiği | dağılım yan yana;
   altta üç sekme (Varlıklar — telefonda liste, masaüstünde tablo | Takip | İşlemler). */

function PortfoyDetay({ data, scope, trades, pos, rates, ccy, reload, onBack }: {
  data: AllData; scope: Sel; trades: AllData["trades"]; pos: Position[];
  rates: Rates; ccy: Currency; reload: () => void; onBack: () => void;
}) {
  // hareket listesinin sembol filtresi — pozisyon sayfasındaki "Hareketlerini gör"den de dolar
  const [symFilter, setSymFilter] = useState<string | null>(null);
  const [sekme, setSekme] = useState<DetaySekme>("varliklar");
  const [duzenle, setDuzenle] = useState(false);
  const grup = typeof scope === "number" ? data.portfolios.find((p) => p.id === scope) ?? null : null;
  const ad = scope === "all" ? "Tüm portföy" : scope === null ? "Gruplanmamış" : grup?.name ?? "Portföy";
  const ozet = useMemo(() => ozetle(pos, rates), [pos, rates]);

  /* "Hareketlerini gör" hem sembolü süzer hem İşlemler sekmesine geçer — yoksa düğmeye basınca
     görünürde hiçbir şey olmuyordu (liste başka sekmedeydi). */
  const hareketlereGit = (s: string) => { setSymFilter(s); setSekme("hareketler"); };

  return (<>
    {/* ——— BAŞLIK KARTI ——— */}
    <div style={css.card}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" onClick={onBack} aria-label="Portföylere dön" title="Portföylere dön" style={{
          width: 36, height: 36, minHeight: 0, borderRadius: 10, border: "none", background: T.panel2, color: T.text,
          display: "grid", placeItems: "center", cursor: "pointer", flexShrink: 0, marginLeft: -4,
        }}><OkSol /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 19, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ad}</div>
          <div style={{ fontSize: 13, color: T.mut, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {ozet.acik} varlık · {trades.length} işlem{grup?.note ? ` · ${grup.note}` : ""}
          </div>
        </div>
        {/* "Tüm portföy" ve "Gruplanmamış" gerçek kayıt değildir — düzenlenemez */}
        {grup && <button type="button" onClick={() => setDuzenle(true)} style={baglanti}>Düzenle</button>}
      </div>

      <div style={{ ...css.mono, fontSize: 28, fontWeight: 600, lineHeight: 1.1, marginTop: 14 }}>
        {fmtMoney(Math.round(convert(ozet.value, "TRY", ccy, rates)), ccy)}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 5, fontSize: 13, color: T.mut }}>
        <span>açık K/Z <Signed v={Math.round(convert(ozet.unreal, "TRY", ccy, rates))} ccy={ccy} size={13} pct={ozet.pct} /></span>
        <span>gerç. K/Z <Signed v={Math.round(convert(ozet.realized, "TRY", ccy, rates))} ccy={ccy} size={13} /></span>
      </div>
      <div style={{ marginTop: 14 }}>
        <SonAylar trades={trades} priceHistory={data.price_history} rates={rates} />
      </div>
      <AlokasyonSeridi pos={pos} rates={rates} ccy={ccy} />
    </div>

    <div className="port-orta">
      {/* ——— PERFORMANS: yüzde modunda açılır (buradaki soru "nasıl gittim") ——— */}
      <DegerGrafigi
        trades={trades} priceHistory={data.price_history} benchmarks={data.benchmark_history}
        rates={rates} ccy={ccy} height={210} scopeLabel={null /* ad zaten sayfa başlığında */}
        title="Performans" altBaslik="TL bazlı, para giriş-çıkışı arındırılmış"
        defaultMode="PCT"
      />
      {/* ——— DAĞILIM: boyut = ağırlık, renk = performans ——— */}
      <VarlikTreemap pos={pos} priceHistory={data.price_history} rates={rates} ccy={ccy} />
    </div>

    {/* ——— SEKMELER ———
        Kartları alt alta yığmak yerine tek kartta değiştiriyoruz: üç liste de uzun ve aynı
        anda hiçbiri diğerinin yanında okunmuyor; yığılınca ekran yine kilometrelerce oluyordu.
        Segment (eski alt çizgili şerit 390px'e sığmıyor, yatay kayıyordu): etiketler kısaldı. */}
    <div style={css.card}>
      <div style={{ marginBottom: 14 }}>
        <Segment ad="Görünüm" deger={sekme} sec={setSekme} secenek={DETAY_SEKMELER.map(([v, l]) => ({ v, l }))} />
      </div>

      {sekme === "varliklar" && (<>
        {/* Telefonda tablo 760px'lik yatay kaydırmaydı — orada liste satırı, masaüstünde sıralanabilir tablo */}
        <div className="mobile-only">
          <PozisyonListesi data={data} pos={pos} ccy={ccy} rates={rates} reload={reload} onSymbol={hareketlereGit} />
        </div>
        <div className="desktop-only">
          <VarlikTablosu data={data} pos={pos} ccy={ccy} rates={rates} reload={reload} onSymbol={hareketlereGit} />
        </div>
      </>)}
      {sekme === "takip" && (
        <VarlikTakibi data={data} trades={trades} pos={pos} rates={rates} scopeLabel={null} govdesiz />
      )}
      {sekme === "hareketler" && (
        <Hareketler data={data} trades={trades} reload={reload} scopeLabel={null}
          symbol={symFilter} onSymbol={setSymFilter} govdesiz />
      )}
    </div>

    {duzenle && grup && (
      <GrupSayfasi grup={grup} islem={trades.length} reload={reload} onClose={() => setDuzenle(false)} onSilindi={onBack} />
    )}
  </>);
}

/** Detay sekmeleri — "Takip" bizim eklememiz (pozisyon ömürleri + dönem akışı, Faz 31). */
type DetaySekme = "varliklar" | "takip" | "hareketler";
const DETAY_SEKMELER: [DetaySekme, string][] = [
  ["varliklar", "Varlıklar"],
  ["takip", "Takip"],
  ["hareketler", "İşlemler"],
];

/* ————— PAYLAŞILAN: AÇIK POZİSYON LİSTESİ —————
   Hem liste ekranı hem detayın telefon görünümü aynı bileşeni kullanır.

   Faz 31: liste DÜZ ve DEĞERE göre sıralı (varlık sınıfı akordeonu kalktı; sınıf dağılımını
   alokasyon şeridi anlatıyor). Form kutuları satırdan çıktı. Yeniden tasarım (grup 4): satıra
   dokununca satırın İÇİNDE açılmak yerine pozisyon SAYFASI açılır (PozisyonAyrinti.tsx) — içeride
   açılmak listeyi uzatıp kaydırıyordu. Fiyatı bilinmeyen varlık eskiden kendiliğinden açık
   gelirdi; şimdi satırın kendisi kırmızı "fiyat yok · gir" der, yani eylem yine görünür. */

function PozisyonListesi({ data, pos, ccy, rates, reload, onSymbol }: {
  data: AllData; pos: Position[]; ccy: Currency; rates: Rates; reload: () => void;
  /** verilirse pozisyon sayfasında "Hareketlerini gör" çıkar (detayda listeyi süzer) */
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
  const agirlikOf = (p: Position) => (toplamTry > 0 ? convert(p.value ?? 0, p.currency, "TRY", rates) / toplamTry : null);
  const cashFunds = new Set((data.settings.cash_funds || "").split(",").map((s) => s.trim()).filter(Boolean));
  /* Açık sayfa ANAHTARLA tutulur, Position nesnesiyle değil: sayfada fiyat değişince reload yeni
     nesneler üretir ve eski nesneyi tutan sayfa bayat rakam gösterirdi. */
  const [acik, setAcik] = useState<string | null>(null);
  const acikP = acik ? acikPos.find((p) => `${p.type}:${p.sym}` === acik) ?? null : null;

  /* Bu liste diğer sayfalananlardan CİNS OLARAK farklı: satır sayısı işlem sayısıyla değil
     KAÇ FARKLI VARLIK TUTTUĞUNLA sınırlı ve sattığında satır kaybolur — zamanla monoton
     büyümüyor. Bu yüzden dilim cömert: 25 pozisyonun altında `DahaFazla` hiç render edilmez. */
  const s = useSayfalama(acikPos, 25);

  if (acikPos.length === 0) {
    return <Empty>{pos.length === 0
      ? "Henüz işlem yok. İlk alışını + Ekle ile kaydet."
      : "Açık pozisyon yok — tümü kapanmış."}</Empty>;
  }

  return (<>
    {s.gorunen.map((p, i) => (
      <VarlikSatiri key={`${p.type}:${p.sym}`} p={p} agirlik={agirlikOf(p)} nakitSayilir={cashFunds.has(p.sym)}
        ilk={i === 0} onClick={() => setAcik(`${p.type}:${p.sym}`)} />
    ))}
    <DahaFazla s={s} ad="pozisyon" yon="fazla" />
    {acikP && (
      <PozisyonSayfasi p={acikP} data={data} ccy={ccy} rates={rates} agirlik={agirlikOf(acikP)}
        reload={reload} onClose={() => setAcik(null)} onSymbol={onSymbol} />
    )}
  </>);
}

/** Tek varlık satırı: monogram + sembol (tür · adet · ağırlık) + değer (K/Z). Dokununca pozisyon sayfası. */
function VarlikSatiri({ p, agirlik, nakitSayilir, ilk, onClick }: {
  p: Position; agirlik: number | null; nakitSayilir: boolean; ilk: boolean; onClick: () => void;
}) {
  /* Ondalık ayırıcı VİRGÜL — `toFixed` nokta üretiyor ve listede "0.05 adet" diye
     görünüyordu, oysa yanındaki her tutar "₺12.500" biçiminde (nokta = binlik). */
  const adet = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "").replace(".", ","));
  const yukari = (p.unreal ?? 0) >= 0;

  return (
    <button type="button" onClick={onClick} title={`${p.sym} ayrıntısı`} className="liste-satir"
      style={{
        display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
        padding: "12px 6px", margin: "0 -6px", boxSizing: "content-box", cursor: "pointer",
        background: "transparent", border: "none", borderTop: ilk ? "none" : `1px solid ${T.line2}`, borderRadius: 8,
        color: T.text, fontFamily: T.disp,
      }}>
      {/* Monogram: SEMBOLÜN ilk iki harfi, varlık sınıfının rengiyle (türün kısaltması "BIST" →
          "BIS" yazım hatası gibi duruyordu). Renk alokasyon şeridindeki dilimle eşleşir. */}
      <span style={{
        width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: "grid", placeItems: "center",
        background: T.panel2, color: TYPE_COLORS[p.type] || T.mut,
        fontFamily: T.disp, fontSize: 13, fontWeight: 800, letterSpacing: "-0.03em",
      }}>{p.sym.slice(0, 2).toLocaleUpperCase("tr")}</span>

      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
          <span style={{ ...css.mono, fontWeight: 600, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.sym}</span>
          {p.currency === "USD" && <span style={{ fontSize: 10.5, fontWeight: 700, color: T.mut3 }}>USD</span>}
          {nakitSayilir && (
            <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 6px", borderRadius: 999, background: T.posSoft, color: T.pos }}>nakit</span>
          )}
        </span>
        <span style={{ fontSize: 12.5, color: T.mut, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          <span style={{ color: TYPE_COLORS[p.type] || T.mut, fontWeight: 600 }}>{p.type}</span>
          {" · "}{adet(p.qty)} adet
          {/* Yalnız oran yazılır, "portföy" kelimesi değil: 390px'te alt satırı sarmalıyordu. */}
          {agirlik != null && agirlik > 0 && <> · %{(agirlik * 100).toFixed(agirlik < 0.1 ? 1 : 0).replace(".", ",")}</>}
        </span>
      </span>

      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
        <span style={{ ...css.mono, fontSize: 15, fontWeight: 600 }}>
          {p.value != null ? fmtMoney(Math.round(p.value), p.currency) : "—"}
        </span>
        {p.unreal != null
          ? <span style={{ ...css.mono, fontSize: 12.5, color: yukari ? T.pos : T.neg }}>
            {yukari ? "+" : ""}{fmtMoney(Math.round(p.unreal), p.currency)}
            {p.unrealPct != null && <> ({fmtPct(p.unrealPct)})</>}
          </span>
          : <span style={{ fontSize: 12.5, color: T.neg, fontWeight: 600 }}>fiyat yok · gir</span>}
      </span>
    </button>
  );
}
