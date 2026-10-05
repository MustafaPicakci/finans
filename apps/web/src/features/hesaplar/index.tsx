import React, { useState } from "react";
import {
  fmtD, num, todayStr, parseD,
  depositMaturity, depositValueOn, depositMaturityValue, depositNetInterest, depositAccruedInterest, depositDaysRemaining, depositMatured,
  accountLedger, accountBalance, balancesByAccount, totalCash, ledgerSummary,
  reconcileDiff, reconStatus, entriesSinceRecon, accountKindOf, ACCOUNT_KIND_LABEL,
  type Account, type AccountEntry, type AccountKind, type AllData,
} from "@finans/engine";
import { api } from "../../api";
import { T, css, tl, fmtMoney } from "../../theme";
import { Empty, Aciklama, Modal, SilDugmesi, useSayfalama, DahaFazla } from "../../ui";
import { girdi, Bolum, Etiketli, Segment, TutarGirdisi, Satirlar, SatirMetin, FormAlt, Vurgu } from "../forms/parcalar";
import { EditSheet, type EditTarget } from "../../EditSheet";

/* ————— HESAPLAR EKRANI —————
   Banka varlıklarının tek yönetim yeri: vadesiz (nakit) hesaplar + vadeli mevduat. Buradaki "hesap"
   HER ZAMAN banka/nakit/aracı kurum hesabıdır; KULLANICI hesabı (veri indirme, hesap silme)
   features/profil'dedir — ikisi aynı ekranda dururken "Hesabı sil" bir banka hesabını siliyormuş gibi okunuyordu.

   Yeniden tasarım (Ekim 2026, grup 3): her hesap satırında tür seçici + Doğrula + Hareketler + ✕ vardı
   (dört hesapta 16 kontrol) ve hesap adı görünmez bir giriş kutusuydu. Artık satır yalnız bilgi taşır
   (tür simgesi, ad, tür · doğrulama durumu, bakiye) ve DOKUNMA HEDEFİDİR: hesap sayfası açılır —
   bakiye, "Bakiyeyi doğrula", "Düzenle" (ad, tür, sil) ve hareketler orada. "Hesap ekle" formu sayfada hep
   açık durmuyor, "+ Hesap" ile açılıyor. Virman ve mevduat satırlarına dokunmak düzenleme sayfasını açar
   (silme oradadır — Faz 24 kural 1'in güncellemesi: satırda ✎ ✕ yok). */

const KIND_COLOR: Record<AccountKind, string> = {
  banka: "var(--type-nakit)", nakit: "var(--cat-3)", araci: "var(--pos)", fon: "var(--type-doviz)",
};
const KIND_HINT: Record<AccountKind, string> = {
  banka: "örn. Vakıfbank", nakit: "örn. Cüzdan", araci: "örn. Midas", fon: "örn. Para piyasası",
};
/** Tür simgesi (SVG — tipografik ◈✱▲◆ Android'de tofu riski taşıyor) */
const KindIcon = ({ kind }: { kind: AccountKind }) => (
  <svg width="18" height="18" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    {kind === "banka" && <><path d="M2 6l6.5-3.5L15 6" /><path d="M3.5 6.5v6M13.5 6.5v6M6.8 6.5v6M10.2 6.5v6M2 14.5h13" /></>}
    {kind === "nakit" && <><rect x="1.5" y="4" width="14" height="9.5" rx="2" /><circle cx="8.5" cy="8.75" r="2" /></>}
    {kind === "araci" && <><path d="M2 11.5l3.5-4 3 2.5L14 4" /><path d="M10.5 4H14v3.5" /></>}
    {kind === "fon" && <><circle cx="8.5" cy="8.5" r="6.5" /><path d="M8.5 5v7M6 7h4" /></>}
  </svg>
);
const satir: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 58, padding: "0 16px", background: "none", border: "none",
  borderTop: `1px solid ${T.line2}`, textAlign: "left", cursor: "pointer", fontFamily: T.disp, color: T.text, fontSize: 14.5,
};
const Ok = () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={T.mut3} strokeWidth="1.6" strokeLinecap="round" style={{ flexShrink: 0 }}><path d="M4.5 3l3 3-3 3" /></svg>;
const Tarih = ({ d }: { d: string }) => (
  <span style={{ width: 32, textAlign: "center", lineHeight: 1.05, flexShrink: 0 }}>
    <span style={{ display: "block", ...css.mono, fontSize: 15, fontWeight: 600 }}>{fmtD(parseD(d), { day: "2-digit" })}</span>
    <span style={{ display: "block", fontSize: 11, color: T.mut }}>{fmtD(parseD(d), { month: "short" })}</span>
  </span>
);
/** Doğrulama durumu metni — bayat/hiç sarı (bitmemiş iş görünür ama bağırmaz) */
const durumMetni = (a: Account, today: string) => {
  const st = reconStatus(a, today);
  return {
    st,
    metin: st === "hic" ? "henüz doğrulanmadı"
      : st === "bayat" ? `son doğrulama ${fmtD(parseD(a.last_recon_date!), { day: "numeric", month: "short" })} — bayat`
        : `${fmtD(parseD(a.last_recon_date!), { day: "numeric", month: "short" })} doğrulandı ✓`,
  };
};

