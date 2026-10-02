import React from "react";
import {
  AreaChart, Area, ComposedChart, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid,
} from "recharts";
import {
  fmtD, parseD, keyOf, convert, depositValueOn, fundSellSuggestion, setupGaps, kurulumGerekli,
  kurumsalOneriler, dripSet, type KurumsalOneri,
  type AllData, type Day, type Position, type Rates,
} from "@finans/engine";
import { api } from "../../api";
import { T, css, tl, fmtPay, fmtMoney, TYPE_COLORS } from "../../theme";
import { Money, Empty, Aciklama, useSayfalama, DahaFazla } from "../../ui";
import type { TradePrefill } from "../../AddSheet";
import type { TabKey } from "../../nav";

const SETUP_DISMISS_KEY = "finans-setup-dismissed";

/** Bugün, `YYYY-MM-DD` (sunucunun todayLocal'ı ile aynı biçim) */
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** Adet biçimi: ondalık ayırıcı VİRGÜL, gereksiz sıfırlar atılır (varlık satırıyla aynı kural) */
const fmtAdet = (v: number) =>
  Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");

/** Dağılım şeridindeki görünen ad — veri anahtarı (KRIPTO…) değişmez, yalnız okunuşu */
const SINIF_ADI: Record<string, string> = { KRIPTO: "Kripto", FON: "Fon", ALTIN: "Altın", DOVIZ: "Döviz" };

export type OzetSummary = {
  netWorthTry: number; cash: number; portValueTry: number; depositsValueTry: number;
  cardDebt: number; loanDebt: number; accountCount: number; portTypes: string[];
  cardsWaiting: number; loansActive: number;
};

/* Görünümü değiştiren küçük seçici (Faz 24 kural 2: çukur şerit, seçili = beyaz yüzey + mor metin) */
function Secici<V extends string | number>({ secenek, deger, sec, ad }: {
  secenek: { v: V; l: string }[]; deger: V; sec: (v: V) => void; ad: string;
}) {
  return (
    <div role="group" aria-label={ad} style={{ display: "inline-flex", padding: 3, gap: 2, background: T.panel2, borderRadius: 10, flexShrink: 0 }}>
      {secenek.map((s) => {
        const on = s.v === deger;
        return (
          <button key={String(s.v)} onClick={() => sec(s.v)} aria-pressed={on} className="ozet-secici" style={{
            border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontFamily: T.disp, fontSize: 13,
            fontWeight: on ? 600 : 500, background: on ? T.panel : "transparent", color: on ? T.acc : T.mut,
            boxShadow: on ? "var(--shadow-sm)" : "none", whiteSpace: "nowrap",
          }}>{s.l}</button>
        );
      })}
    </div>
  );
}

const Tamam = () => (
  <span style={{ width: 18, height: 18, flexShrink: 0, borderRadius: 999, background: T.posSoft, color: T.pos, display: "grid", placeItems: "center" }}>
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2 5.2l2 2L8 3" /></svg>
  </span>
);
const Kapat = ({ onClick }: { onClick: () => void }) => (
  <button title="Bir daha gösterme" aria-label="Bir daha gösterme" onClick={onClick} className="ozet-x" style={{
    background: "none", border: "none", color: T.mut, cursor: "pointer", padding: 6, borderRadius: 7, display: "grid", placeItems: "center", flexShrink: 0,
  }}>
    <svg width="11" height="11" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 3l6 6M9 3l-6 6" /></svg>
  </button>
);
/** Satır içi eylem: mor METİN (dolgulu düğme değil) — bir listede dört dolu düğme yan yana
    durunca hiçbiri öne çıkmıyordu. `ikincil` gri: aynı satırdaki ikinci seçenek. */
const Eylem = ({ onClick, children, ikincil, title }: { onClick: () => void; children: React.ReactNode; ikincil?: boolean; title?: string }) => (
  <button onClick={onClick} title={title} style={{
    background: "none", border: "none", cursor: "pointer", fontFamily: T.disp, fontSize: 13.5, padding: "6px 4px",
    fontWeight: ikincil ? 500 : 600, color: ikincil ? T.mut : T.acc, whiteSpace: "nowrap",
  }}>{children}</button>
);
const grpBaslik: React.CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: T.mut, padding: "12px 0 6px" };

