import React, { useState, useMemo } from "react";
import {
  fmtD, parseD, keyOf, takvimOlaylari, takvimGunleri, PIYASA_TURLERI,
  type AllData, type Day, type TakvimOlay,
} from "@finans/engine";
import { T, css, tl } from "../../theme";
import { maskBrief } from "../../privacy";
import { Money, Empty } from "../../ui";
import { Segment } from "../forms/parcalar";

/** Takvimde gösterilen gerçekleşen (defter) hareketi; `card` doluysa kart harcaması (nakdi o gün oynatmaz) */
type LedgerEv = { n: string; a: number; card?: string };

/* ————— FAZ 37: PİYASA KATMANI —————

   Bu ekran ÖNCE bir nakit takvimidir ve öyle kalır: hücrenin söylediği şey bir RAKAMDIR
   (etkin nakit) ve gün rengi bakiyeden gelir. Piyasa tarihleri (bilanço, bedelsiz/temettü
   ex-date, TCMB/Fed/TÜİK) bunun ÜSTÜNE ikinci bir katman olarak biner — hücrede tek küçük
   kare, ayrıntısı zaten var olan gün panelinde.

   Faz 37 bunu önce AYRI BİR SEKME olarak kurdu ve yanlıştı: iki ekranın ay şeridi, ızgarası,
   gün paneli ve liste görünümü aynı bileşenin iki kopyasıydı. Gerçekten farklı olan tek şey
   hücrenin ne söylediğiydi (rakam mı, tür mü) — ve aynı 47px'lik kutuda ikisi duramaz. Doğru
   cevap iki eşit ekran değil, BİRİNCİL + KATMAN: rakam korunur, piyasa tek işarete iner.
   Motor tarafı (`takvimOlaylari`) olduğu gibi kullanılıyor, yalnız tür süzgeciyle daraltılmış.

   KAPSAM KISITI (bilerek): pencere bu EKRANIN penceresidir — içinde bulunulan ayın başından
   projeksiyon ufkuna. Yani ayın geçmiş günlerindeki olaylar (ızgarada zaten tıklanabilir
   kesikli hücreler) görünür, ama daha eskisi görünmez. Aylar öncesinin ex-date'ini aramak bu
   ekranın işi değil: "hisse o gün neden yarıya indi" sorusunu Özet'teki "kaçırdığın kurumsal
   olay" kartı cevaplıyor ve nakit projeksiyonunun zaten geçmişi yok. */

const PIYASA_RENK = "var(--cat-8)";

/** Hücredeki piyasa işareti: KARE — planlı hareketin yuvarlak noktasından ayrılsın diye
    (aynı hücrede ikisi birden bulunabiliyor, aynı biçim olsalar sayılırlardı). */
const PiyasaIsaret = ({ boyut = 5 }: { boyut?: number }) => (
  <span aria-hidden="true" style={{ width: boyut, height: boyut, borderRadius: 1, background: PIYASA_RENK, flexShrink: 0 }} />
);

/** Gün panelinde / listede bir piyasa olayı satırı. */
function PiyasaSatir({ o }: { o: TakvimOlay }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 14, marginTop: 5 }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: T.mut }}>
          {/* "~" = tarih TAHMİNİ (şirket duyurmadıysa geçen yıldan türetilmiş, TÜFE günü de
              takvim kuralından). Kesinmiş gibi yazmak sessiz bir yanlış olurdu. */}
          {o.tahmini && <span title="tarih tahmini" style={{ color: T.warn }}>~ </span>}{o.baslik}
        </span>
        {/* Alt satır YALNIZ `detay` varsa çizilir. `etiket` (Fed/TCMB/Bilanço) burada
            gereksiz: bölümün başlığı zaten "piyasa" ve olay başlığı kurumu/sembolü söylüyor
            ("Fed faiz kararı (FOMC)" altına "Fed" yazıyordu). Bilgi ekleyen tek alan `detay`:
            "tarih tahmini (geçen yıla göre)", "hisse başına brüt", "adet çarpanı 2,5". */}
        {o.detay && <span style={{ display: "block", fontSize: 12.5, color: T.mut }}>{o.detay}</span>}
      </span>
      {o.tutar != null && <Money v={o.tutar} mut />}
    </div>
  );
}