export function Hesaplar({ data, reload }: { data: AllData; reload: () => void }) {
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [acik, setAcik] = useState<number | "yeni" | null>(null); // hesap sayfası
  const today = new Date(); today.setHours(0, 0, 0, 0);
  /* Bakiye kolonda değil defterde (E2EE aşama 1a); tek geçişte hepsi */
  const bakiyeler = balancesByAccount(data.account_entries);
  const bakiye = (id: number) => bakiyeler.get(id) ?? 0;
  const cash = totalCash(data.account_entries);
  const depositsValue = data.deposits.reduce((s, d) => s + depositValueOn(d, today), 0);
  const total = cash + depositsValue;
  const bugun = todayStr();
  const nakitPay = total > 0 ? Math.max(0, cash) / (Math.max(0, cash) + depositsValue || 1) : 1;
  const acikHesap = typeof acik === "number" ? data.accounts.find((a) => a.id === acik) ?? null : null;

  return (<>
    <div className="hesap-ust">
      <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
        <div style={{ ...css.card, padding: 18 }}>
          <div style={{ fontSize: 13, color: T.mut }}>Toplam banka varlığı</div>
          <div style={{ ...css.mono, fontSize: 28, fontWeight: 600 }}>{tl.format(Math.round(total))}</div>
          {depositsValue > 0 && (
            <div style={{ display: "flex", height: 8, gap: 2, margin: "10px 0 8px", borderRadius: 3, overflow: "hidden" }}>
              <span style={{ width: `${nakitPay * 100}%`, background: "var(--type-nakit)" }} />
              <span style={{ flex: 1, background: "var(--cat-5)" }} />
            </div>
          )}
          <div style={{ display: "flex", gap: 16, fontSize: 13, color: T.mut, marginTop: depositsValue > 0 ? 0 : 6 }}>
            <span>nakit <b style={{ ...css.mono, color: T.text, fontWeight: 500 }}>{tl.format(Math.round(cash))}</b></span>
            {depositsValue > 0 && <span>vadeli <b style={{ ...css.mono, color: T.text, fontWeight: 500 }}>{tl.format(Math.round(depositsValue))}</b></span>}
          </div>
        </div>

        <div style={{ ...css.card, padding: "14px 0 0", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "0 16px 8px" }}>
            <span style={{ fontWeight: 700, fontSize: 16, flex: 1 }}>Hesaplar</span>
            <button onClick={() => setAcik("yeni")} style={{ background: "none", border: "none", color: T.acc, fontFamily: T.disp, fontSize: 14, fontWeight: 600, cursor: "pointer", padding: "6px 0" }}>+ Hesap</button>
          </div>
          <div style={{ padding: "0 16px" }}>
            <Aciklama k="hesap-turleri" label="hangi hesapları tanımlamalıyım?">
              Banka, nakit cüzdan, aracı kurum… Nakit ve aracı kurumu da hesap olarak tanımla; ATM çekimi ya da
              Midas'a aktarım böylece “kaybolan para” olmaz, <b>virman</b> ile yer değiştirir.
              <b> Bakiyeyi doğrula</b> ile gerçek bakiyeyi girip defteri dış dünyaya sabitlersin.
            </Aciklama>
          </div>
          {data.accounts.length === 0 && <div style={{ padding: "0 16px 12px" }}><Empty>Henüz hesap yok.</Empty></div>}
          {data.accounts.map((a) => {
            const kind = accountKindOf(a);
            const d = durumMetni(a, bugun);
            return (
              <button key={a.id} className="liste-satir" style={satir} onClick={() => setAcik(a.id)}>
                <span style={{ width: 34, height: 34, borderRadius: 10, background: T.panel2, display: "grid", placeItems: "center", color: KIND_COLOR[kind], flexShrink: 0 }}>
                  <KindIcon kind={kind} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                  <span style={{ display: "block", fontSize: 12.5, color: d.st === "guncel" ? T.mut : T.warn }}>{ACCOUNT_KIND_LABEL[kind]} · {d.metin}</span>
                </span>
                <span style={{ ...css.mono, fontWeight: 500, color: bakiye(a.id) < 0 ? T.neg : T.text }}>{tl.format(Math.round(bakiye(a.id)))}</span>
                <Ok />
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
        <Transferler data={data} onEdit={setEditing} />
        <VadeliMevduat data={data} reload={reload} onEdit={setEditing} />
      </div>
    </div>

    {acik === "yeni" && <HesapEkle reload={reload} onClose={() => setAcik(null)} />}
    {acikHesap && <HesapSayfasi data={data} hesap={acikHesap} reload={reload} onClose={() => setAcik(null)} />}
    {editing && <EditSheet data={data} target={editing} reload={reload} onClose={() => setEditing(null)} />}
  </>);
}

/* ————— TRANSFERLER (Faz 16) —————
   Virmanlar gelir/gider defterine girmez (gelir/gider değiller), bu yüzden listelenecekleri yer burasıdır:
   hesapların yanı. Satıra dokunmak düzenleme sayfasını açar; silme oradadır ve iki bacağı birden geri alır. */
function Transferler({ data, onEdit }: { data: AllData; onEdit: (t: EditTarget) => void }) {
  const s2 = useSayfalama(data.transfers, 12);
  const name = (id: number) => data.accounts.find((a) => a.id === id)?.name ?? "(silinmiş hesap)";
  return (
    <div style={{ ...css.card, padding: "14px 0 0", overflow: "hidden" }}>
      <div style={{ fontWeight: 700, fontSize: 16, padding: "0 16px 4px" }}>Virmanlar</div>
      <div style={{ padding: "0 16px" }}>
        <Aciklama k="transfer-nedir" label="virman mı, gider mi?">
          Kendi hesapların arasındaki para hareketleri. Net varlığını ve gelir/gider defterini değiştirmez — yalnız paranın
          nerede durduğunu değiştirir. <b>“+ Ekle → Virman”</b> ile eklenir.
          Başkasına gönderdiğin para virman değil <b>giderdir</b>.
        </Aciklama>
      </div>
      {data.transfers.length === 0 && <div style={{ padding: "0 16px 12px" }}><Empty>Henüz virman yok.</Empty></div>}
      {s2.gorunen.map((t) => (
        <button key={t.id} className="liste-satir" style={satir} onClick={() => onEdit({ kind: "transfer", row: t })}>
          <Tarih d={t.date} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name(t.from_account_id)} → {name(t.to_account_id)}</span>
            {t.note && <span style={{ display: "block", fontSize: 12.5, color: T.mut }}>{t.note}</span>}
          </span>
          <span style={{ ...css.mono, flexShrink: 0 }}>{tl.format(Math.round(t.amount))}</span>
        </button>
      ))}
      <div style={{ padding: "0 16px" }}><DahaFazla s={s2} ad="virman" /></div>
    </div>
  );
}

/** Yeni hesap: tür + ad + açılış bakiyesi (0 ya da eksi olabilir: boş cüzdan, KMH) */
function HesapEkle({ reload, onClose }: { reload: () => void; onClose: () => void }) {
  const [f, setF] = useState({ name: "", balance: "", kind: "banka" as AccountKind });
  const ok = !!f.name.trim() && (f.balance.trim() === "" || /^-?\s*[\d.,]+$/.test(f.balance.trim()));
  const kaydet = async () => {
    if (!ok) return;
    await api.post("accounts", { name: f.name.trim(), balance: num(f.balance), kind: f.kind });
    reload(); onClose();
  };
  return (
    <Modal title="Hesap ekle" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); kaydet(); }}>
        <Bolum>
          <Segment ad="Tür" deger={f.kind} sec={(k) => setF({ ...f, kind: k })}
            secenek={(Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[]).map((k) => ({ v: k, l: ACCOUNT_KIND_LABEL[k] }))} />
          <Etiketli etiket="Hesap adı">
            <input autoFocus style={girdi} value={f.name} placeholder={KIND_HINT[f.kind]} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Etiketli>
          <TutarGirdisi serbest etiket="Bugünkü bakiye" value={f.balance} onChange={(v) => setF({ ...f, balance: v })} />
        </Bolum>
        <FormAlt ok={ok} reason={!f.name.trim() ? "Hesabın adını yaz." : "Bakiye geçersiz."} editing etiket="Hesabı ekle"
          sonuc={<>Açılış bakiyesi <Vurgu v={num(f.balance)} /> olarak deftere yazılır; bundan sonra bakiye hareketlerden türer.</>} />
      </form>
    </Modal>
  );
}

