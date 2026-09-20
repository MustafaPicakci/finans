import React, { useId, useMemo, useState } from "react";
import {
  convert, openPositions, portfolioValueDecomposition, coveredOnly, sliceValueHistory, twrSeries,
  monthlyTwr, symbolReturns,
  type Currency, type Position, type PriceHistoryEntry, type Rates, type Trade, type HistoryRange,
} from "@finans/engine";
import { parseD, fmtD } from "@finans/engine";
import { T, css, fmtMoney, fmtPct, fmtPay, TYPE_COLORS } from "../../theme";

/* ————— PORTFÖY EKRANININ GÖRSEL PARÇALARI (Faz 31) —————
   Ekran eskiden baştan sona düz metindi: aynı puntoda satırlar, her pozisyonun içinde bir
   fiyat giriş kutusu, hiçbir görselleştirme. "Paramın yarısı kriptoda" ya da "bu ay yukarı mı
   gidiyorum" gibi ilk sorulan sorular ekranda HİÇ yoktu; kullanıcı bunları rakamları kafasında
   toplayarak çıkarmak zorundaydı.

   Buradaki üç parça o boşluğu dolduruyor: seyri gösteren sparkline, dağılımı gösteren alokasyon
   şeridi, ikisini taşıyan hero. Hepsi SALT OKUNUR ve mevcut motor fonksiyonlarını kullanır —
   yeni hesap yok, yalnız var olan doğruların görselleştirilmesi. */

/** Hero'daki dönem seçici; DegerGrafigi ile aynı aralık kümesi (iki ekran aynı dili konuşsun) */
const RANGES: { v: HistoryRange; label: string }[] = [
  { v: "1H", label: "1H" }, { v: "1A", label: "1A" }, { v: "3A", label: "3A" },
  { v: "1Y", label: "1Y" }, { v: "TÜM", label: "Tümü" },
];
/** Aralığın insan okunur adı — "1 ayda ▲ +₺8.240" cümlesini kurar */
const RANGE_ADI: Record<HistoryRange, string> = {
  "1H": "1 haftada", "1A": "1 ayda", "3A": "3 ayda", "6A": "6 ayda", "1Y": "1 yılda", "TÜM": "başından beri",
};

/* ————— SPARKLINE —————
   Recharts KULLANILMAZ: hero'daki çizgi eksen/ızgara/tooltip istemiyor, yalnız bir siluet.
   Tam grafik bileşenini buraya koymak hem ağır hem de "bu da tıklanır mı?" beklentisi yaratırdı;
   asıl grafik zaten detay ekranında. */
function Sparkline({ values, yukari, height = 44 }: { values: number[]; yukari: boolean; height?: number }) {
  const gid = useId();
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const W = 100, H = 100; // viewBox birimi; preserveAspectRatio="none" ile kutuya esnetilir
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - ((v - min) / span) * H] as const);
  const cizgi = pts.map(([x, y]) => `${x},${y}`).join(" ");
  const alan = `0,${H} ${cizgi} ${W},${H}`;
  const renk = yukari ? T.pos : T.neg;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      aria-hidden="true" style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={renk} stopOpacity="0.22" />
          <stop offset="100%" stopColor={renk} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={alan} fill={`url(#${gid})`} />
      {/* vectorEffect: viewBox esnetilince çizgi kalınlığı da esner ve dikey eksende
          kalınlaşıp bulanıklaşırdı — bu, kalınlığı ekran pikseline sabitler. */}
      <polyline points={cizgi} fill="none" stroke={renk} strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ————— ALOKASYON ŞERİDİ —————
   "Paramın ne kadarı nerede?" sorusunun cevabı ekranda hiç yoktu. Varlık sınıfına göre
   katlanır gruplar bunu ancak dolaylı söylüyordu (üstelik kapalıyken hiç söylemiyordu). */