/** Piyasa bölümü — gün panelinde ve liste görünümünde aynı başlıkla çizilsin diye tek yerde. */
const PiyasaBolum = ({ ev, ayrac }: { ev: TakvimOlay[]; ayrac?: boolean }) => (
  <div style={{ marginTop: 10, ...(ayrac ? { borderTop: `1px solid ${T.line}`, paddingTop: 8 } : {}) }}>
    <div style={{ fontSize: 13, color: T.mut, marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}>
      <PiyasaIsaret boyut={7} />Piyasa
    </div>
    {ev.map((o) => <PiyasaSatir key={o.key} o={o} />)}
  </div>
);

/** Planlanan / gerçekleşen hareket satırı (gün paneli ve liste) */
const HareketSatir = ({ ad, alt, v }: { ad: React.ReactNode; alt?: React.ReactNode; v: number }) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: 10, fontSize: 14.5, padding: "5px 0" }}>
    <span style={{ flex: 1, minWidth: 0 }}>
      {ad}
      {alt && <span style={{ display: "block", fontSize: 12.5, color: T.mut }}>{alt}</span>}
    </span>
    <Money v={v} sign />
  </div>
);
const Baslik = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 13, color: T.mut, margin: "10px 0 2px", display: "flex", alignItems: "center", gap: 6 }}>{children}</div>
);

/* ————— NAKİT AKIŞI (liste + takvim) —————
   Yeniden tasarım (Ekim 2026, grup 5): üst kartta ay seçimi + üç kutu (bugün/ay başı · ayın EN DAR
   günü · ay sonu) + görünüm ve piyasa anahtarı. "Ay sonu" eskiden yalnız listenin dibindeydi, en dar
   gün hiç yazmıyordu — ikisi de projeksiyondan okunur (SAF nakit `bal`, Özet'in "en düşük gün"üyle
   aynı tanım), yeni hesap yok. Takvimde gün paneli masaüstünde ızgaranın YANINDA (`.nakit-izgara`). */
