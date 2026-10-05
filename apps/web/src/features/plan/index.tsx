import React, { useState } from "react";
import { todayStr, parseD, fmtD, keyOf, num, ymOf, recActiveOn, recOccurrenceDate, recurringAmountIndex, recAmountOn, loanPayDay, loanRemaining, REC_AMOUNT_BEGIN, type AllData, type Recurring, type OneOff } from "@finans/engine";
import { api } from "../../api";
import { T, css, tl } from "../../theme";
import { Money, Empty, SilDugmesi, Aciklama, Modal, useSayfalama, DahaFazla } from "../../ui";
import type { KalemPrefill } from "../forms";
import { KategoriAlani } from "../forms/KategoriAlani";
import { Bolum, FormAlt, Satirlar, SatirSec, SatirTarih, TutarGirdisi, Vurgu } from "../forms/parcalar";
import { EditSheet, type EditTarget } from "../../EditSheet";

/* ————— PLAN (nakit projeksiyonunu besleyen her şey tek yerde) —————
   Düzenli gelir/giderler + ileri tarihli tek seferlik kalemler + krediler.
   Buradaki kayıtlar "gelecekte ne olacak" sorusuna cevaptır; Nakit Akışı bunlardan üretilir.
   Ekleme global "+ Ekle"dendir.

   Yeniden tasarım (Ekim 2026, grup 5): satırlar Faz 24 kural 1'in yeni hâlinde — satırın tamamı
   açar, ✎ ✕ yok. Düzenli kalem satırında yalnız BEKLEYEN tek eylem ("Eki gerçekleşti") ya da durum
   kalır; eskiden her satırda Değiştir + Gerçekleşti + ✎ + ✕ dört kontrol vardı. Satıra dokununca
   KALEM SAYFASI (`KalemSayfasi`): bu ayın tutarı + gerçekleştir/geri al, tutar zaman çizelgesi
   (planlı değişikliği kaldır), "Tutarı değiştir" (Faz 9 akışı — kayıt bölünmez) ve gün/hedef/dönem
   için düzenleme formu (silme orada). Tek seferlik ve kredi satırı doğrudan düzenleme formunu açar. */

const fmtYm = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("tr-TR", { month: "short", year: "numeric" });
};
const ayKisa = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("tr-TR", { month: "short" });
};

/** Satırın sağındaki küçük durum rozeti */
const Rozet = ({ children, renk, zemin }: { children: React.ReactNode; renk: string; zemin: string }) => (
  <span style={{ fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 7, background: zemin, color: renk, whiteSpace: "nowrap" }}>{children}</span>
);

const satirStil = (ilk: boolean): React.CSSProperties => ({
  display: "flex", alignItems: "center", gap: 12, padding: "11px 6px", margin: "0 -6px",
  borderTop: ilk ? "none" : `1px solid ${T.line2}`, borderRadius: 8, cursor: "pointer",
});
const kartBaslik = (baslik: string, sag?: React.ReactNode) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
    <div style={{ fontWeight: 700, fontSize: 16, flex: 1 }}>{baslik}</div>
    {sag && <div style={{ fontSize: 13, color: T.mut }}>{sag}</div>}
  </div>
);

