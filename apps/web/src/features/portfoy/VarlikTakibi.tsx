import React, { useMemo, useState } from "react";
import {
  parseD, fmtD, positionPeriods, portfolioFlow, pnlPct,
  type AllData, type Currency, type FlowKind, type FlowMonth, type PositionPeriod,
  type Position, type Rates, type Trade,
} from "@finans/engine";
import { T, css, fmtMoney, fmtPct, TYPE_COLORS } from "../../theme";
import { Empty, FiltreSeridi, Aciklama, useSayfalama, DahaFazla } from "../../ui";

/* ————— VARLIK TAKİBİ (Faz 31) —————
   Portföy sekmesinde iki soru cevapsızdı: "bu varlık ne zaman girdi, ne zaman çıktı, sonuçta
   ne oldu?" ve "bu ay portföye ne girdi, ne çıktı?". Pozisyonlar kartı yalnız BUGÜNÜ,
   Hareketler ise yalnız TEK TEK işlemleri gösteriyordu; aradaki hikâye hiçbir ekranda yoktu.

   İki görünüm aynı olaylara iki farklı eksenden bakar — biri VARLIK odaklı (bir pozisyonun
   ömrü), diğeri ZAMAN odaklı (bir ayın hareketi). Tek görünüme sıkıştırmak ikisini de
   okunmaz yapardı: varlık ekseninde ay başlıkları, zaman ekseninde sembol başlıkları gerekir.

   Kart SALT OKUNURDUR — düzenleme/silme Hareketler'dedir. Buradaki kontroller yalnız görünümü
   değiştirir, o yüzden hepsi FiltreSeridi'nin içindedir (Faz 24, kural 2). */

type Gorunum = "varliklar" | "akis";

/** Akış olayı rozetleri — Hareketler'deki SIDE_SOFT/SIDE_INK düzeniyle aynı dil */
const FLOW_META: Record<FlowKind, { label: string; ink: string; soft: string }> = {
  acildi: { label: "açıldı", ink: T.pos, soft: T.posSoft },
  artti: { label: "artırıldı", ink: T.pos, soft: T.posSoft },
  azaldi: { label: "azaltıldı", ink: T.neg, soft: T.negSoft },
  kapandi: { label: "kapandı", ink: T.neg, soft: T.negSoft },
  temettu: { label: "temettü", ink: "var(--cat-5)", soft: "var(--cat-5-soft, " + T.panel2 + ")" },
  bedelsiz: { label: "bedelsiz", ink: "var(--cat-3)", soft: T.panel2 },
};

const GUN = 86_400_000;
const D_KISA: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" };
const D_AY: Intl.DateTimeFormatOptions = { month: "long", year: "numeric" };

/** İki tarih arası insan ölçeği — "kaç gün tuttum" gün cinsinden 400'e çıkınca okunmaz olur */
function sure(from: string, to: string | null): string {
  const gun = Math.max(0, Math.round((parseD(to ?? new Date().toISOString().slice(0, 10)).getTime() - parseD(from).getTime()) / GUN));
  if (gun < 45) return `${gun} gün`;
  const ay = Math.round(gun / 30.44);
  return ay < 18 ? `${ay} ay` : `${(gun / 365.25).toFixed(1).replace(".", ",")} yıl`;
}

/** İşaretli tutar — pozisyon kartındakinin aynısı (oran opsiyonel) */
const Signed = ({ v, ccy, size = 12, pct, bold }: { v: number; ccy: Currency; size?: number; pct?: number | null; bold?: boolean }) => (
  <span style={{ ...css.mono, fontSize: size, fontWeight: bold ? 600 : undefined, color: v > 0 ? T.pos : v < 0 ? T.neg : T.mut }}>
    {v > 0 ? "+" : ""}{fmtMoney(v, ccy)}
    {pct != null && <span style={{ opacity: 0.75 }}> ({fmtPct(pct)})</span>}
  </span>
);