export function Nakit({ days, data }: { days: Day[]; data: AllData }) {
  const [view, setView] = useState<"liste" | "takvim">("takvim");
  /* Tercih kalıcı: katmanı kapatan kullanıcı her açılışta yeniden kapatmak zorunda kalmasın.
     Varsayılan AÇIK — katmanın var olma sebebi zaten tarihlerin görünmesi. */
  const [piyasa, setPiyasa] = useState(() => {
    try { return localStorage.getItem("finans-nakit-piyasa") !== "0"; } catch { return true; }
  });
  const piyasaCevir = () => setPiyasa((v) => {
    try { localStorage.setItem("finans-nakit-piyasa", v ? "0" : "1"); } catch { /* özel pencere */ }
    return !v;
  });
  /* gerçekleşen hareketler (transactions + kart harcamaları) gün anahtarına göre — takvimde ✓ olarak
     işaretlenir. Projeksiyon geçmişi çizmediğinden içinde bulunulan ayın geçmiş günleri bu defterden gelir. */
  const ledger = useMemo(() => {
    const m = new Map<string, LedgerEv[]>();
    const push = (k: string, e: LedgerEv) => { if (!m.has(k)) m.set(k, []); m.get(k)!.push(e); };
    data.transactions.forEach((t) => push(t.date, { n: t.name, a: t.amount }));
    data.card_txs.forEach((ct) => push(ct.date, { n: ct.name, a: -ct.amount, card: data.cards.find((c) => c.id === ct.card_id)?.name || "kart" }));
    return m;
  }, [data]);
  /* Piyasa olayları: `takvimOlaylari` TÜR SÜZGECİYLE çağrılır ve `days` BOŞ geçilir — planlı
     hareketler bu ekranda zaten `Day.ev`den geliyor, ikinci kez istemek aynı satırı iki kez
     çizerdi. Pencere görüntülenen ayların tamamı. */
  const [pFrom, pTo] = useMemo(() => {
    const ilk = days[0]?.date ?? new Date();
    return [keyOf(new Date(ilk.getFullYear(), ilk.getMonth(), 1)), days[days.length - 1]?.k ?? keyOf(ilk)];
  }, [days]);
  const piyasaMap = useMemo(
    () => (piyasa
      ? takvimGunleri(takvimOlaylari(data, [], { from: pFrom, to: pTo, turler: PIYASA_TURLERI }))
      : new Map<string, TakvimOlay[]>()),
    [data, piyasa, pFrom, pTo],
  );

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

  const ilk = cur.days[0], son = cur.days[cur.days.length - 1];
  const dar = cur.days.reduce((m, d) => (d.bal < m.bal ? d : m), ilk);
  const bugunAyi = mi === 0 && ilk.k === keyOf(new Date());
  const kutu = (etiket: string, v: number, renk?: string, uyari?: boolean) => (
    <div style={{ background: uyari ? T.warnSoft : T.panel2, borderRadius: 10, padding: "8px 10px", minWidth: 0 }}>
      <div style={{ fontSize: 12, color: uyari ? T.warn : T.mut, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{etiket}</div>
      <div style={{ ...css.mono, fontSize: 15, fontWeight: 600, color: renk ?? T.text, whiteSpace: "nowrap" }}>{tl.format(Math.round(v))}</div>
    </div>
  );

  return (<>
    <div style={{ ...css.card, padding: 16, display: "grid", gap: 12 }}>
      {/* Ay seçimi: görünümü değiştirir → seçili beyaz yüzey + mor metin (Faz 24 kural 2); yatay kayar */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none", margin: "0 -4px", padding: "0 4px" }}>
        {months.map((m, i) => (
          <button key={i} type="button" onClick={() => setMi(i)} aria-pressed={i === mi} style={{
            background: i === mi ? T.panel : "transparent", color: i === mi ? T.acc : T.mut,
            border: `1px solid ${i === mi ? T.line : "transparent"}`, borderRadius: 18, padding: "7px 14px", minHeight: 0,
            fontSize: 14, cursor: "pointer", whiteSpace: "nowrap", fontFamily: T.disp, fontWeight: i === mi ? 600 : 400,
            boxShadow: i === mi ? "var(--shadow-sm)" : "none",
          }}>{m.label}</button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        {kutu(bugunAyi ? "Bugün" : "Ay başı", ilk.bal, ilk.bal < 0 ? T.neg : undefined)}
        {kutu(`En dar · ${fmtD(dar.date, { day: "numeric", month: "short" })}`, dar.bal, dar.bal < 0 ? T.neg : T.warn, true)}
        {kutu("Ay sonu", son.bal, son.bal < 0 ? T.neg : T.pos)}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Segment kucuk ad="Görünüm" deger={view} sec={setView} secenek={[{ v: "takvim", l: "Takvim" }, { v: "liste", l: "Liste" }]} />
        {/* Piyasa katmanı anahtarı: GÖRÜNÜMÜ değiştirir, veriyi değil */}
        <button type="button" role="switch" aria-checked={piyasa} onClick={piyasaCevir}
          title="bilanço, bedelsiz/temettü, TCMB/Fed/TÜİK tarihleri"
          style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: "4px 0", minHeight: 0, fontFamily: T.disp, fontSize: 14, color: T.text, whiteSpace: "nowrap" }}>
          <PiyasaIsaret boyut={8} />Piyasa
          <span aria-hidden="true" style={{ width: 40, height: 24, borderRadius: 12, background: piyasa ? T.acc : T.line, position: "relative", transition: "background .15s", flexShrink: 0 }}>
            <span style={{ position: "absolute", top: 3, left: piyasa ? 19 : 3, width: 18, height: 18, borderRadius: 9, background: "#fff", transition: "left .15s", boxShadow: "0 1px 2px rgba(0,0,0,.2)" }} />
          </span>
        </button>
      </div>
    </div>
    {view === "takvim"
      ? <Takvim key={cur.label} month={cur} ledger={ledger} piyasaMap={piyasaMap} />
      : <Liste days={cur.days} piyasaMap={piyasaMap} />}
  </>);
}

function Liste({ days, piyasaMap }: { days: Day[]; piyasaMap: Map<string, TakvimOlay[]> }) {
  /* Piyasa olayı OLAN ama planlı hareketi olmayan gün de listeye girer — katman açıkken
     "o gün bir şey var" demek, o günü listeden düşürmekle çelişirdi. */
  const eventDays = days.filter((d) => d.ev.length || piyasaMap.get(d.k)?.length);
  const last = days[days.length - 1];
  return (
    <div style={{ ...css.card, padding: "4px 16px" }}>
      {eventDays.length === 0 && <Empty>Bu ayda planlı hareket yok.</Empty>}
      {eventDays.map((d, i) => (
        <div key={d.k} style={{ padding: "12px 0", borderTop: i === 0 ? "none" : `1px solid ${T.line2}` }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <b style={{ fontSize: 15 }}>{fmtD(d.date, { day: "numeric", month: "short" })}</b>
            <span style={{ fontSize: 13, color: T.mut }}>{fmtD(d.date, { weekday: "long" })}</span>
            <span style={{ marginLeft: "auto", fontSize: 12.5, color: T.mut, textAlign: "right" }}>
              nakit <span style={{ ...css.mono, color: d.bal < 0 ? T.neg : T.text, fontSize: 13.5 }}>{tl.format(Math.round(d.bal))}</span>
              {d.assets > 0 && <> · varlık <span style={{ ...css.mono, color: T.text, fontSize: 13.5 }}>{tl.format(Math.round(d.total))}</span></>}
            </span>
          </div>
          {d.ev.map((e, j) => <HareketSatir key={j} ad={e.n} v={e.a} />)}
          {(piyasaMap.get(d.k)?.length ?? 0) > 0 && <PiyasaBolum ev={piyasaMap.get(d.k)!} />}
        </div>
      ))}
      {last && (
        <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderTop: `1px solid ${T.line}` }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Ay sonu nakit</span>
          <span style={{ ...css.mono, fontWeight: 600, fontSize: 15, color: last.bal < 0 ? T.neg : T.pos }}>{tl.format(Math.round(last.bal))}</span>
        </div>
      )}
    </div>
  );
}

/** Etkin nakit = gün sonu nakit + para piyasası fonu (likit, nakit gibi değerlenir) */
const effCash = (d: Day) => d.bal + d.cashFunds;

function Takvim({ month, ledger, piyasaMap }: {
  month: { y: number; mo: number; days: Day[] }; ledger: Map<string, LedgerEv[]>; piyasaMap: Map<string, TakvimOlay[]>;
}) {
  const todayK = keyOf(new Date());
  /* Açılışta bugün seçili (bu ayın takvimiyse): masaüstünde panel boş bir kutu olarak durmasın */
  const [selK, setSelK] = useState<string | null>(() => (month.days.some((d) => d.k === todayK) ? todayK : null));
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
  const check = <span style={{ fontSize: 10, color: T.pos, lineHeight: 1 }}>✓</span>; // gerçekleşen işareti

  const selDay = selK ? month.days.find((d) => d.k === selK) ?? null : null;
  const selLedger = selK ? ledger.get(selK) ?? [] : [];
  const selPiyasa = selK ? piyasaMap.get(selK) ?? [] : [];
  const panelVar = !!selK && (!!selDay || selLedger.length > 0 || selPiyasa.length > 0);

  const hucre: React.CSSProperties = {
    aspectRatio: "1", borderRadius: 9, cursor: "pointer", minHeight: 0, minWidth: 0,
    display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "4px 5px", overflow: "hidden",
    fontFamily: T.disp, boxSizing: "border-box",
  };

  return (
    <div className="nakit-izgara">
      <div style={{ ...css.card, padding: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 4, maxWidth: 520, margin: "0 auto" }}>
          {wd.map((w) => <div key={w} style={{ textAlign: "center", fontSize: 12, color: T.mut, padding: "2px 0" }}>{w}</div>)}
          {cells.map((dd, i) => {
            if (dd == null) return <div key={i} />;
            const d = byDate.get(dd) ?? null;
            const k = kOf(dd);
            const done = ledger.has(k) && k <= todayK; // o günün gerçekleşen hareketleri
            const isSel = selK === k;
            if (!d) {
              /* projeksiyon dışı gün: içinde bulunulan ayın GEÇMİŞ günleri (bakiye geçmişi tutulmadığından
                 sayı yok) — gerçekleşen hareketleri ✓ ile işaretlenir, tıklayınca listelenir */
              if (k >= todayK && !piyasaMap.has(k)) return <div key={i} />;
              return (
                <button key={i} type="button" onClick={() => setSelK(isSel ? null : k)} aria-pressed={isSel} style={{
                  ...hucre, border: `${isSel ? 2 : 1}px dashed ${isSel ? T.acc : T.line}`, background: "transparent", opacity: 0.7,
                }}>
                  <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 3 }}>
                    <span style={{ fontSize: 11.5, color: T.mut }}>{dd}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 3 }}>{done && check}{piyasaMap.has(k) && <PiyasaIsaret />}</span>
                  </span>
                  <span />
                </button>
              );
            }
            const hasEv = d.ev.length > 0;
            const neg = effCash(d) < 0; // para piyasası fonu nakit gibi sayılır
            const bugun = d.k === todayK;
            return (
              <button key={i} type="button" onClick={() => setSelK(isSel ? null : d.k)} aria-pressed={isSel} style={{
                ...hucre, border: `${isSel ? 2 : 1}px solid ${isSel ? T.acc : neg ? T.neg : T.line}`,
                background: neg ? T.negSoft : hasEv ? T.panel2 : T.panel,
              }}>
                <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 3 }}>
                  <span style={{ fontSize: 11.5, color: bugun ? T.acc : T.mut, fontWeight: bugun ? 700 : 400 }}>{d.date.getDate()}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                    {done && check}
                    {hasEv && <span style={{ width: 5, height: 5, borderRadius: 3, background: T.acc }} />}
                    {piyasaMap.has(d.k) && <PiyasaIsaret />}
                  </span>
                </span>
                <span style={{ textAlign: "right", lineHeight: 1.15 }}>
                  <span style={{ ...css.mono, display: "block", fontSize: 12, color: neg ? T.neg : T.text }}>{kBrief(effCash(d))}</span>
                  {d.assets > 0 && <span style={{ ...css.mono, display: "block", fontSize: 9.5, color: T.mut }}>Σ{kBrief(d.total)}</span>}
                </span>
              </button>
            );
          })}
        </div>
        {/* Lejant katlı değil: dört işaretin anlamı takvime ilk bakışta lazım */}
        <div style={{ display: "flex", gap: "4px 12px", flexWrap: "wrap", fontSize: 12, color: T.mut, marginTop: 12, justifyContent: "center" }}>
          <span>sayı = etkin nakit</span>
          <span><span style={{ ...css.mono }}>Σ</span> = tüm varlık</span>
          <span><span style={{ color: T.acc }}>●</span> plan</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><PiyasaIsaret boyut={6} /> piyasa (<b>~</b> tahmini)</span>
          <span><span style={{ color: T.pos }}>✓</span> gerçekleşen</span>
          <span style={{ color: T.neg }}>kırmızı = eksi</span>
        </div>
      </div>

      {panelVar ? (() => {
        const date = selDay ? selDay.date : parseD(selK!);
        return (
          <div style={{ ...css.card, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 17, flex: 1 }}>{fmtD(date, { day: "numeric", month: "long", weekday: "long" })}</div>
              <button type="button" aria-label="Günü kapat" onClick={() => setSelK(null)} style={{ background: T.panel2, border: "none", borderRadius: 9, width: 32, height: 32, minHeight: 0, color: T.mut, cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
              </button>
            </div>
            {!selDay && <div style={{ fontSize: 12.5, color: T.mut }}>geçmiş gün — bakiye geçmişi tutulmuyor</div>}
            {selDay && (() => {
              const eff = effCash(selDay);
              const hasPpf = selDay.cashFunds > 0;
              const other = selDay.assets - selDay.cashFunds; // para piyasası dışı portföy
              const r = (etiket: string, v: number, renk: string = T.text, buyuk?: boolean) => (
                <div><div style={{ fontSize: 12, color: T.mut }}>{etiket}</div>
                  <span style={{ ...css.mono, fontSize: buyuk ? 20 : 15, fontWeight: buyuk ? 600 : 500, color: renk }}>{tl.format(Math.round(v))}</span></div>
              );
              return (
                <div style={{ display: "flex", gap: "8px 18px", flexWrap: "wrap", alignItems: "flex-end", margin: "10px 0 4px" }}>
                  {r("Etkin nakit", eff, eff < 0 ? T.neg : T.pos, true)}
                  {hasPpf && r("Gün sonu nakit", selDay.bal, selDay.bal < 0 ? T.neg : T.text)}
                  {hasPpf && r("Para piyasası fonu", selDay.cashFunds)}
                  {r(hasPpf ? "Diğer portföy" : "Portföy", other)}
                  {r("Toplam varlık", selDay.total)}
                </div>
              );
            })()}
            {selDay && selDay.ev.length > 0 && (<>
              <Baslik>Planlanan</Baslik>
              {selDay.ev.map((e, j) => <HareketSatir key={j} ad={e.n} v={e.a} />)}
            </>)}
            {selLedger.length > 0 && (<>
              <Baslik>Gerçekleşen <span style={{ color: T.pos }}>✓</span></Baslik>
              {selLedger.map((e, j) => <HareketSatir key={j} ad={e.n} alt={e.card ? `${e.card} · kart harcaması` : undefined} v={e.a} />)}
              {selLedger.some((e) => e.card) && (
                <div style={{ fontSize: 12.5, color: T.mut, marginTop: 4 }}>Kart harcaması nakdi o gün değil, ekstrenin son ödeme günü etkiler.</div>
              )}
            </>)}
            {selPiyasa.length > 0 && <PiyasaBolum ev={selPiyasa} />}
          </div>
        );
      })() : (
        <div className="desktop-only" style={{ ...css.card, padding: 16, fontSize: 14, color: T.mut }}>Ayrıntısını görmek için bir güne dokun.</div>
      )}
    </div>
  );
}