/* Özet grafikleri TRY canonical'dır (nakit projeksiyonu + portföy değeri geçmişi hep TRY).
   Net varlık + kutular buradadır (değerler App.tsx'te TRY hesaplanıp görüntü birimine çevrilerek gelir).
   Hesap bakiyeleri Hesaplar sekmesindedir (kullanıcı bakiyelere oradan bakıyor — yeniden tasarım, Ekim 2026). */
export function Ozet({ data, days, pos, cash, rates, reload, summary, m, onGo, onSellFund, onKurumsalOlay, onKurulum }: {
  data: AllData; days: Day[]; pos: Position[]; cash: number; rates: Rates; reload: () => void;
  summary: OzetSummary; m: (v: number, dec?: boolean) => string;
  /** kutulara / önerilere dokununca ilgili sekme */
  onGo: (t: TabKey) => void;
  onSellFund: (p: TradePrefill) => void;
  /** Faz 36 — kaçırılan kurumsal olayı önden dolu işlem formuyla açar */
  onKurumsalOlay: (p: TradePrefill) => void;
  /** Kurulum sihirbazını açar (hiçbir şey girilmemiş hesapta Özet'in tek anlamlı eylemi) */
  onKurulum: () => void;
}) {
  /* "Ödeme öncesi fon boz" önerisi (Faz 17): saf nakit önümüzdeki hafta eksiye düşüyorsa,
     nakit sayılan fondan ne kadar bozulacağını hesaplar. Bkz. funds.ts — tutar pencerenin
     EN DERİN noktasından gelir, yoksa iki gün sonra yine açık verilir. */
  const sell = fundSellSuggestion(days, data, rates);
  /* Satışın hangi hesaba gireceği: o fonda en son kullandığın hesap (yoksa ilk hesap) —
     paranın nereye gitmesi gerektiğini kullanıcı zaten geçmişte söylemiş. */
  const sellAccountId = sell
    ? [...data.trades].reverse().find((t) => t.asset_type === "FON" && t.symbol.toUpperCase() === sell.fund.symbol && t.account_id != null)?.account_id
      ?? data.accounts[0]?.id ?? null
    : null;
  /* Likit (etkin) nakit = harcanabilir nakit + "nakit say" işaretli para piyasası fonları.
     Takvimle aynı tanım; portföy/hisse/vadeli buna girmez (onlar toplam varlıkta). */
  const eff = (d: Day) => d.bal + d.cashFunds;
  const minDay = days.reduce((m, d) => (eff(d) < eff(m) ? d : m), days[0] ?? { bal: 0, cashFunds: 0, date: new Date() } as Day);
  const chart = days
    .filter((_, i) => i % Math.max(1, Math.floor(days.length / 240)) === 0)
    .map((d) => ({ x: fmtD(d.date, { day: "numeric", month: "short" }), bal: Math.round(eff(d)) }));
  /* Varlık ve borç serisi (Faz 33 Toplam Varlık): Nakit modu ile AYNI örnekleme. */
  const varlik = days
    .filter((_, i) => i % Math.max(1, Math.floor(days.length / 240)) === 0)
    .map((d) => ({
      x: fmtD(d.date, { day: "numeric", month: "short" }),
      total: Math.round(d.total), worth: Math.round(d.worth),
    }));
  const VARLIK_ETIKET: Record<string, string> = { total: "Toplam varlık", worth: "Net varlık" };
  const varlikNegatif = varlik.some((r) => r.worth < 0);
  const varlikSon = varlik.at(-1);
  const worthDelta = varlikSon && varlik[0] ? varlikSon.worth - varlik[0].worth : 0;
  const ufuk = data.settings.horizon || "6";
  const upcoming = days.filter((d) => d.ev.length).slice(0, 20)
    .flatMap((d) => d.ev.map((e) => ({ ...e, date: d.date }))).slice(0, 6);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  /* runway: likit nakitin ilk kez sıfırın altına düştüğü gün — "param ne zaman biter" */
  const runwayDay = days.find((d) => eff(d) < 0);
  const runwayIn = runwayDay ? Math.round((runwayDay.date.getTime() - today.getTime()) / 86_400_000) : null;
  const depositsValue = data.deposits.reduce((s, d) => s + depositValueOn(d, today), 0);
  /* Dağılım BÜYÜKTEN KÜÇÜĞE (eski Varlık Dağılımı halkasının bilgisi — artık net varlık kartındaki
     şeritte): "paramın çoğu nerede" sorusu ilk sırada cevaplanmalı. Pay işaretsizdir (fmtPay). */
  const alloc = [
    { name: "Nakit", value: Math.max(0, cash) },
    ...Object.entries(pos.reduce((m, p) => {
      if (p.value) m[p.type] = (m[p.type] || 0) + convert(p.value, p.currency, "TRY", rates); return m;
    }, {} as Record<string, number>)).map(([name, value]) => ({ name, value })),
    { name: "Vadeli", value: depositsValue },
  ].filter((a) => a.value > 0).sort((a, b) => b.value - a.value);
  const allocTotal = alloc.reduce((s, a) => s + a.value, 0);

  const kpis: { name: string; color: string; val: string; sub: string; neg?: boolean; tab: TabKey }[] = [
    { name: "Nakit", color: "var(--type-nakit)", val: m(summary.cash), sub: `${summary.accountCount} hesap`, tab: "hesaplar" },
    { name: "Portföy", color: "var(--type-etf)", val: m(summary.portValueTry), sub: summary.portTypes.length ? summary.portTypes.join(" · ") : "henüz işlem yok", tab: "portfoy" },
    { name: "Kart borcu", color: "color-mix(in srgb, var(--neg) 50%, var(--surface))", neg: summary.cardDebt > 0, val: (summary.cardDebt > 0 ? "−" : "") + m(summary.cardDebt), sub: summary.cardsWaiting > 0 ? `${summary.cardsWaiting} ekstre bekliyor` : "borç yok", tab: "kart" },
    { name: "Kredi borcu", color: T.neg, neg: summary.loanDebt > 0, val: (summary.loanDebt > 0 ? "−" : "") + m(summary.loanDebt), sub: summary.loansActive > 0 ? `${summary.loansActive} aktif kredi` : "borç yok", tab: "plan" },
  ];

  const [mod, setMod] = React.useState<"nakit" | "varlik">("nakit");
  /* Kurulum eksikleri (Faz 16/17 opt-in yetenekleri): kural engine'de (setupGaps), burası yalnız
     gösterir; kapatılan uyarı localStorage'da saklanır (kendi kararı kalıcı olsun). */
  const [dismissed, setDismissed] = React.useState<string[]>(
    () => (localStorage.getItem(SETUP_DISMISS_KEY) || "").split(",").filter(Boolean),
  );
  const gaps = setupGaps(data, keyOf(new Date())).filter((g) => !dismissed.includes(g.key));
  const [acikDetay, setAcikDetay] = React.useState<string | null>(null);

  /* Faz 36 — KAÇIRILAN KURUMSAL OLAYLAR. Kural engine'de (kurumsalOneriler); burası yalnız
     gösterir ve önden dolu formu açar. Kayıt YAZILMAZ: adet kullanıcının defteridir.
     `dismissed` ile AYNI kapatma kutusunu kullanır ama ayrı anahtar alanı (`ca:…`). */
  const olaylar = React.useMemo(() => kurumsalOneriler(data.trades, data.corporate_actions ?? [], {
    dripSymbols: dripSet(data.settings),
    priceHistory: data.price_history,
    today: todayStr(),
  }), [data]);
  const olayKey = (o: KurumsalOneri) => `ca:${o.kind}:${o.asset_type}:${o.symbol}:${o.date}`;
  const gorunenOlaylar = olaylar.filter((o) => !dismissed.includes(olayKey(o)));
  /* Liste UZUNLUĞU sınırlanır (gerçek veride 9 kayıtsız temettü çıkmıştı): bu bir uyarı, liste
     ekranı değil. `useSayfalama` + `DahaFazla` ev kuralı. */
  const sOlay = useSayfalama(gorunenOlaylar, 3, dismissed.length);
  const dismiss = (key: string) => {
    const next = [...dismissed, key];
    setDismissed(next);
    localStorage.setItem(SETUP_DISMISS_KEY, next.join(","));
  };
  /* Mobilde kurulum önerileri katlı başlar: düzeltme (eksik kayıt) öneriden önce gelir.
     Düzeltme yoksa açık başlar — yoksa kart boş bir başlıktan ibaret kalırdı. */
  const [kurAcik, setKurAcik] = React.useState(() => gorunenOlaylar.length === 0);
  const ikiGrup = gorunenOlaylar.length > 0 && gaps.length > 0;

  const tooltipStil = { background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 8, fontFamily: T.mono, fontSize: 12 };
  const eksen = { fill: T.mut, fontSize: 10, fontFamily: T.mono };

  return (<>
    {/* ————— NET VARLIK + KUTULAR —————
        Kutular eski yerleşimle durur (öğrenilmiş yer); eski hero eğrisinin yerinde "varlıkların
        nerede" şeridi var — Varlık Dağılımı halkasının bilgisi, ayrı bir kart açmadan. */}
    <div className="ozet-ust">
      <div style={{ ...css.card, display: "flex", flexDirection: "column", padding: "22px 24px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: T.mut }}>Net varlık</div>
            <div className="nw-value" style={{ ...css.mono, fontSize: 42, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 4, lineHeight: 1.05, color: summary.netWorthTry < 0 ? T.neg : T.text }}>{m(summary.netWorthTry)}</div>
            <div className="desktop-only" style={{ fontSize: 12.5, color: T.mut, marginTop: 6 }}>nakit + portföy{summary.depositsValueTry > 0 ? " + vadeli" : ""} − kart borcu − kredi borcu</div>
          </div>
          {/* "N ay sonra" = eski Toplam Varlık rozetinin rakamı (Day.worth, ufkun son günü) —
              net varlığın yönünü, hero eğrisinin söylediği şeyi tek rakamla söyler. */}
          {varlikSon && varlik.length > 1 && (
            <div style={{ textAlign: "right", paddingTop: 2, flexShrink: 0 }}>
              <div style={{ fontSize: 12.5, color: T.mut }}>{ufuk} ay sonra</div>
              <div style={{ ...css.mono, fontSize: 15, fontWeight: 500, color: worthDelta >= 0 ? T.pos : T.neg, whiteSpace: "nowrap" }}>
                {worthDelta >= 0 ? "↗" : "↘"} {m(varlikSon.worth)}
              </div>
            </div>
          )}
        </div>
        {alloc.length > 0 && (
          <div style={{ marginTop: "auto", paddingTop: 18, display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", fontSize: 12.5, color: T.mut }}>
              <span style={{ flex: 1 }}>Varlıkların nerede</span>
              <span style={css.mono}>{m(allocTotal)}</span>
            </div>
            <div style={{ display: "flex", height: 12, gap: 2, borderRadius: 4, overflow: "hidden" }}>
              {alloc.map((a) => (
                <span key={a.name} title={`${SINIF_ADI[a.name] ?? a.name} · ${fmtPay(a.value / allocTotal)} · ${tl.format(Math.round(a.value))}`}
                  style={{ width: `${(a.value / allocTotal) * 100}%`, minWidth: 3, background: TYPE_COLORS[a.name] || T.mut }} />
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 12.5, color: T.mut }}>
              {alloc.map((a) => (
                <span key={a.name} style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: TYPE_COLORS[a.name] || T.mut }} />
                  {SINIF_ADI[a.name] ?? a.name} <b style={{ ...css.mono, color: T.text, fontWeight: 600 }}>{fmtPay(a.value / allocTotal)}</b>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="ozet-kpi">
        {kpis.map((k) => (
          <button key={k.name} className="ozet-kutu" onClick={() => onGo(k.tab)} style={{
            ...css.card, padding: "16px 18px", textAlign: "left", cursor: "pointer", fontFamily: T.disp, color: T.text,
            display: "flex", flexDirection: "column", gap: 6, minWidth: 0, borderRadius: 16,
          }}>
            <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: T.mut }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: k.color, flexShrink: 0 }} />{k.name}
            </span>
            <span className="kpi-val" style={{ ...css.mono, fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap", color: k.neg ? T.neg : T.text }}>{k.val}</span>
            <span className="kpi-sub" style={{ fontSize: 12, color: T.mut, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{k.sub}</span>
          </button>
        ))}
      </div>
    </div>

    {/* Boş hesap: sihirbaz "Sonra" ile kapatılmış olabilir. Bu durumda Özet'teki her kart boştur
        ve tek anlamlı eylem kurulumdur — setupGaps de hiç hesap yokken bilerek susar. */}
    {kurulumGerekli(data) && (
      <div style={{ ...css.card, padding: 20, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Birkaç soruda kuralım</div>
          <div style={{ fontSize: 14, color: T.mut, marginTop: 4, lineHeight: 1.45 }}>Hesaplar, gelir, kartlar, düzenli giderler ve krediler — sonunda ay sonunda ne kalacağını görürsün.</div>
        </div>
        <button style={css.btn} onClick={onKurulum}>Kurulumu başlat</button>
      </div>
    )}

    {/* ————— SENDEN BEKLEYENLER —————
        Eski "Defterinde eksik kayıt" + "Kurulumunu tamamla" kartları TEK kartta, ama EŞİTLENMEDEN:
        düzeltme (kaydedilmezse rakam yanlış) önce/solda, öneri (bir özelliği kur) sonra/sağda. */}
    {(gorunenOlaylar.length > 0 || gaps.length > 0) && (
      <div style={{ ...css.card, padding: "16px 22px 12px" }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Senden bekleyenler</div>
        <div className={ikiGrup ? "ozet-bek" : undefined}>
          {gorunenOlaylar.length > 0 && (
            <div style={{ minWidth: 0 }}>
              <div style={grpBaslik}>Defterinde eksik · {gorunenOlaylar.length}</div>
              {sOlay.gorunen.map((o) => {
                const bedelsiz = o.kind === "bedelsiz";
                /* Tür rozeti kendi rengini taşır: temettü para GİRİŞİdir (yeşil), bedelsiz adet
                   değişimidir (mavi). Marka moru burada kullanılmaz. */
                const renk = bedelsiz ? "var(--cat-1)" : T.pos;
                const kaydet = () => onKurumsalOlay(bedelsiz
                  ? { asset_type: o.asset_type, symbol: o.symbol, side: "BEDELSİZ", qty: o.qty, price: 0, date: o.date }
                  /* Temettüde `price` = HİSSE BAŞINA tutar (formun kendi temsili), `qty` = adet. */
                  : { asset_type: o.asset_type, symbol: o.symbol, side: "TEMETTÜ", qty: o.qty, price: o.perShare, date: o.date });
                const geriYatir = o.kind === "bedelsiz" ? null : ((t) => () => onKurumsalOlay(t.reinvest
                  ? { asset_type: t.asset_type, symbol: t.symbol, side: "ALIŞ", qty: t.reinvest.qty, price: t.reinvest.price, date: t.date }
                  /* fiyat yok → qty VERİLMEZ, form tutar modunda açılır */
                  : { asset_type: t.asset_type, symbol: t.symbol, side: "ALIŞ", amount: t.amount, date: t.date }))(o);
                return (
                  <div key={olayKey(o)} style={{ borderTop: `1px solid ${T.line2}`, padding: "8px 0 6px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", flexShrink: 0,
                        color: renk, background: `color-mix(in srgb, ${renk} 12%, transparent)`, borderRadius: 5, padding: "2px 6px",
                      }}>{bedelsiz ? "bedelsiz" : "temettü"}</span>
                      <span style={{ ...css.mono, fontSize: 14, fontWeight: 600 }}>{o.symbol}</span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: T.mut, whiteSpace: "nowrap" }}>
                        {fmtD(parseD(o.date), { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                      <Kapat onClick={() => dismiss(olayKey(o))} />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                      <div style={{ flex: "1 1 200px", minWidth: 0, fontSize: 13, color: T.text, lineHeight: 1.5 }}>
                        {bedelsiz
                          ? <><b style={css.mono}>{fmtAdet(o.qtyBefore)}</b> adet → <b style={css.mono}>+{fmtAdet(o.qty)}</b> adet eklenmeli</>
                          : <><span style={css.mono}>{fmtAdet(o.qty)}</span> adet × <span style={css.mono}>{fmtMoney(o.perShare, o.currency, true)}</span> = <b style={css.mono}>{fmtMoney(o.amount, o.currency, true)}</b> brüt</>}
                        {!bedelsiz && o.reinvest && (
                          <span style={{ display: "block", color: T.mut, fontSize: 12.5 }}>
                            geri yatırım: <span style={css.mono}>{fmtAdet(o.reinvest.qty)}</span> adet @ <span style={css.mono}>{fmtMoney(o.reinvest.price, o.currency, true)}</span>
                          </span>
                        )}
                        {/* DRIP açık ama ödeme gününün fiyatı yok: adet UYDURULMAZ, ama sessiz de kalınmaz */}
                        {!bedelsiz && o.drip && !o.reinvest && (
                          <span style={{ display: "block", color: T.mut, fontSize: 12.5 }}>
                            geri yatırım: o günün fiyatı yok — alışı tutarla gir, adedi fiyattan hesaplanır
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 10, marginLeft: "auto" }}>
                        {!bedelsiz && o.drip && geriYatir && <Eylem ikincil onClick={geriYatir} title="Temettü tutarıyla aynı hisseden alış kaydı aç (önce temettüyü kaydet)">Geri yatır</Eylem>}
                        <Eylem onClick={kaydet}>Kaydet</Eylem>
                      </div>
                    </div>
                  </div>
                );
              })}
              <DahaFazla s={sOlay} ad="olay" yon="fazla" />
              {/* Dip notunda BİR KEZ: eskiden her satırda tekrarlanıyordu. Brüt notu yalnız temettü varsa. */}
              <div style={{ fontSize: 12, color: T.mut, lineHeight: 1.45, padding: "4px 0 6px" }}>
                Kaydetmezsen adet eksik kalır ve düşüş zarar gibi okunur.
                {gorunenOlaylar.some((o) => o.kind === "temettu") && " Temettü brüttür (stopaj düşülmemiş) — formda düzeltebilirsin."}
              </div>
            </div>
          )}
          {gaps.length > 0 && (
            <div style={{ minWidth: 0 }}>
              {/* masaüstünde başlık, mobilde katlanan başlık (App.tsx .kur-*) */}
              <div className="kur-baslik" style={grpBaslik}>Kurulum önerisi · {gaps.length}</div>
              <button className="kur-toggle" onClick={() => setKurAcik((a) => !a)} aria-expanded={kurAcik} style={{
                alignItems: "center", gap: 8, width: "100%", background: "none", border: "none",
                borderTop: gorunenOlaylar.length ? `1px solid ${T.line2}` : "none", padding: "12px 0",
                cursor: "pointer", fontFamily: T.disp, fontSize: 14, color: T.text, textAlign: "left",
              }}>
                <span style={{ flex: 1 }}>Kurulum önerisi</span>
                <span style={{ ...css.mono, fontSize: 12, padding: "1px 7px", borderRadius: 10, background: T.panel2, color: T.mut }}>{gaps.length}</span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={T.mut} strokeWidth="1.6" strokeLinecap="round" style={{ transform: kurAcik ? "rotate(180deg)" : "none" }}><path d="M3 4.5l3 3 3-3" /></svg>
              </button>
              <div className="kur-liste" data-acik={kurAcik}>
                {gaps.map((g) => (
                  <div key={g.key} style={{ borderTop: `1px solid ${T.line2}`, padding: "6px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 14 }}>{g.title}</span>
                      <button aria-label="Neden?" title="Neden?" aria-expanded={acikDetay === g.key}
                        onClick={() => setAcikDetay((k) => (k === g.key ? null : g.key))}
                        style={{ background: "none", border: "none", color: acikDetay === g.key ? T.acc : T.mut, cursor: "pointer", padding: 6, display: "grid", placeItems: "center" }}>
                        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="6.5" /><path d="M8 7.2v4M8 4.8v.1" strokeLinecap="round" /></svg>
                      </button>
                      <Eylem onClick={() => onGo(g.tab as TabKey)}>{g.action}</Eylem>
                      <Kapat onClick={() => dismiss(g.key)} />
                    </div>
                    {acikDetay === g.key && <div style={{ fontSize: 12.5, color: T.mut, lineHeight: 1.5, padding: "0 0 6px" }}>{g.detail}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )}

    {/* ————— GRAFİK | YAKLAŞAN —————
        Yan yana ve eşit yükseklikte: Yaklaşan listesi grafiğin basamaklarını (kira, maaş, ekstre)
        açıklıyor. Grafik iki moddur: Nakit (eski Nakit Haritası) | Varlık ve borç (eski Toplam
        Varlık, Faz 33) — aynı x ekseni ve ufukla iki ayrı kart çiziliyordu. */}
    <div className="ozet-alt">
      <div style={{ ...css.card, padding: "18px 22px 12px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Secici ad="Grafik" deger={mod} sec={setMod} secenek={[{ v: "nakit", l: "Nakit" }, { v: "varlik", l: "Varlık ve borç" }]} />
          <span style={{ flex: 1 }} />
          {/* Ufuk KALICI bir ayardır (settings.horizon): Nakit Akışı'nın penceresini de değiştirir */}
          <Secici ad="Ufuk" deger={ufuk} sec={async (v) => { await api.put("settings", { horizon: v }); reload(); }}
            secenek={["3", "6", "12", "24"].map((v) => ({ v, l: `${v} ay` }))} />
        </div>

        {runwayDay ? (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, color: runwayIn! <= 0 ? T.neg : T.warn, background: runwayIn! <= 0 ? T.negSoft : T.warnSoft, borderRadius: 10, padding: "9px 12px", fontSize: 14, lineHeight: 1.45 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 2 }}><path d="M8 2l6.5 11.5h-13Z" /><path d="M8 6.5v3M8 11.5v.1" /></svg>
            <span>{runwayIn! <= 0
              ? <>Likit nakitin şu an ekside (<span style={css.mono}>{tl.format(Math.round(eff(runwayDay)))}</span>). Gelir kalemi girmemiş veya bir hesap bakiyesi eksi olabilir.</>
              : <>Likit nakitin <b>{fmtD(runwayDay.date, { day: "numeric", month: "long" })}</b> dolayında tükeniyor (~{runwayIn} gün sonra).</>}</span>
          </div>
        ) : mod === "nakit" && days.length > 0 ? (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 14, lineHeight: 1.45 }}>
            <Tamam />
            <span>Likit nakit {ufuk} ay boyunca eksiye düşmüyor. En düşük: <b style={{ fontWeight: 600 }}>{fmtD(minDay.date, { day: "numeric", month: "short" })}</b> · <span style={{ ...css.mono, fontWeight: 500 }}>{tl.format(Math.round(eff(minDay)))}</span></span>
          </div>
        ) : null}

        {mod === "nakit" ? (
          <Aciklama k="likit-nakit" label="likit nakit nedir?">
            Likit nakit = hesap bakiyeleri + “nakit say” işaretli para piyasası fonları. Portföy, hisse ve vadeli mevduat buna dahil değildir (onlar toplam varlıkta).
          </Aciklama>
        ) : (<>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5, color: T.mut, alignItems: "center" }}>
            {varlikSon && <span style={{ color: T.text, fontSize: 13.5 }}>{ufuk} ay sonra net varlık <b style={{ ...css.mono, fontWeight: 600, color: worthDelta >= 0 ? T.pos : T.neg }}>{tl.format(varlikSon.worth)}</b></span>}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, height: 10, borderRadius: 2, background: "color-mix(in srgb, var(--type-etf) 22%, var(--surface))", border: "1px solid var(--type-etf)" }} />net varlık</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, height: 10, borderRadius: 2, background: T.negSoft }} />borç (üst bant)</span>
          </div>
          <Aciklama k="toplam-varlik" label="bu grafik neyi gösteriyor?">
            Yeşil alan <b>net varlığın</b> (en üstteki rakamla aynı tanım), üstündeki kırmızı bant
            <b> borcun</b>; ikisi birlikte <b>toplam varlığın</b>: nakit + portföy + vadeli mevduat.
            Bant inceldikçe borç eriyor demektir. Borç ödemek net varlığı değiştirmez (nakit azalır,
            borç da azalır) — yeşili yukarı taşıyan şey birikimdir. Portföy <b>bugünkü fiyatla</b>
            taşınır; ileriye dönük bir fiyat tahmini yoktur.
          </Aciklama>
        </>)}

        {/* Ödeme öncesi fon boz önerisi — grafiğin İÇİNDE (sebep ile çare yan yana). Etkin nakit
            değil SAF nakit eksiye düştüğünde çıkar. Ekranın tek dolgulu mor düğmesi. */}
        {sell && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: `1px solid ${T.line}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ flex: 1, minWidth: 220, fontSize: 14, lineHeight: 1.45 }}>
              <b>{fmtD(sell.gap.firstNegative.date, { day: "numeric", month: "long" })}</b> günü nakitin{" "}
              <span style={{ ...css.mono, color: T.neg }}>{tl.format(Math.round(sell.gap.amount))}</span> açık veriyor.{" "}
              <b>{sell.fund.symbol}</b> fonundan <span style={css.mono}>{tl.format(Math.round(sell.amount))}</span> bozarsan kapanır.
              <div style={{ fontSize: 12.5, color: T.mut, marginTop: 2 }}>
                en geç {fmtD(sell.sellBy, { day: "numeric", month: "long" })} · fonda{" "}
                <span style={css.mono}>{tl.format(Math.round(sell.fund.valueTry))}</span> var
                {!sell.covered && <span style={{ color: T.warn }}> · fon açığın tamamını kapatmıyor</span>}
              </div>
            </div>
            <button style={{ ...css.btn, padding: "9px 14px", fontSize: 13.5 }} onClick={() => onSellFund({
              asset_type: "FON", symbol: sell.fund.symbol, side: "SATIŞ",
              amount: +sell.amount.toFixed(2),
              date: keyOf(sell.sellBy), // yerel gün — toISOString UTC'ye kaydırıp bir gün geri alırdı
              account_id: sellAccountId,
            })}>Fon boz</button>
          </div>
        )}

        <div style={{ height: 220, marginTop: "auto" }}>
          <ResponsiveContainer width="100%" height="100%">
            {mod === "nakit" ? (
              <AreaChart data={chart} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="ozet-nakit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--type-nakit)" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="var(--type-nakit)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={T.line2} vertical={false} />
                <XAxis dataKey="x" tick={eksen} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis tick={eksen} tickLine={false} axisLine={false} width={46}
                  tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                <Tooltip contentStyle={tooltipStil} labelStyle={{ color: T.mut }} formatter={(v: number) => [tl.format(v), "Likit nakit"]} />
                <ReferenceLine y={0} stroke={T.neg} strokeDasharray="4 4" />
                <Area type="stepAfter" dataKey="bal" stroke="var(--type-nakit)" strokeWidth={2} fill="url(#ozet-nakit)" />
              </AreaChart>
            ) : (
              <ComposedChart data={varlik} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                <CartesianGrid stroke={T.line2} vertical={false} />
                <XAxis dataKey="x" tick={eksen} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis tick={eksen} tickLine={false} axisLine={false} width={46}
                  tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                <Tooltip contentStyle={tooltipStil} labelStyle={{ color: T.mut }} formatter={(v: number, n: string) => [tl.format(v), VARLIK_ETIKET[n] ?? n]} />
                {varlikNegatif && <ReferenceLine y={0} stroke={T.neg} strokeDasharray="4 4" />}
                {/* Önce toplam (kırmızı bant), üstüne net (yeşil): aradaki görünen bant = borç */}
                <Area type="stepAfter" dataKey="total" stroke="color-mix(in srgb, var(--neg) 40%, var(--surface))" strokeWidth={1.5} fill="var(--neg-soft)" fillOpacity={1} />
                <Area type="stepAfter" dataKey="worth" stroke="var(--type-etf)" strokeWidth={2} fill="color-mix(in srgb, var(--type-etf) 22%, var(--surface))" fillOpacity={1} />
              </ComposedChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ ...css.card, padding: "16px 20px 8px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
          <div style={{ flex: 1, fontWeight: 700, fontSize: 16 }}>Yaklaşan</div>
          <button onClick={() => onGo("nakit")} style={{ background: "none", border: "none", color: T.acc, fontFamily: T.disp, fontSize: 13.5, fontWeight: 500, cursor: "pointer", padding: "6px 0" }}>Nakit akışı →</button>
        </div>
        {upcoming.length === 0 ? <Empty>Plan sekmesinden gelir/gider ekleyin.</Empty> : upcoming.map((e, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderTop: `1px solid ${T.line2}` }}>
            <div style={{ width: 34, textAlign: "center", lineHeight: 1.05, flexShrink: 0 }}>
              <div style={{ ...css.mono, fontSize: 15, fontWeight: 600 }}>{fmtD(e.date, { day: "2-digit" })}</div>
              <div style={{ fontSize: 11, color: T.mut }}>{fmtD(e.date, { month: "short" })}</div>
            </div>
            <div style={{ flex: 1, minWidth: 0, fontSize: 14.5, overflow: "hidden", textOverflow: "ellipsis" }}>{e.n}</div>
            <Money v={e.a} sign size={14.5} />
          </div>
        ))}
      </div>
    </div>
  </>);
}