export function VarlikTakibi({ data, trades, pos, rates, scopeLabel, govdesiz = false }: {
  data: AllData;
  /** kapsam: seçili portföyün işlemleri (veya tümü) — sekmedeki diğer kartlarla aynı kural */
  trades: Trade[];
  /** aynı kapsamın pozisyonları — açık dönemin güncel K/Z'si buradan okunur */
  pos: Position[];
  rates: Rates;
  scopeLabel: string | null;
  /** Faz 32: sekme kartının İÇİNDE render edilirken kendi kartını çizmez (kart içinde kart
      görünüyordu). Kart dışında tek başına kullanıldığında varsayılan davranış korunur. */
  govdesiz?: boolean;
}) {
  const [gorunum, setGorunum] = useState<Gorunum>("varliklar");
  const donemler = useMemo(() => positionPeriods(trades), [trades]);
  const akis = useMemo(() => portfolioFlow(trades, rates), [trades, rates]);

  const Kap = govdesiz
    ? ({ children }: { children: React.ReactNode }) => <>{children}</>
    : ({ children }: { children: React.ReactNode }) => <div style={css.card}>{children}</div>;

  return (
    <Kap>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>
          Varlık Takibi
          {scopeLabel && <span style={{ fontSize: 12, fontWeight: 400, color: T.mut, marginLeft: 8 }}>— {scopeLabel}</span>}
        </div>
        <div style={{ fontSize: 12, color: T.mut }}>
          {gorunum === "varliklar" ? `${donemler.length} pozisyon dönemi` : `${akis.length} ay`}
        </div>
      </div>

      <FiltreSeridi>
        <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: `1px solid ${T.line}` }}>
          {([["varliklar", "Varlıklar"], ["akis", "Dönem akışı"]] as const).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setGorunum(v)} style={{
              padding: "6px 12px", border: "none", cursor: "pointer", fontSize: 12, fontFamily: T.disp,
              fontWeight: gorunum === v ? 700 : 500,
              background: gorunum === v ? T.panel : T.panel2, color: gorunum === v ? T.acc : T.mut,
            }}>{label}</button>
          ))}
        </div>
      </FiltreSeridi>

      <Aciklama k="varlik-takibi" label="bu iki görünüm ne anlatır?">
        <b>Varlıklar</b> her pozisyonu <b>ömrüyle</b> gösterir: ne zaman açıldı, ne zaman kapandı, ne kadar para kondu/çıktı,
        sonuçta ne kazandırdı. Bir sembolü satıp sonra <b>yeniden aldıysan iki ayrı satır</b> görürsün — ikisi ayrı işlerdir
        (ortalama maliyet kapanışta sıfırlanır), tek satırda birleştirmek ikisini de gizlerdi.
        <br /><br />
        <b>Dönem akışı</b> aynı olaylara zaman ekseninden bakar: o ay hangi varlık girdi, hangisi çıktı ve <b>net ne kadar para</b>
        portföye kondu. Net akış, değer grafiğindeki <b>"yatırdığın para"</b> çizgisiyle aynı hesaptır — temettü konan parayı
        azaltır (çünkü kârdır), bedelsizde para hareketi yoktur.
      </Aciklama>

      {gorunum === "varliklar"
        ? <VarlikListesi donemler={donemler} pos={pos} />
        : <AkisListesi aylar={akis} />}
    </Kap>
  );
}

/* ————— GÖRÜNÜM 1: VARLIKLAR (pozisyon ömrü) ————— */

function VarlikListesi({ donemler, pos }: { donemler: PositionPeriod[]; pos: Position[] }) {
  /* Satır üç katmanlı ve yüksek — Hareketler'le aynı boyut (bkz. ui/useSayfalama).
     Hook koşulsuz çağrılmalı, o yüzden boş kontrolü ondan SONRA. */
  const s = useSayfalama(donemler, 10);
  /* Açık dönemin güncel açık K/Z'si pozisyon listesinden okunur. Eşleşme sembol+tür iledir:
     bir sembolün AÇIK dönemi en fazla bir tanedir, o yüzden belirsizlik yok. */
  const posOf = useMemo(() => new Map(pos.map((p) => [`${p.type}:${p.sym}`, p])), [pos]);
  if (donemler.length === 0) return <Empty>Henüz portföy işlemi yok.</Empty>;
  return (<>
    {s.gorunen.map((d, i) => (
      <VarlikSatiri key={`${d.type}:${d.sym}:${d.openedAt}:${i}`} d={d} p={d.closedAt == null ? posOf.get(`${d.type}:${d.sym}`) : undefined} />
    ))}
    <DahaFazla s={s} ad="dönem" />
  </>);
}