/* ————— HESAP SAYFASI —————
   Satıra dokununca açılır. Üç görünüm, tek sayfa: ana (bakiye + hareketler), doğrula (mutabakat),
   düzenle (ad, tür, sil). Alt görünümlerden sol üstteki geri ile ana görünüme dönülür. */
function HesapSayfasi({ data, hesap, reload, onClose }: { data: AllData; hesap: Account; reload: () => void; onClose: () => void }) {
  const [gorunum, setGorunum] = useState<"ana" | "dogrula" | "duzenle">("ana");
  const kind = accountKindOf(hesap);
  const d = durumMetni(hesap, todayStr());
  const bakiye = accountBalance(data.account_entries, hesap.id);
  const geri = gorunum === "ana" ? undefined : () => setGorunum("ana");
  return (
    <Modal title={gorunum === "dogrula" ? "Bakiyeyi doğrula" : gorunum === "duzenle" ? "Hesabı düzenle" : hesap.name} onClose={onClose} onBack={geri}>
      {gorunum === "ana" && (
        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <div style={{ fontSize: 13, color: d.st === "guncel" ? T.mut : T.warn }}>{ACCOUNT_KIND_LABEL[kind]} · {d.metin}</div>
            <div style={{ ...css.mono, fontSize: 32, fontWeight: 600, color: bakiye < 0 ? T.neg : T.text }}>{fmtMoney(bakiye, "TRY", true)}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setGorunum("dogrula")} title="Gerçek bakiyeyi gir; fark deftere 'düzeltme' hareketi olarak yazılır" style={{
              flex: 1, height: 42, borderRadius: 11, fontFamily: T.disp, fontSize: 14, fontWeight: 600, cursor: "pointer",
              ...(d.st === "guncel"
                ? { border: `1px solid ${T.line}`, background: T.panel, color: T.text }
                : { border: `1px solid ${T.warn}`, background: T.warnSoft, color: T.warn }),
            }}>Bakiyeyi doğrula</button>
            <button onClick={() => setGorunum("duzenle")} style={{
              height: 42, padding: "0 16px", borderRadius: 11, border: `1px solid ${T.line}`, background: T.panel,
              fontFamily: T.disp, fontSize: 14, color: T.text, cursor: "pointer",
            }}>Düzenle</button>
          </div>
          <HesapHareketleri data={data} account={hesap} />
        </div>
      )}
      {gorunum === "dogrula" && <Mutabakat data={data} account={hesap} reload={reload} onDone={() => setGorunum("ana")} />}
      {gorunum === "duzenle" && <HesapDuzenle hesap={hesap} bakiye={bakiye} reload={reload} onDone={() => setGorunum("ana")} onSilindi={onClose} />}
    </Modal>
  );
}