export function Plan({ data, reload, onRealize }: { data: AllData; reload: () => void; onRealize: (p: KalemPrefill) => void }) {
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [kalem, setKalem] = useState<{ id: number; gorunum: KalemGorunum } | null>(null);
  const curYm = ymOf(new Date());
  const now = new Date();
  const today = todayStr();
  /* gerçekleşmiş (kalem, bu ay) çiftleri — "Gerçekleşti"/"Geri al" durumu için */
  const realizedSet = new Set(data.recurring_realized.map((x) => `${x.recurring_id}:${x.ym}`));
  /* tutar zaman çizelgesi: satırda bu ayın tutarı gösterilir, gelecek değişiklikler ipucu olur */
  const amtIdx = recurringAmountIndex(data.recurring_amounts ?? []);
  const durum = (r: Recurring) => {
    const ended = !!r.to_month && r.to_month < curYm;
    const active = recActiveOn(r, now) && !ended;
    const due = keyOf(recOccurrenceDate(r, curYm)) <= today; // bu ayın günü geçti mi
    const realizedNow = realizedSet.has(`${r.id}:${curYm}`);
    const hasTarget = r.account_id != null || r.card_id != null;
    return { ended, active, due, realizedNow, hasTarget, bekliyor: active && due && !realizedNow };
  };
  const realizeRec = async (r: Recurring, body: { account_id?: number | null; category_id?: number | null } = {}) => {
    /* Tutarı istemci çözüp gönderir (E2EE aşama 1b): zaman çizelgesinden bu ayın tutarı,
       İŞARETİYLE. KARTA düşen gider kart ekstresine POZİTİF yazılır (borç büyür), hesaba düşen
       ise gider olarak EKSİ. Tutar çözülemiyorsa alan hiç gönderilmez ve sunucu yedek yoldan
       hesaplar — 0 göndermek kalemi "tutarsız gerçekleşti" diye yazardı. */
    const ham = recAmountOn(amtIdx.get(r.id), curYm);
    const kartaMi = r.card_id != null && r.kind === "expense";
    const amount = ham === undefined ? undefined : (kartaMi || r.kind === "income" ? ham : -ham);
    await api.realizeRecurring(r.id, curYm, { ...body, amount });
    reload();
  };
  /* Hedefsiz kalemde hesap/kategori sorulur (kalem sayfasının "gerçekleştir" görünümü) */
  const gerceklesti = (r: Recurring) => (durum(r).hasTarget ? realizeRec(r) : setKalem({ id: r.id, gorunum: "gercek" }));
  const realize = (o: OneOff) =>
    onRealize({ name: o.name, amount: Math.abs(o.amount), type: o.amount < 0 ? "gider" : "gelir", oneoffId: o.id });
  const totalDebt = data.loans.reduce((s, l) => s + l.amount * loanRemaining(l, now), 0);
  const oneoffS = useSayfalama(data.oneoffs, 25);
  const bekleyen = data.recurring.filter((r) => durum(r).bekliyor).length;
  const acikKalem = kalem ? data.recurring.find((r) => r.id === kalem.id) ?? null : null;

  return (<div className="plan-izgara">
    <div style={{ ...css.card, padding: "16px 16px 8px", gridArea: "duzenli" }}>
      {kartBaslik("Düzenli gelir ve giderler", bekleyen > 0 ? `bu ay ${bekleyen} bekliyor` : null)}
      {data.recurring.length === 0 && <Empty>Maaş, kira, faturalar… her ay tekrarlayan kalemler. "+ Ekle" ile ekleyebilirsin.</Empty>}
      {data.recurring.map((r, i) => {
        const d = durum(r);
        const isCard = r.card_id != null;
        const targetName = r.account_id != null ? data.accounts.find((a) => a.id === r.account_id)?.name
          : isCard ? data.cards.find((c) => c.id === r.card_id)?.name : null;
        const amtRows = amtIdx.get(r.id);
        const amountNow = recAmountOn(amtRows, curYm) ?? 0;
        const sonraki = (amtRows ?? []).filter((a) => a.from_month > curYm).sort((a, b) => a.from_month.localeCompare(b.from_month))[0];
        const period = r.from_month && r.from_month > curYm ? ` · ${fmtYm(r.from_month)}'dan` : r.to_month && !d.ended ? ` · ${fmtYm(r.to_month)}'a kadar` : "";
        const ac = () => setKalem({ id: r.id, gorunum: "ana" });
        return (
          /* İçinde ikinci bir düğme (bekleyen eylem) olduğundan dış öğe <button> olamaz */
          <div key={r.id} role="button" tabIndex={0} className="liste-satir" onClick={ac} title="Kalemi aç"
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ac(); } }}
            style={{ ...satirStil(i === 0), opacity: d.ended ? 0.5 : 1 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15 }}>{r.name}{d.ended && <span style={{ fontSize: 12.5, color: T.mut }}> · bitti</span>}</div>
              <div style={{ fontSize: 12.5, color: T.mut, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                her ayın {r.day}'i · {targetName ? `${targetName}${isCard ? " (kart)" : ""}` : "hedef yok"}{period}
              </div>
              {/* Planlı tutar değişikliği satırda görünür kalır (eskiden ↗ satırı) */}
              {sonraki && (
                <div style={{ fontSize: 12.5, color: T.acc }}>↗ {fmtYm(sonraki.from_month)}'dan {tl.format(sonraki.amount)}</div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
              <Money v={r.kind === "income" ? amountNow : -amountNow} sign />
              {d.realizedNow
                ? <Rozet renk={T.pos} zemin={T.posSoft}>{ayKisa(curYm)} ✓</Rozet>
                : d.bekliyor
                  ? <button type="button" onClick={(e) => { e.stopPropagation(); gerceklesti(r); }} style={{
                      height: 30, minHeight: 0, padding: "0 12px", border: "none", borderRadius: 9, background: T.acc, color: T.accInk,
                      fontFamily: T.disp, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                    }}>{ayKisa(curYm)} gerçekleşti</button>
                  : r.auto && d.active ? <Rozet renk={T.acc} zemin={T.accSoft}>otomatik</Rozet> : null}
            </div>
          </div>
        );
      })}
    </div>

    <div style={{ ...css.card, padding: "16px 16px 8px", gridArea: "tek" }}>
      {kartBaslik("Tek seferlik")}
      <Aciklama k="tek-seferlik" label="tek seferlik kalem nedir?">
        İleri tarihli planlar; günü gelince <b>gerçekleşti</b> ile deftere geçir — hesap bakiyesine işler, plandan düşer.
      </Aciklama>
      {data.oneoffs.length === 0 && <Empty>Tatil, prim, vergi iadesi gibi ileri tarihli tek seferlik gelir/giderler.</Empty>}
      {/* Tek seferlik kalemler GERÇEKLEŞTİRİLMEDİKÇE listede kalır ve yıllar içinde birikir */}
      {oneoffS.gorunen.map((o, i) => {
        const due = o.date <= today;
        const gun = Math.round((parseD(o.date).getTime() - parseD(today).getTime()) / 86_400_000);
        const ac = () => setEditing({ kind: "oneoff", row: o });
        return (
          <div key={o.id} role="button" tabIndex={0} className="liste-satir" onClick={ac} title="Düzenle"
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ac(); } }} style={satirStil(i === 0)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15 }}>{o.name}</div>
              <div style={{ fontSize: 12.5, color: due ? T.warn : T.mut }}>
                {fmtD(parseD(o.date), { day: "numeric", month: "short", year: "numeric" })}
                {due ? " · günü geldi" : gun <= 60 ? ` · ${gun} gün sonra` : ""}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
              <Money v={o.amount} sign />
              {/* Günü gelen kalemde dolgulu (bekleyen eylem), henüz gelmeyende sessiz bağlantı */}
              <button type="button" onClick={(e) => { e.stopPropagation(); realize(o); }} style={due ? {
                height: 30, minHeight: 0, padding: "0 12px", border: "none", borderRadius: 9, background: T.acc, color: T.accInk,
                fontFamily: T.disp, fontSize: 13, fontWeight: 600, cursor: "pointer",
              } : {
                background: "none", border: "none", padding: 0, minHeight: 0, color: T.acc, fontFamily: T.disp, fontSize: 13, fontWeight: 500, cursor: "pointer",
              }}>gerçekleşti</button>
            </div>
          </div>
        );
      })}
      <DahaFazla s={oneoffS} ad="kalem" yon="fazla" />
    </div>

    <div style={{ ...css.card, padding: "16px 16px 8px", gridArea: "kredi" }}>
      {kartBaslik("Krediler", totalDebt > 0 ? <>kalan <span style={{ ...css.mono, color: T.neg }}>{tl.format(totalDebt)}</span></> : null)}
      <Aciklama k="kredi-taksit" label="kalan taksit nasıl hesaplanıyor?">Kalan taksit tarihten otomatik hesaplanır; biten kredi projeksiyondan kendiliğinden düşer.</Aciklama>
      {data.loans.length === 0 && <Empty>Kredi, taksitli borç veya senet yok.</Empty>}
      {data.loans.map((l, i) => {
        const rem = loanRemaining(l, now);
        const odenen = l.total > 0 ? (l.total - rem) / l.total : 1;
        const ac = () => setEditing({ kind: "loan", row: l });
        return (
          <button key={l.id} type="button" className="liste-satir" onClick={ac} title="Krediyi düzenle"
            style={{ ...satirStil(i === 0), width: "100%", boxSizing: "content-box", textAlign: "left", background: "transparent", border: "none", borderTop: i === 0 ? "none" : `1px solid ${T.line2}`, color: T.text, fontFamily: T.disp, display: "block" }}>
            <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 15, flex: 1, minWidth: 0 }}>{l.name}{rem === 0 && <span style={{ fontSize: 12.5, color: T.pos }}> · bitti</span>}</span>
              <span style={{ ...css.mono, fontSize: 15, color: rem ? T.text : T.mut }}>{tl.format(l.amount)}<span style={{ fontSize: 12, color: T.mut }}>/ay</span></span>
            </span>
            {/* Ödenen taksit oranı: "29/36 kaldı" rakamını bir bakışta okunur yapar */}
            <span style={{ display: "block", height: 6, background: T.line2, borderRadius: 3, margin: "7px 0 5px" }}>
              <span style={{ display: "block", height: 6, width: `${Math.round(odenen * 100)}%`, background: rem ? T.acc : T.pos, borderRadius: 3 }} />
            </span>
            <span style={{ display: "flex", gap: 8, fontSize: 12.5, color: T.mut }}>
              <span style={{ flex: 1 }}>ayın {loanPayDay(l)}'i · {rem} / {l.total} taksit kaldı</span>
              {rem > 0 && <span>kalan <span style={{ ...css.mono, color: T.neg }}>{tl.format(l.amount * rem)}</span></span>}
            </span>
          </button>
        );
      })}
    </div>

    {acikKalem && kalem && (
      <KalemSayfasi data={data} r={acikKalem} gorunum={kalem.gorunum} setGorunum={(g) => setKalem({ id: acikKalem.id, gorunum: g })}
        durum={durum(acikKalem)} curYm={curYm} reload={reload} realizeRec={realizeRec}
        onDuzenle={() => { setKalem(null); setEditing({ kind: "recurring", row: acikKalem }); }}
        onClose={() => setKalem(null)} />
    )}
    {editing && <EditSheet data={data} target={editing} reload={reload} onClose={() => setEditing(null)} />}
  </div>);
}