function VarlikSatiri({ d, p }: { d: PositionPeriod; p?: Position }) {
  const acik = d.closedAt == null;
  const unreal = acik ? p?.unreal ?? null : null;
  /* "Net sonuç" = gerçekleşen + (açıksa) henüz gerçekleşmemiş. Tek bir rakamla "bu varlıkta
     ne kazandım" sorusunu cevaplar; ikisini ayrı görmek isteyen alt satırda ikisini de bulur. */
  const net = d.realized + (unreal ?? 0);
  const maliyet = acik ? d.qty * d.avg : 0;
  const adet = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""));

  return (
    <div style={{ padding: "10px 0", borderBottom: `1px solid ${T.line}` }}>
      <div className="ui-row" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="row-lead" style={{
          fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, flexShrink: 0,
          background: acik ? T.posSoft : T.panel2, color: acik ? T.pos : T.mut,
        }}>{acik ? "elde" : "kapandı"}</span>
        <span className="row-title" style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0, flex: 1 }}>
          <span style={{ ...css.mono, fontWeight: 600, fontSize: 14 }}>{d.sym}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: TYPE_COLORS[d.type] || T.mut, flexShrink: 0 }}>{d.type}</span>
          {d.currency === "USD" && <span style={{ fontSize: 10, fontWeight: 700, color: T.mut3 }}>USD</span>}
        </span>
        {/* Net sonuç satırın ASIL rakamıdır — "ne kazandım" tek bakışta okunsun */}
        <span className="row-amount" style={{ marginLeft: "auto" }}>
          <Signed v={Math.round(net)} ccy={d.currency} size={13.5} pct={pnlPct(net, maliyet || d.invested)} bold />
        </span>
      </div>

      {/* 2. katman: ÖMÜR — istenen "ne zaman girdi, ne zaman çıktı" tam olarak burası */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 3, fontSize: 12, color: T.mut }}>
        <span style={css.mono}>{fmtD(parseD(d.openedAt), D_KISA)}</span>
        <span style={{ color: T.mut3 }}>→</span>
        <span style={{ ...css.mono, color: acik ? T.pos : T.text }}>
          {acik ? "hâlâ elde" : fmtD(parseD(d.closedAt!), D_KISA)}
        </span>
        <span style={{ color: T.mut3 }}>· {sure(d.openedAt, d.closedAt)} · {d.count} işlem</span>
        {acik && <span style={{ color: T.mut3 }}>· {adet(d.qty)} adet · ort. <span style={css.mono}>{fmtMoney(d.avg, d.currency, true)}</span></span>}
        {!acik && d.peakQty > 0 && <span style={{ color: T.mut3 }}>· en çok {adet(d.peakQty)} adet</span>}
      </div>

      {/* 3. katman: PARA — konan, çıkan, ve sonucun gerçekleşen/açık ayrımı */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 3, fontSize: 11.5, color: T.mut3 }}>
        <span>konan <span style={{ ...css.mono, color: T.mut }}>{fmtMoney(Math.round(d.invested), d.currency)}</span></span>
        <span>çıkan <span style={{ ...css.mono, color: T.mut }}>{fmtMoney(Math.round(d.returned), d.currency)}</span></span>
        {d.realized !== 0 && <span>gerçekleşen <Signed v={Math.round(d.realized)} ccy={d.currency} size={11.5} /></span>}
        {d.dividend > 0 && <span>temettü <span style={{ ...css.mono, color: "var(--cat-5)" }}>{fmtMoney(Math.round(d.dividend), d.currency)}</span></span>}
        {unreal != null && <span>açık <Signed v={Math.round(unreal)} ccy={d.currency} size={11.5} /></span>}
        {acik && unreal == null && <span style={{ color: T.neg }}>fiyat yok — açık K/Z hesaplanamıyor</span>}
      </div>
    </div>
  );
}

/* ————— GÖRÜNÜM 2: DÖNEM AKIŞI (zaman ekseni) ————— */