/** Ad + tür (Faz 18: sil+yeniden ekle hesabın TÜM hareketlerini CASCADE ile götürürdü). Sil burada. */
function HesapDuzenle({ hesap, bakiye, reload, onDone, onSilindi }: { hesap: Account; bakiye: number; reload: () => void; onDone: () => void; onSilindi: () => void }) {
  const [f, setF] = useState({ name: hesap.name, kind: accountKindOf(hesap) });
  const ok = !!f.name.trim();
  const kaydet = async () => {
    if (!ok) return;
    await api.put(`accounts/${hesap.id}`, { name: f.name.trim(), kind: f.kind });
    reload(); onDone();
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); kaydet(); }}>
      <Bolum>
        <Segment ad="Tür" deger={f.kind} sec={(k) => setF({ ...f, kind: k })}
          secenek={(Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[]).map((k) => ({ v: k, l: ACCOUNT_KIND_LABEL[k] }))} />
        <Etiketli etiket="Hesap adı">
          <input style={girdi} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Etiketli>
        <div style={{ fontSize: 13, color: T.mut, lineHeight: 1.45 }}>Tür yalnız gruplama ve simge içindir; bakiye ve defter kuralları değişmez.</div>
      </Bolum>
      <FormAlt ok={ok} reason="Hesabın adını yaz." editing etiket="Değişikliği kaydet" sonuc="Ad ve tür güncellenir; hareketlere dokunulmaz."
        sil={
          /* Uygulamanın en yıkıcı silmesi: hesabın TÜM hareket defteri CASCADE ile gider */
          <SilDugmesi ad={hesap.name} title="Hesabı sil" ikon="Sil" className="form-sil"
            style={{ color: T.neg, fontSize: 14.5, fontWeight: 600, padding: "8px 6px" }}
            onSil={async () => { await api.del("accounts", hesap.id); reload(); onSilindi(); }}
            sonuc={<>Bu hesabın <b>tüm hareket geçmişi</b> silinir ve {tl.format(Math.round(bakiye))} bakiye net varlığından düşer. Hesaba bağlı işlemler kayıtsız kalır.</>} />
        } />
    </form>
  );
}