type KalemGorunum = "ana" | "tutar" | "gercek";

/** Düzenli kalemin sayfası: ana (durum + tutar çizelgesi) | tutar (yeni tutar) | gercek (hedefsiz kalemde hesap/kategori) */
function KalemSayfasi({ data, r, gorunum, setGorunum, durum, curYm, reload, realizeRec, onDuzenle, onClose }: {
  data: AllData; r: Recurring; gorunum: KalemGorunum; setGorunum: (g: KalemGorunum) => void;
  durum: { ended: boolean; active: boolean; realizedNow: boolean; hasTarget: boolean; bekliyor: boolean };
  curYm: string; reload: () => void;
  realizeRec: (r: Recurring, body?: { account_id?: number | null; category_id?: number | null }) => Promise<void>;
  onDuzenle: () => void; onClose: () => void;
}) {
  const amtRows = [...(recurringAmountIndex(data.recurring_amounts ?? []).get(r.id) ?? [])].sort((a, b) => a.from_month.localeCompare(b.from_month));
  const amountNow = recAmountOn(amtRows, curYm) ?? 0;
  const isaret = r.kind === "income" ? "+" : "−";
  const targetName = r.account_id != null ? data.accounts.find((a) => a.id === r.account_id)?.name
    : r.card_id != null ? `${data.cards.find((c) => c.id === r.card_id)?.name ?? "kart"} (kart)` : null;
  const ayAdi = new Date(+curYm.slice(0, 4), +curYm.slice(5) - 1, 1).toLocaleDateString("tr-TR", { month: "long" });

  /* Tutar değiştir: kayıt bölünmez — seçilen aydan itibaren geçerli tutar satırı eklenir (atomik, tek
     istek); önceki aylar eski tutarla kalır, aynı aya ikinci yazım düzeltmedir (Faz 9). */
  const [ch, setCh] = useState({ amount: String(amountNow || ""), from_month: curYm });
  const chOk = num(ch.amount) > 0 && !!ch.from_month;
  const [rp, setRp] = useState({ account_id: "", category_id: "" });

  if (gorunum === "tutar") {
    return (
      <Modal title="Tutarı değiştir" onClose={onClose} onBack={() => setGorunum("ana")}>
        <form onSubmit={async (e) => { e.preventDefault(); if (!chOk) return; await api.setRecurringAmount(r.id, { amount: num(ch.amount), from_month: ch.from_month }); reload(); setGorunum("ana"); }}>
          <Bolum>
            <div style={{ fontSize: 14, color: T.mut, lineHeight: 1.45 }}>
              Yeni tutar seçtiğin aydan itibaren geçerli olur; önceki aylar eski tutarla kalır. Aynı aya ikinci kez yazmak o ayın tutarını düzeltir.
            </div>
            <TutarGirdisi etiket="Yeni tutar" value={ch.amount} onChange={(v) => setCh({ ...ch, amount: v })} renk={r.kind === "income" ? T.pos : T.neg} autoFocus />
            <Satirlar>
              <SatirTarih etiket="Geçerli ay" tur="month" value={ch.from_month} onChange={(v) => setCh({ ...ch, from_month: v })} />
            </Satirlar>
          </Bolum>
          <FormAlt ok={chOk} reason={!(num(ch.amount) > 0) ? "Yeni tutarı yaz." : "Geçerli ayı seç."} editing etiket="Tutarı değiştir"
            sonuc={<>{fmtYm(ch.from_month)}'dan itibaren <Vurgu v={num(ch.amount)} isaret={isaret} />; önceki aylar eski tutarla kalır.</>} />
        </form>
      </Modal>
    );
  }

  if (gorunum === "gercek") {
    return (
      <Modal title={`${ayAdi} ayını deftere geçir`} onClose={onClose} onBack={() => setGorunum("ana")}>
        <form onSubmit={async (e) => { e.preventDefault(); await realizeRec(r, { account_id: rp.account_id ? +rp.account_id : null, category_id: rp.category_id ? +rp.category_id : null }); setGorunum("ana"); }}>
          <Bolum>
            <div style={{ fontSize: 14, color: T.mut, lineHeight: 1.45 }}>
              Bu kalemin hedefi yok. Hesap seçersen bakiyeye işler; boş bırakırsan yalnız gelir/gider kaydı olur.
            </div>
            <Satirlar>
              <SatirSec etiket="Hesap" goruntu={data.accounts.find((a) => String(a.id) === rp.account_id)?.name ?? "bakiyeye işleme"} soluk={!rp.account_id}
                value={rp.account_id} onChange={(v) => setRp({ ...rp, account_id: v })}>
                <option value="">— (bakiyeye işleme)</option>
                {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </SatirSec>
              <KategoriAlani satir data={data} reload={reload} value={rp.category_id} onChange={(v) => setRp({ ...rp, category_id: v })} kind={r.kind} />
            </Satirlar>
          </Bolum>
          <FormAlt ok reason={null} editing etiket="Gerçekleştir"
            sonuc={<><Vurgu v={amountNow} isaret={isaret} /> {rp.account_id ? <><b>{data.accounts.find((a) => String(a.id) === rp.account_id)?.name}</b> bakiyesine işlenir.</> : "yalnız gelir/gider kaydı olarak yazılır."}</>} />
        </form>
      </Modal>
    );
  }

  return (
    <Modal title={r.name} onClose={onClose}>
      <div style={{ display: "grid", gap: 16 }}>
        <div>
          <div style={{ fontSize: 13, color: T.mut }}>
            her ayın {r.day}'i · {targetName ?? "hedef yok"} · {r.kind === "income" ? "gelir" : "gider"}
            {(r.from_month || r.to_month) && <> · {r.from_month ? fmtYm(r.from_month) : "baştan"} – {r.to_month ? fmtYm(r.to_month) : "süresiz"}</>}
          </div>
          <div style={{ ...css.mono, fontSize: 30, fontWeight: 600, color: r.kind === "income" ? T.pos : T.neg }}>{isaret}{tl.format(amountNow)}</div>
          <div style={{ fontSize: 13, color: T.mut }}>bu ayın tutarı{r.auto ? " · kendiliğinden işlenir" : ""}</div>
        </div>

        {durum.realizedNow ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, background: T.posSoft }}>
            <span style={{ flex: 1, fontSize: 14 }}>{ayAdi[0].toLocaleUpperCase("tr") + ayAdi.slice(1)} tutarı deftere geçti ✓</span>
            <button type="button" onClick={async () => { await api.unrealizeRecurring(r.id, curYm); reload(); }}
              style={{ background: "none", border: "none", color: T.acc, fontFamily: T.disp, fontSize: 14, fontWeight: 600, cursor: "pointer", padding: "4px 0", minHeight: 0 }}>Geri al</button>
          </div>
        ) : durum.bekliyor ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, background: T.accSoft }}>
            <span style={{ flex: 1, fontSize: 14 }}>{ayAdi[0].toLocaleUpperCase("tr") + ayAdi.slice(1)} tutarı henüz deftere geçmedi.</span>
            <button type="button" onClick={() => (durum.hasTarget ? realizeRec(r) : setGorunum("gercek"))} style={{
              height: 36, minHeight: 0, padding: "0 14px", border: "none", borderRadius: 10, background: T.acc, color: T.accInk,
              fontFamily: T.disp, fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}>Gerçekleşti</button>
          </div>
        ) : null}

        <div>
          <div style={{ fontSize: 13, color: T.mut, marginBottom: 6 }}>Tutar zaman çizelgesi</div>
          <Satirlar>
            {amtRows.map((a, i) => {
              const ileri = a.from_month > curYm;
              return (
                <div key={a.from_month} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 48, padding: "0 14px", borderTop: i === 0 ? "none" : `1px solid ${T.line2}`, fontSize: 15 }}>
                  <span style={{ flex: 1, color: T.mut }}>{a.from_month === REC_AMOUNT_BEGIN ? "Baştan" : `${fmtYm(a.from_month)}'dan`}</span>
                  <span style={{ ...css.mono, color: ileri ? T.acc : T.text }}>{tl.format(a.amount)}</span>
                  {ileri && (
                    <SilDugmesi className="" ikon="kaldır" title="Planlı tutar değişikliğini kaldır"
                      style={{ fontSize: 13, color: T.mut, padding: "4px 0" }}
                      ad={<>{fmtYm(a.from_month)} tutar değişikliği</>}
                      onSil={async () => { await api.delRecurringAmount(r.id, a.from_month); reload(); }}
                      sonuc={<>Kalem bu aydan itibaren <b>bir önceki tutarla</b> devam eder; kalemin kendisi silinmez.</>} />
                  )}
                </div>
              );
            })}
          </Satirlar>
        </div>

        <button type="button" onClick={() => setGorunum("tutar")} style={{
          height: 46, borderRadius: 12, border: `1px solid ${T.line}`, background: T.panel, color: T.acc,
          fontFamily: T.disp, fontSize: 15, fontWeight: 600, cursor: "pointer",
        }}>Tutarı değiştir…</button>
        <button type="button" onClick={onDuzenle} style={{
          height: 46, borderRadius: 12, border: `1px solid ${T.line}`, background: T.panel, color: T.text,
          fontFamily: T.disp, fontSize: 15, fontWeight: 500, cursor: "pointer",
        }}>Gün, hedef, dönem — düzenle</button>
        <div style={{ fontSize: 12.5, color: T.mut, lineHeight: 1.45 }}>Kalemi silmek düzenleme sayfasında: tutar geçmişi de silinir, daha önce deftere geçirdiğin gerçekleşmeler kalır.</div>
      </div>
    </Modal>
  );
}