export function AlokasyonSeridi({ pos, rates, ccy }: { pos: Position[]; rates: Rates; ccy: Currency }) {
  const dilimler = useMemo(() => {
    const by = new Map<string, number>();
    for (const p of openPositions(pos)) {
      if (p.value == null) continue; // fiyatı bilinmeyen pozisyon ağırlığa katılamaz
      const v = convert(p.value, p.currency, "TRY", rates);
      by.set(p.type, (by.get(p.type) ?? 0) + v);
    }
    const toplam = [...by.values()].reduce((s, v) => s + v, 0);
    if (toplam <= 0) return [];
    return [...by.entries()]
      .map(([type, v]) => ({ type, v, oran: v / toplam }))
      .sort((a, b) => b.v - a.v);
  }, [pos, rates]);

  if (dilimler.length === 0) return null;

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", height: 8, borderRadius: 999, overflow: "hidden", gap: 2 }}>
        {dilimler.map((d) => (
          <div key={d.type} title={`${d.type} · ${fmtPay(d.oran)}`}
            style={{ width: `${d.oran * 100}%`, background: TYPE_COLORS[d.type] || T.mut3, minWidth: 2 }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
        {dilimler.map((d) => (
          <span key={d.type} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: T.mut }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: TYPE_COLORS[d.type] || T.mut3, flexShrink: 0 }} />
            {d.type}
            <span style={{ ...css.mono, color: T.text, fontWeight: 600 }}>{fmtPay(d.oran, 0)}</span>
            <span style={{ ...css.mono, color: T.mut3 }}>{fmtMoney(Math.round(convert(d.v, "TRY", ccy, rates)), ccy)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ————— HERO ————— */

export function PortfoyHero({ trades, priceHistory, rates, ccy, deger, unreal, unrealPct, realized, etiket, buyuk = true, range, onRange }: {
  trades: Trade[]; priceHistory: PriceHistoryEntry[]; rates: Rates; ccy: Currency;
  /** TRY cinsinden; gösterimde `ccy`'ye çevrilir */
  deger: number; unreal: number; unrealPct: number | null; realized: number;
  etiket: string;
  buyuk?: boolean;
  range: HistoryRange; onRange: (r: HistoryRange) => void;
}) {
  const seri = useMemo(() => portfolioValueDecomposition(trades, priceHistory, rates), [trades, priceHistory, rates]);

  /* Kapsam kararı PENCERE BAŞINA verilir — DegerGrafigi ile birebir aynı kural. Fiyat geçmişi
     olmayan bir sembol alındığında katı kural pencereyi tamamen boşaltıp sparkline'ı yok
     ediyordu; yeterli kapsanmış gün varsa katı davran, yoksa ham seriye düş. */
  const pencere = useMemo(() => {
    const cov = sliceValueHistory(coveredOnly(seri), range);
    return cov.length >= 2 ? cov : sliceValueHistory(seri, range);
  }, [seri, range]);

  /* Dönem rakamı olarak DEĞER değişimi değil KÂR değişimi gösterilir. Sebep Faz 27'nin dersi:
     ay ortasında 50 bin ₺ eklemek değeri 50 bin artırır ama bu performans değildir — hero'da
     "▲ +₺50.000" yazmak düpedüz yalan olurdu. `gain = değer − konan para`, yani para eklemek
     bu sayıyı DEĞİŞTİRMEZ. Yüzde de aynı sebeple TWR'dir (grafiğin % moduyla aynı hesap). */
  const donem = useMemo(() => {
    if (pencere.length < 2) return null;
    const kar = pencere.at(-1)!.gain - pencere[0].gain;
    const twr = twrSeries(pencere).at(-1)?.value ?? null;
    return { kar, twr };
  }, [pencere]);

  const yukari = (donem?.kar ?? 0) >= 0;
  const cv = (v: number) => Math.round(convert(v, "TRY", ccy, rates));

  return (<>
    <div style={{ fontSize: 11.5, color: T.mut, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>
      {etiket}
    </div>
    <div style={{ ...css.mono, fontSize: buyuk ? 30 : 24, fontWeight: 700, lineHeight: 1.1, marginTop: 2 }}>
      {fmtMoney(cv(deger), ccy)}
    </div>

    {/* Dönem kârı — hero'nun ikinci cümlesi */}
    {donem && (
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        <span style={{ ...css.mono, fontSize: 14, fontWeight: 600, color: yukari ? T.pos : T.neg }}>
          {yukari ? "▲" : "▼"} {yukari ? "+" : ""}{fmtMoney(cv(donem.kar), ccy)}
        </span>
        {donem.twr != null && (
          <span style={{ ...css.mono, fontSize: 13, color: yukari ? T.pos : T.neg, opacity: 0.8 }}>
            {fmtPct(donem.twr, 1, true)}
          </span>
        )}
        <span style={{ fontSize: 11.5, color: T.mut3 }}>{RANGE_ADI[range]} · kâr</span>
      </div>
    )}

    <div style={{ marginTop: 10, marginInline: -4 }}>
      <Sparkline values={pencere.map((p) => p.value)} yukari={yukari} height={buyuk ? 48 : 38} />
    </div>

    {/* Dönem seçici — görünümü değiştirir, veri değiştirmez (Faz 24 kural 2'nin ruhu);
        hero'nun içinde kaldığı için ayrı bir FiltreSeridi şeridi açılmadı. */}
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
      {RANGES.map((r) => (
        <button key={r.v} type="button" onClick={() => onRange(r.v)} style={{
          padding: "4px 10px", borderRadius: 999, cursor: "pointer", fontSize: 11.5, fontFamily: T.disp,
          fontWeight: range === r.v ? 700 : 500, minHeight: 0,
          border: `1px solid ${range === r.v ? T.acc : T.line}`,
          background: range === r.v ? T.accSoft : "transparent",
          color: range === r.v ? T.acc : T.mut,
        }}>{r.label}</button>
      ))}
    </div>

    {/* Pozisyon düzeyindeki DEĞİŞMEZ doğrular: bunlar pencereye bağlı değildir. */}
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 12, fontSize: 12, color: T.mut }}>
      <span>açık K/Z{" "}
        <span style={{ ...css.mono, color: unreal > 0 ? T.pos : unreal < 0 ? T.neg : T.mut }}>
          {unreal > 0 ? "+" : ""}{fmtMoney(cv(unreal), ccy)}
          {unrealPct != null && <span style={{ opacity: 0.75 }}> ({fmtPct(unrealPct)})</span>}
        </span>
      </span>
      <span>gerç. K/Z{" "}
        <span style={{ ...css.mono, color: realized > 0 ? T.pos : realized < 0 ? T.neg : T.mut }}>
          {realized > 0 ? "+" : ""}{fmtMoney(cv(realized), ccy)}
        </span>
      </span>
    </div>
  </>);
}

/* ————— SON AYLAR PANELİ (Faz 32) —————
   Referans panelindeki "SON AYLAR + TOPLAM GETİRİ" kutusu. Ekran "şu an ne kadarım var"
   diyordu ama "bu ay ne oldu, geçen ay ne oldu" diyemiyordu — oysa portföy takibinde
   asıl ritim aylıktır. Rakamlar TWR'dır (`monthlyTwr`): ayın ortasında para eklemek
   getiriyi şişirmez, yoksa "para yatırdım" ile "kazandım" aynı görünürdü. */

const AY_FMT: Intl.DateTimeFormatOptions = { month: "long", year: "2-digit" };

export function SonAylar({ trades, priceHistory, rates, adet = 3 }: {
  trades: Trade[]; priceHistory: PriceHistoryEntry[]; rates: Rates; adet?: number;
}) {
  const seri = useMemo(() => portfolioValueDecomposition(trades, priceHistory, rates), [trades, priceHistory, rates]);
  const kapsanan = useMemo(() => coveredOnly(seri), [seri]);
  /* Kapsanan seri kullanılır: fiyatı bilinmeyen açık pozisyonu olan gün portföyü olduğundan
     küçük gösterir ve aylık getiri sahte bir çöküş/sıçrama olarak okunurdu (bkz. coveredOnly). */
  const temel = kapsanan.length >= 2 ? kapsanan : seri;
  const aylar = useMemo(() => monthlyTwr(temel).slice(0, adet), [temel, adet]);
  const toplam = useMemo(() => (temel.length >= 2 ? twrSeries(temel).at(-1)?.value ?? null : null), [temel]);

  if (aylar.length === 0 && toplam == null) return null;

  return (
    <div style={{
      display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between",
      background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 14, padding: "12px 14px",
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, color: T.mut3, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 6 }}>
          Son aylar
        </div>
        {aylar.length === 0
          ? <div style={{ fontSize: 11.5, color: T.mut3 }}>henüz tam bir ay yok</div>
          : aylar.map((a) => (
            <div key={a.ym} style={{ display: "flex", alignItems: "baseline", gap: 10, justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ fontSize: 12, color: T.mut }}>{fmtD(parseD(`${a.ym}-01`), AY_FMT)}</span>
              <span style={{
                ...css.mono, fontSize: 11.5, fontWeight: 600, padding: "1px 7px", borderRadius: 6,
                background: a.pct >= 0 ? T.posSoft : T.negSoft, color: a.pct >= 0 ? T.pos : T.neg,
              }}>{fmtPct(a.pct, 2, true)}</span>
            </div>
          ))}
      </div>
      {toplam != null && (
        <div style={{ textAlign: "right", minWidth: 0 }}>
          <div style={{ fontSize: 10, color: T.mut3, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 4 }}>
            Toplam getiri
          </div>
          <div style={{ ...css.mono, fontSize: 22, fontWeight: 700, color: toplam >= 0 ? T.pos : T.neg, lineHeight: 1.1 }}>
            {fmtPct(toplam, 2, true)}
          </div>
          <div style={{ fontSize: 10.5, color: T.mut3, marginTop: 2 }}>para akışı arındırılmış</div>
        </div>
      )}
    </div>
  );
}

/* ————— VARLIK DAĞILIMI TREEMAP (Faz 32) —————
   Şerit (AlokasyonSeridi) "ne kadarı nerede"yi söylüyor ama hangi varlığın iyi/kötü gittiğini
   söylemiyor. Treemap ikisini TEK görselde veriyor: kutu BÜYÜKLÜĞÜ ağırlık, kutu RENGİ
   performans. Referans paneldeki kutucuk ızgarasının yaptığı iş budur.

   Yerleşim "squarified treemap": kutuları kareye yakın tutan klasik algoritma. Sıradan bir
   şerit/ızgara, %3'lük bir varlığı okunamayacak kadar ince bir dilime çevirirdi. */

type Kutu = { x: number; y: number; w: number; h: number; i: number };

/** Alanları (toplamı W*H'ye normalize edilmiş) kareye yakın kutulara böler. */
function squarify(alanlar: number[], W: number, H: number): Kutu[] {
  const out: Kutu[] = alanlar.map((_, i) => ({ x: 0, y: 0, w: 0, h: 0, i }));
  const toplam = alanlar.reduce((s, v) => s + v, 0);
  if (!(toplam > 0) || !(W > 0) || !(H > 0)) return out;
  const items = alanlar
    .map((v, i) => ({ i, a: (v / toplam) * W * H }))
    .filter((it) => it.a > 0)
    .sort((p, q) => q.a - p.a);

  let x = 0, y = 0, w = W, h = H;
  let sira: typeof items = [];

  const enKotu = (grup: typeof items, uzunluk: number) => {
    const s = grup.reduce((t, r) => t + r.a, 0);
    if (!(s > 0) || !(uzunluk > 0)) return Infinity;
    const enB = Math.max(...grup.map((r) => r.a));
    const enK = Math.min(...grup.map((r) => r.a));
    return Math.max((uzunluk * uzunluk * enB) / (s * s), (s * s) / (uzunluk * uzunluk * enK));
  };

  const yerlestir = (grup: typeof items) => {
    const s = grup.reduce((t, r) => t + r.a, 0);
    if (!(s > 0)) return;
    if (w >= h) {
      const gw = s / h;
      let cy = y;
      for (const r of grup) { const gh = r.a / gw; out[r.i] = { x, y: cy, w: gw, h: gh, i: r.i }; cy += gh; }
      x += gw; w -= gw;
    } else {
      const gh = s / w;
      let cx = x;
      for (const r of grup) { const gw2 = r.a / gh; out[r.i] = { x: cx, y, w: gw2, h: gh, i: r.i }; cx += gw2; }
      y += gh; h -= gh;
    }
  };

  for (const it of items) {
    const uzunluk = Math.min(w, h);
    if (sira.length === 0) { sira = [it]; continue; }
    if (enKotu([...sira, it], uzunluk) <= enKotu(sira, uzunluk)) sira.push(it);
    else { yerlestir(sira); sira = [it]; }
  }
  if (sira.length) yerlestir(sira);
  return out;
}

/* Yalnız İKİ metrik. Üçüncü bir "Dağılım" modu vardı ve kaldırıldı: kutu BOYUTU zaten her
   modda ağırlıktır, yani o mod ağırlığı ikinci kez anlatıyordu. Tek kattığı şey ağırlığın
   rakam olarak yazılmasıydı — o da tablodaki (sıralanabilir) "Ağırlık" kolonunda ve bu
   kutunun ipucu metninde zaten var. Üstelik rengi performans yerine varlık sınıfına
   çevirdiği için kartın kendi alt başlığını ("rengi performans") yalanlıyordu. */
type Metrik = "gunluk" | "toplam";
const METRIK_ETIKET: Record<Metrik, string> = { gunluk: "Günlük", toplam: "Toplam" };

export function VarlikTreemap({ pos, priceHistory, rates, ccy, height = 260 }: {
  pos: Position[]; priceHistory: PriceHistoryEntry[]; rates: Rates; ccy: Currency; height?: number;
}) {
  const [metrik, setMetrik] = useState<Metrik>("gunluk");

  const veri = useMemo(() => {
    const acik = openPositions(pos).filter((p) => p.value != null);
    const toplam = acik.reduce((s, p) => s + convert(p.value!, p.currency, "TRY", rates), 0);
    return acik
      .map((p) => {
        const tryDeger = convert(p.value!, p.currency, "TRY", rates);
        const gunluk = symbolReturns(priceHistory, `${p.type}:${p.sym}`).gunluk;
        return {
          p, tryDeger,
          agirlik: toplam > 0 ? tryDeger / toplam : 0,
          /* "Günlük" FİYAT getirisidir (sembolün kendi hareketi), "Toplam" ise SENİN
             pozisyonunun açık K/Z oranı — ikisi farklı sorulara cevap verir. */
          gunluk,
          toplam: p.unrealPct != null ? p.unrealPct * 100 : null,
        };
      })
      .sort((a, b) => b.tryDeger - a.tryDeger);
  }, [pos, priceHistory, rates]);

  const W = 100, H = 100; // viewBox birimi; kutular yüzde olarak konumlanır
  const kutular = useMemo(() => squarify(veri.map((v) => v.agirlik), W, H), [veri]);

  if (veri.length === 0) return null;

  /* Renk: metrik değeri yoksa NÖTR gri — sıfırmış gibi yeşile boyamak, fiyatı bilinmeyen
     varlığı "bugün değişmedi" diye gösterirdi. */
  const metrikOf = (v: { gunluk: number | null; toplam: number | null }) =>
    metrik === "gunluk" ? v.gunluk : v.toplam;
  const renkOf = (v: { gunluk: number | null; toplam: number | null }) => {
    const x = metrikOf(v);
    if (x == null) return { bg: T.panel3 ?? T.panel2, yazi: T.mut };
    /* Yoğunluk getirinin BÜYÜKLÜĞÜNE göre; %8 ve üstü tam doygun. Hepsini aynı tonda
       boyamak "hangisi daha çok kazandırdı" bilgisini siler. */
    const g = Math.min(1, Math.abs(x) / 8);
    const taban = x >= 0 ? T.pos : T.neg;
    return { bg: `color-mix(in srgb, ${taban} ${Math.round(45 + g * 55)}%, ${T.panel2})`, yazi: "#fff" };
  };
  const deger = (v: { gunluk: number | null; toplam: number | null }) => {
    const x = metrikOf(v);
    return x == null ? "—" : fmtPct(x, 2, true);
  };

  return (
    <div style={css.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Varlık Dağılımı</div>
          <div style={{ fontSize: 11.5, color: T.mut3, marginTop: 2 }}>kutu boyutu ağırlık, rengi performans</div>
        </div>
        <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: `1px solid ${T.line}` }}>
          {(Object.keys(METRIK_ETIKET) as Metrik[]).map((m) => (
            <button key={m} type="button" onClick={() => setMetrik(m)} style={{
              padding: "5px 10px", border: "none", cursor: "pointer", fontSize: 11.5, fontFamily: T.disp,
              fontWeight: metrik === m ? 700 : 500, minHeight: 0,
              background: metrik === m ? T.panel : T.panel2, color: metrik === m ? T.acc : T.mut,
            }}>{METRIK_ETIKET[m]}</button>
          ))}
        </div>
      </div>

      <div style={{ position: "relative", width: "100%", height, borderRadius: 10, overflow: "hidden" }}>
        {veri.map((v, i) => {
          const k = kutular[i];
          const { bg, yazi } = renkOf(v);
          if (!(k.w > 0) || !(k.h > 0)) return null;
          const dar = k.w < 18 || k.h < 14; // küçük kutuda yalnız sembol sığar
          return (
            <div key={`${v.p.type}:${v.p.sym}`}
              title={`${v.p.sym} · ağırlık ${fmtPay(v.agirlik)} · ${fmtMoney(Math.round(convert(v.tryDeger, "TRY", ccy, rates)), ccy)}`}
              style={{
                position: "absolute", left: `${k.x}%`, top: `${k.y}%`, width: `${k.w}%`, height: `${k.h}%`,
                background: bg, color: yazi, border: `2px solid ${T.panel}`, borderRadius: 8,
                display: "grid", placeItems: "center", textAlign: "center", padding: 4, boxSizing: "border-box",
                overflow: "hidden",
              }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ ...css.mono, fontSize: dar ? 10 : 12.5, fontWeight: 700, lineHeight: 1.2 }}>{v.p.sym}</div>
                {!dar && <div style={{ ...css.mono, fontSize: 11, opacity: 0.9 }}>{deger(v)}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