/* ————— MUTABAKAT (Faz 16) —————
   "Bakiyem tutmuyor" sorusunu kapatan akış: kullanıcı bankadaki GERÇEK bakiyeyi girer, fark
   hesaplanır ve onaylanırsa 'duzeltme' hareketi olarak deftere YAZILIR (gizlenmez). Fark 0 ise
   hareket yazılmaz, yalnız damga atılır — "doğruladım, tutuyor" bilgisi de değerlidir.
   Fark varken son doğrulamadan bu yanaki hareketler gösterilir: unutulan kaydı burada yakalarsın. */
function Mutabakat({ data, account, reload, onDone }: {
  data: AllData; account: Account; reload: () => void; onDone: () => void;
}) {
  const [real, setReal] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  /* 0 ve eksi geçerli olduğundan `num`'ın "çözemedim → 0" davranışına güvenilemez:
     "abc" yazılıp onaylanırsa bakiye sessizce 0'a çekilirdi. Girdi sayısal görünmeli. */
  const entered = /^-?\s*[\d.,]+$/.test(real.trim());
  /* Kayıtlı bakiye defterden türetilir; fark tarayıcıda hesaplanıp delta ile gönderilir (E2EE aşama 1a). */
  const mevcut = accountBalance(data.account_entries, account.id);
  const diff = entered ? reconcileDiff(mevcut, num(real)) : 0;
  /* Sayım tam liste üzerinden, gösterim sayfalı (eskiden `slice(0, 8)` + yanlış sayı). */
  const since = entriesSinceRecon(data.account_entries, account);
  const sinceS = useSayfalama(since, 8);
  const save = async () => {
    if (!entered || busy) return;
    setBusy(true);
    await api.post(`accounts/${account.id}/reconcile`, { balance: num(real), diff, date: todayStr(), note: note.trim() || null });
    reload(); onDone();
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }}>
      <Bolum>
        <div style={{ fontSize: 14, color: T.mut, lineHeight: 1.45 }}>
          <b style={{ color: T.text }}>{account.name}</b> hesabında <b style={{ color: T.text }}>şu an gerçekte</b> ne kadar var?
          Uygulamadaki: <span style={{ ...css.mono, color: T.text }}>{fmtMoney(mevcut, "TRY", true)}</span>
        </div>
        {/* serbest: gerçek bakiye 0 olabilir (boşalmış nakit cüzdanı) ve eksi olabilir (KMH) */}
        <TutarGirdisi serbest autoFocus etiket="Gerçek bakiye" value={real} onChange={setReal} />
        <Satirlar>
          <SatirMetin etiket="Not" placeholder="isteğe bağlı" value={note} onChange={setNote} />
        </Satirlar>
        {entered && diff !== 0 && since.length > 0 && (
          <div>
            <div style={{ fontSize: 12.5, color: T.mut, marginBottom: 4 }}>Son doğrulamadan bu yana {since.length} hareket — eksik kayıt bunların arasında olabilir:</div>
            {sinceS.gorunen.map((e) => (
              <div key={e.id} style={{ display: "flex", gap: 10, fontSize: 13.5, padding: "7px 0", borderTop: `1px solid ${T.line2}` }}>
                <span style={{ ...css.mono, color: T.mut, fontSize: 12.5, width: 50, flexShrink: 0 }}>{fmtD(parseD(e.date), { day: "numeric", month: "short" })}</span>
                <span style={{ flex: 1, minWidth: 0 }}>{e.note}</span>
                <span style={{ ...css.mono, color: e.amount < 0 ? T.neg : T.pos }}>{e.amount > 0 ? "+" : ""}{tl.format(Math.round(e.amount))}</span>
              </div>
            ))}
            <DahaFazla s={sinceS} ad="hareket" />
          </div>
        )}
      </Bolum>
      <FormAlt ok={entered && !busy} reason={busy ? "Kaydediliyor…" : "Bankanın gösterdiği bakiyeyi gir (0 ya da eksi olabilir)."} editing
        etiket={diff === 0 ? "Doğrula" : "Doğrula ve farkı yaz"}
        sonuc={diff === 0
          ? <span style={{ color: T.pos }}>✓ Fark yok — defterin tutuyor. Onaylayınca yalnız doğrulama tarihi güncellenir.</span>
          : <>Fark <b style={{ ...css.mono, color: T.warn }}>{diff > 0 ? "+" : ""}{fmtMoney(diff, "TRY", true)}</b>: {diff > 0 ? "deftere girmemiş bir gelir/virman var" : "deftere girmemiş bir harcama var"}. Onaylarsan <b>düzeltme hareketi</b> olarak deftere yazılır.</>} />
    </form>
  );
}