function AkisListesi({ aylar }: { aylar: FlowMonth[] }) {
  /* Sayfalama AY'a göre DEĞİL OLAY'a göre yapılır: tek bir yoğun ay (ör. rebalans ayı) yüzlerce
     olay taşıyabilir, "3 ay göster" desek o ay yine yüzlerce satır basardı. Düz listeyi
     dilimleyip görünen dilimi yeniden aylara grupluyoruz — satır sayısı böyle gerçekten sınırlı. */
  const duz = useMemo(() => aylar.flatMap((m) => m.events.map((e) => ({ ym: m.ym, e }))), [aylar]);
  const s = useSayfalama(duz, 20);
  /* Ay başlığındaki net akış AYIN TAMAMINI anlatır, görünen olayları değil — o bir ay
     özelliğidir, sayfaya bağlamak "bu ayın neti" sorusunu cevapsız bırakırdı (Hareketler'deki
     dönem özetiyle aynı karar). Kaç olayın gizlendiğini denetim zaten yazıyor. */
  const gorunenAylar = useMemo(() => {
    const netOf = new Map(aylar.map((m) => [m.ym, m.netTry]));
    const out: FlowMonth[] = [];
    for (const { ym, e } of s.gorunen) {
      if (out.at(-1)?.ym !== ym) out.push({ ym, netTry: netOf.get(ym) ?? 0, events: [] });
      out.at(-1)!.events.push(e);
    }
    return out;
  }, [s.gorunen, aylar]);

  if (aylar.length === 0) return <Empty>Henüz portföy işlemi yok.</Empty>;
  const adet = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""));
  return <>{gorunenAylar.map((m) => (
    <div key={m.ym} style={{ marginBottom: 10 }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap",
        padding: "8px 10px", borderRadius: 8, background: T.panel2, marginBottom: 2,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.mut, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {fmtD(parseD(`${m.ym}-01`), D_AY)}
        </span>
        {/* Net akışın YÖNÜ sözle yazılır: "+₺53.200" tek başına kâr sanılabilir, oysa bu
            konan paradır — performans değil, sermaye hareketidir. */}
        <span style={{ fontSize: 11.5, color: T.mut }}>
          {Math.abs(m.netTry) < 0.5
            ? "net para hareketi yok"
            : <>{m.netTry > 0 ? "portföye konan" : "portföyden çıkan"}{" "}
              <span style={{ ...css.mono, color: T.text, fontWeight: 600 }}>{fmtMoney(Math.round(Math.abs(m.netTry)), "TRY")}</span></>}
        </span>
      </div>
      {m.events.map((e, i) => {
        const meta = FLOW_META[e.kind];
        return (
          <div key={`${e.date}:${e.sym}:${i}`} className="ui-row"
            style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 0 8px 10px", borderBottom: `1px solid ${T.line}` }}>
            <span className="row-lead" style={{
              fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, flexShrink: 0,
              background: meta.soft, color: meta.ink,
            }}>{meta.label}</span>
            <span className="row-title" style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0, flex: 1, flexWrap: "wrap" }}>
              <span style={{ ...css.mono, fontWeight: 600, fontSize: 13.5 }}>{e.sym}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: TYPE_COLORS[e.type] || T.mut, flexShrink: 0 }}>{e.type}</span>
              <span style={{ fontSize: 11.5, color: T.mut3 }}>
                {fmtD(parseD(e.date), { day: "2-digit", month: "short" })} · {adet(e.qty)} adet
                {e.kind !== "bedelsiz" && e.kind !== "kapandi" && <> · kalan {adet(e.qtyAfter)}</>}
              </span>
              {e.realized !== 0 && (
                <span style={{ fontSize: 11.5, color: T.mut3 }}>· gerç. <Signed v={Math.round(e.realized)} ccy={e.currency} size={11.5} /></span>
              )}
            </span>
            {/* Tutar nötr ve işaretsiz — yönü rozet söyler (Hareketler'deki aynı karar) */}
            <span className="row-amount" style={{ ...css.mono, fontSize: 13, marginLeft: "auto", color: e.kind === "bedelsiz" ? T.mut3 : T.text }}>
              {e.kind === "bedelsiz" ? "—" : fmtMoney(Math.round(e.cash), e.currency)}
            </span>
          </div>
        );
      })}
    </div>
  ))}
    <DahaFazla s={s} ad="olay" />
  </>;
}