/* ————— HESAP HAREKETLERİ (Faz 15) —————
   Hesabın bakiyesini açıklayan defter: her satır bir hareket + o hareketten sonraki bakiye.
   Hareketler bakiyeyi oynatan akışlarda yazılır, burada yalnız gösterilir — bu yüzden
   silme/düzenleme yok: hareket kaynağından (işlem, portföy işlemi, mevduat) düzenlenir. */
const KIND_LABEL: Record<AccountEntry["kind"], string> = {
  islem: "işlem", portfoy: "portföy", mevduat: "vadeli", duzeltme: "düzeltme", acilis: "açılış", virman: "virman",
};
function HesapHareketleri({ data, account }: { data: AllData; account: Account }) {
  const rows = accountLedger(data.account_entries, account.id);
  const s3 = useSayfalama(rows, 20);
  const sum = ledgerSummary(rows);
  return (
    <div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, color: T.mut, marginBottom: 4 }}>
        <span>Hareketler · {rows.length}</span>
        <span>giren <b style={{ ...css.mono, color: T.pos, fontWeight: 500 }}>{tl.format(Math.round(sum.in))}</b></span>
        <span>çıkan <b style={{ ...css.mono, color: T.neg, fontWeight: 500 }}>{tl.format(Math.round(sum.out))}</b></span>
      </div>
      {rows.length === 0 && <Empty>Bu hesapta hareket yok.</Empty>}
      {s3.gorunen.map((r) => (
        <div key={r.entry.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${T.line2}` }}>
          <span style={{ ...css.mono, fontSize: 12.5, color: T.mut, width: 50, flexShrink: 0 }}>{fmtD(parseD(r.entry.date), { day: "numeric", month: "short" })}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.entry.note}</span>
            <span style={{ display: "block", fontSize: 12, color: T.mut }}>{KIND_LABEL[r.entry.kind]}</span>
          </span>
          <span style={{ textAlign: "right", flexShrink: 0 }}>
            <span style={{ display: "block", ...css.mono, fontSize: 14, color: r.entry.amount < 0 ? T.neg : T.pos }}>{r.entry.amount > 0 ? "+" : ""}{tl.format(Math.round(r.entry.amount))}</span>
            <span style={{ display: "block", ...css.mono, fontSize: 11.5, color: T.mut }} title="bu hareketten sonraki bakiye">{tl.format(Math.round(r.balanceAfter))}</span>
          </span>
        </div>
      ))}
      <DahaFazla s={s3} ad="hareket" />
    </div>
  );
}

/* ————— VADELİ MEVDUAT — liste + vade kapatma —————
   Ekleme global "+ Ekle"den; satıra dokunmak düzenleme sayfasını açar (silme orada). Vade dolunca
   "Hesaba geçir" satırda kalır — gerçekten bekleyen tek eylem. Değer net varlığa engine'de işler. */
function VadeliMevduat({ data, reload, onEdit }: { data: AllData; reload: () => void; onEdit: (t: EditTarget) => void }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  /* vade kapatma: bağlı hesaba net faizi gelir olarak işle, sonra mevduatı sil (anapara iadesi) → hesap += vade değeri */
  const close = async (d: AllData["deposits"][number]) => {
    if (d.account_id) {
      const net = depositNetInterest(d);
      if (net !== 0) await api.post("transactions", { name: `${d.name} — vade faizi`, date: todayStr(), amount: net, account_id: d.account_id, category_id: null });
    }
    await api.del("deposits", d.id);
    reload();
  };
  const mevduatS = useSayfalama(data.deposits, 20);
  return (
    <div style={{ ...css.card, padding: "14px 0 0", overflow: "hidden" }}>
      <div style={{ fontWeight: 700, fontSize: 16, padding: "0 16px 4px" }}>Vadeli mevduat</div>
      <div style={{ padding: "0 16px" }}>
        <Aciklama k="vadeli-mevduat" label="vadeli mevduat nasıl işler?">Anapara + faiz vade sonuna kadar net varlığa işleyerek girer; para vade sonuna dek kilitli sayılır (harcanabilir nakde girmez). "+ Ekle" → Vadeli mevduat ile açabilirsin.</Aciklama>
      </div>
      {data.deposits.length === 0 && <div style={{ padding: "0 16px 12px" }}><Empty>Vadeli mevduatın yok.</Empty></div>}
      {mevduatS.gorunen.map((d) => {
        const mat = depositMaturity(d);
        const matured = depositMatured(d, today);
        const daysLeft = depositDaysRemaining(d, today);
        const acc = d.account_id ? data.accounts.find((a) => a.id === d.account_id) : null;
        return (
          <div key={d.id} style={{ display: "flex", alignItems: "center", borderTop: `1px solid ${T.line2}` }}>
            <button className="liste-satir" style={{ ...satir, borderTop: "none", flex: 1, minHeight: 64 }} onClick={() => onEdit({ kind: "deposit", row: d })}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block" }}>{d.name} <span style={{ fontSize: 12.5, color: matured ? T.pos : T.mut }}>· {matured ? "vadesi doldu" : `${daysLeft} gün kaldı`}</span></span>
                <span style={{ display: "block", fontSize: 12.5, color: T.mut }}>
                  {tl.format(Math.round(d.principal))} · %{d.rate} · vade {fmtD(mat, { day: "numeric", month: "short", year: "numeric" })}{acc ? ` · ${acc.name}` : ""}
                </span>
                <span style={{ display: "block", fontSize: 12.5, color: T.mut }}>vade değeri {tl.format(Math.round(depositMaturityValue(d)))}</span>
              </span>
              <span style={{ textAlign: "right", flexShrink: 0 }}>
                <span style={{ display: "block", ...css.mono }}>{tl.format(Math.round(depositValueOn(d, today)))}</span>
                <span style={{ display: "block", ...css.mono, fontSize: 12, color: T.pos }}>+{tl.format(Math.round(depositAccruedInterest(d, today)))} faiz</span>
              </span>
            </button>
            {matured && d.account_id != null && (
              <button title="Net faizi hesaba gelir olarak işle, anaparayı iade et ve mevduatı kapat" onClick={() => close(d)} style={{
                height: 36, minHeight: 0, padding: "0 12px", marginRight: 12, borderRadius: 10, border: "none", background: T.acc, color: T.accInk,
                fontFamily: T.disp, fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0,
              }}>Hesaba geçir</button>
            )}
          </div>
        );
      })}
      <div style={{ padding: "0 16px" }}><DahaFazla s={mevduatS} ad="mevduat" yon="fazla" /></div>
    </div>
  );
}
