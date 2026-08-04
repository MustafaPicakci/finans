import React, { useRef, useState } from "react";
import {
  fmtD, num, todayStr,
  depositMaturity, depositValueOn, depositMaturityValue, depositNetInterest, depositAccruedInterest, depositDaysRemaining, depositMatured,
  accountLedger, ledgerDrift, ledgerSummary,
  reconcileDiff, reconStatus, entriesSinceRecon, accountKindOf, ACCOUNT_KIND_LABEL,
  type Account, type AccountEntry, type AccountKind, type AllData,
} from "@finans/engine";
import { api } from "../../api";
import { T, css, tl } from "../../theme";
import { Field, AmountField, Empty, Row } from "../../ui";
import { EditSheet, type EditTarget } from "../../EditSheet";

/* ————— HESAPLAR EKRANI —————
   Banka varlıklarının tek yönetim yeri: vadesiz (nakit) hesaplar + vadeli mevduat.
   Kavramsal olarak ikisi de "hesap"tır; ayrı bölümlerde durur çünkü vadeli mevduatın
   vade/faiz/stopaj mekaniği farklıdır. En altta hesap & veri (KVKK) ayarları. */
export function Hesaplar({ data, reload, user, onAccountDeleted }: {
  data: AllData; reload: () => void; user: { email: string }; onAccountDeleted: () => void;
}) {
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cash = data.accounts.reduce((s, a) => s + a.balance, 0);
  const depositsValue = data.deposits.reduce((s, d) => s + depositValueOn(d, today), 0);
  const total = cash + depositsValue;

  return (<>
    <div style={css.card}>
      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: T.mut }}>Toplam Banka Varlığı</div>
      <div style={{ ...css.mono, fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 4 }}>{tl.format(Math.round(total))}</div>
      <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: T.mut }}>
          <span style={{ width: 8, height: 8, borderRadius: 3, background: "var(--type-nakit)", display: "inline-block", marginRight: 6 }} />
          nakit <span style={{ ...css.mono, color: T.text }}>{tl.format(Math.round(cash))}</span>
        </span>
        {depositsValue > 0 && (
          <span style={{ fontSize: 13, color: T.mut }}>
            <span style={{ width: 8, height: 8, borderRadius: 3, background: "var(--cat-5)", display: "inline-block", marginRight: 6 }} />
            vadeli <span style={{ ...css.mono, color: T.text }}>{tl.format(Math.round(depositsValue))}</span>
          </span>
        )}
      </div>
    </div>

    <VadesizHesaplar data={data} reload={reload} />
    <Transferler data={data} reload={reload} onEdit={setEditing} />
    <VadeliMevduat data={data} reload={reload} onEdit={setEditing} />
    <HesapKvkk user={user} onDeleted={onAccountDeleted} />
    {editing && <EditSheet data={data} target={editing} reload={reload} onClose={() => setEditing(null)} />}
  </>);
}

/* ————— TRANSFERLER (Faz 16) —————
   Virmanlar Rapor'a girmez (gelir/gider değiller), bu yüzden listelenecekleri yer burasıdır:
   hesapların yanı. Silme iki bacağı birden geri alır — yarım kalan virman mümkün değil. */
function Transferler({ data, reload, onEdit }: {
  data: AllData; reload: () => void; onEdit: (t: EditTarget) => void;
}) {
  const [limit, setLimit] = useState(8);
  const name = (id: number) => data.accounts.find((a) => a.id === id)?.name ?? "(silinmiş hesap)";
  const shown = data.transfers.slice(0, limit);
  return (
    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Transferler (Virman)</div>
      <div style={{ fontSize: 12, color: T.mut, marginBottom: 8 }}>
        Kendi hesapların arasındaki para hareketleri. Net varlığını ve Rapor'u değiştirmez — yalnız paranın
        nerede durduğunu değiştirir. <b>“+ Ekle → Transfer”</b> ile eklenir.
        Başkasına gönderdiğin para transfer değil <b>giderdir</b> (Gelir/Gider kalemi olarak gir).
      </div>
      {data.transfers.length === 0 && <Empty>Henüz transfer yok.</Empty>}
      {shown.map((t, i) => (
        <Row key={t.id} last={i === shown.length - 1 && data.transfers.length <= limit}>
          <span style={{ ...css.mono, fontSize: 11.5, color: T.mut, width: 74 }}>
            {fmtD(new Date(t.date + "T00:00:00"), { day: "2-digit", month: "short", year: "2-digit" })}
          </span>
          <div style={{ flex: 1, fontSize: 13.5 }}>
            {name(t.from_account_id)} <span style={{ color: T.mut3 }}>→</span> {name(t.to_account_id)}
            {t.note && <span style={{ fontSize: 11.5, color: T.mut3, marginLeft: 6 }}>{t.note}</span>}
          </div>
          <span style={{ ...css.mono, fontSize: 13.5 }}>{tl.format(Math.round(t.amount))}</span>
          <button style={{ ...css.ghost, padding: "5px 10px", fontSize: 12 }}
            onClick={() => onEdit({ kind: "transfer", row: t })}>Düzenle</button>
          <button style={css.del} title="Sil (iki bacağı birden geri alır)"
            onClick={async () => { await api.del("transfers", t.id); reload(); }}>✕</button>
        </Row>
      ))}
      {data.transfers.length > shown.length && (
        <button style={{ ...css.ghost, marginTop: 10, padding: "5px 10px", fontSize: 12 }} onClick={() => setLimit((l) => l + 25)}>
          Daha eski transferler ({data.transfers.length - shown.length})
        </button>
      )}
    </div>
  );
}

/* ————— VADESİZ (nakit) hesaplar — tanım + mutabakat ————— */
/* Hesap türü (Faz 16): nakit cüzdanı ve aracı kurum da BİRER HESAPtır. ATM'den çekilen ya da
   Midas'a atılan para böylece sistemden çıkmaz — "+ Ekle → Transfer" ile yer değiştirir.
   Tür yalnız gruplama/ikon içindir; dördü de aynı defter kurallarına tabidir. */
const KIND_ICON: Record<AccountKind, string> = { banka: "◈", nakit: "✱", araci: "▲", fon: "◆" };
const KIND_COLOR: Record<AccountKind, string> = {
  banka: "var(--type-nakit)", nakit: "var(--cat-3)", araci: "var(--pos)", fon: "var(--type-doviz)",
};
const KIND_HINT: Record<AccountKind, string> = {
  banka: "örn. Vakıfbank", nakit: "örn. Cüzdan", araci: "örn. Midas", fon: "örn. Para piyasası",
};

function VadesizHesaplar({ data, reload }: { data: AllData; reload: () => void }) {
  const [acc, setAcc] = useState({ name: "", balance: "", kind: "banka" as AccountKind });
  const [shown, setShown] = useState<number | null>(null); // hareketleri açık hesap
  const [recon, setRecon] = useState<number | null>(null); // mutabakat paneli açık hesap
  const nameRef = useRef<HTMLInputElement>(null);
  const today = todayStr();
  return (
    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Hesaplar (Nakit)</div>
      <div style={{ fontSize: 12, color: T.mut, marginBottom: 8 }}>
        Banka, nakit cüzdan, aracı kurum… Nakit ve aracı kurumu da hesap olarak tanımla; ATM çekimi ya da
        Midas'a aktarım böylece “kaybolan para” olmaz, <b>“+ Ekle → Transfer”</b> ile yer değiştirir.
        <b> Doğrula</b> ile gerçek bakiyeyi girip defteri dış dünyaya sabitlersin.
      </div>
      {data.accounts.length === 0 && <Empty>Henüz hesap yok.</Empty>}
      {data.accounts.map((a, i) => {
        const open = shown === a.id, reconOpen = recon === a.id;
        const kind = accountKindOf(a);
        const st = reconStatus(a, today);
        const last = i === data.accounts.length - 1 && !open && !reconOpen;
        return (
          <React.Fragment key={a.id}>
            <Row last={last}>
              <span title={ACCOUNT_KIND_LABEL[kind]} style={{
                width: 28, height: 28, borderRadius: 9, background: T.panel2, display: "grid",
                placeItems: "center", fontSize: 13, color: KIND_COLOR[kind], flexShrink: 0,
              }}>{KIND_ICON[kind]}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Faz 18: ad satır içinde düzenlenir — sil+yeniden ekle hesabın TÜM hareketlerini
                    (CASCADE) götürürdü, yani adı düzeltmek defteri yok etmek anlamına gelirdi. */}
                <input style={{ ...css.input, padding: "3px 6px", fontSize: 14, border: "1px solid transparent", background: "transparent" }}
                  defaultValue={a.name} key={a.name} title="Hesap adı (düzenlemek için tıkla)"
                  onFocus={(e) => { e.target.style.borderColor = T.line; e.target.style.background = T.panel2; }}
                  onBlur={async (e) => {
                    e.target.style.borderColor = "transparent"; e.target.style.background = "transparent";
                    const v = e.target.value.trim();
                    if (v && v !== a.name) { await api.put(`accounts/${a.id}`, { name: v }); reload(); }
                    else e.target.value = a.name;
                  }} />
                <div style={{ fontSize: 11, color: st === "bayat" ? T.warn : T.mut3 }}>
                  {ACCOUNT_KIND_LABEL[kind]} ·{" "}
                  {st === "hic" ? "henüz doğrulanmadı"
                    : st === "bayat" ? `son doğrulama ${a.last_recon_date} — bayat`
                      : `✓ ${a.last_recon_date} tarihinde doğrulandı`}
                </div>
              </div>
              <select style={{ ...css.input, width: 108, padding: "5px 8px", fontSize: 12 }} value={kind}
                title="Hesap türü"
                onChange={async (e) => { await api.put(`accounts/${a.id}`, { kind: e.target.value }); reload(); }}>
                {(Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[]).map((k) => <option key={k} value={k}>{ACCOUNT_KIND_LABEL[k]}</option>)}
              </select>
              <button style={{ ...css.ghost, padding: "5px 10px", fontSize: 12, ...(reconOpen ? { color: T.acc, borderColor: T.acc } : st === "bayat" || st === "hic" ? { color: T.warn, borderColor: T.warn } : {}) }}
                title="Gerçek bakiyeyi gir; fark deftere 'mutabakat' hareketi olarak yazılır"
                onClick={() => { setRecon(reconOpen ? null : a.id); setShown(null); }}>
                {reconOpen ? "Vazgeç" : "Doğrula"}
              </button>
              <button style={{ ...css.ghost, padding: "5px 10px", fontSize: 12, ...(open ? { color: T.acc, borderColor: T.acc } : {}) }}
                title="Hesap hareketleri" onClick={() => { setShown(open ? null : a.id); setRecon(null); }}>
                {open ? "Hareketleri gizle" : "Hareketler"}
              </button>
              <span style={{ ...css.mono, width: 120, textAlign: "right", fontSize: 14 }}>{tl.format(Math.round(a.balance))}</span>
              <button style={css.del} onClick={async () => { await api.del("accounts", a.id); reload(); }}>✕</button>
            </Row>
            {reconOpen && <Mutabakat data={data} account={a} reload={reload} onDone={() => setRecon(null)} />}
            {open && <HesapHareketleri data={data} account={a} />}
          </React.Fragment>
        );
      })}
      <form onSubmit={async (e) => {
        e.preventDefault();
        if (!acc.name) return;
        await api.post("accounts", { name: acc.name, balance: num(acc.balance), kind: acc.kind });
        setAcc({ name: "", balance: "", kind: acc.kind }); nameRef.current?.focus(); reload();
      }}>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Tür">
            <select style={css.input} value={acc.kind} onChange={(e) => setAcc({ ...acc, kind: e.target.value as AccountKind })}>
              {(Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[]).map((k) => <option key={k} value={k}>{ACCOUNT_KIND_LABEL[k]}</option>)}
            </select>
          </Field>
          <Field label="Hesap adı" flex={2}><input ref={nameRef} style={css.input} value={acc.name} placeholder={KIND_HINT[acc.kind]} onChange={(e) => setAcc({ ...acc, name: e.target.value })} /></Field>
          <AmountField label="Bakiye (TL)" value={acc.balance} onChange={(v) => setAcc({ ...acc, balance: v })} />
          <button type="submit" style={{ ...css.btn, opacity: acc.name ? 1 : 0.4 }} disabled={!acc.name}>Hesap Ekle</button>
        </div>
      </form>
    </div>
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
  const entered = real.trim() !== "";
  const diff = entered ? reconcileDiff(account, num(real)) : 0;
  const since = entriesSinceRecon(data.account_entries, account).slice(0, 8);
  const save = async () => {
    if (!entered || busy) return;
    setBusy(true);
    await api.post(`accounts/${account.id}/reconcile`, { balance: num(real), date: todayStr(), note: note.trim() || null });
    reload(); onDone();
  };
  return (
    <div style={{ background: T.panel2, borderRadius: 12, padding: "12px 14px", margin: "2px 0 10px" }}>
      <div style={{ fontSize: 12, color: T.mut, marginBottom: 8 }}>
        <b>{account.name}</b> hesabında <b>şu an gerçekte</b> ne kadar var? Uygulamadaki kayıt:{" "}
        <span style={css.mono}>{tl.format(Math.round(account.balance))}</span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <AmountField label="Gerçek bakiye (TL)" value={real} onChange={setReal} />
        <Field label="Not (opsiyonel)" flex={2}>
          <input style={css.input} value={note} placeholder="örn. banka masrafı, unutulan market harcaması"
            onChange={(e) => setNote(e.target.value)} />
        </Field>
        <button style={{ ...css.btn, opacity: entered && !busy ? 1 : 0.4 }} disabled={!entered || busy} onClick={save}>
          {busy ? "…" : "Doğrula"}
        </button>
      </div>
      {entered && (
        <div style={{ fontSize: 12.5, marginTop: 10, color: diff === 0 ? T.pos : T.warn }}>
          {diff === 0
            ? "✓ Fark yok — defterin tutuyor. Onaylayınca yalnız doğrulama tarihi güncellenir."
            : <>Fark: <span style={{ ...css.mono, fontWeight: 700 }}>{diff > 0 ? "+" : ""}{tl.format(Math.round(diff))}</span>{" "}
              — {diff > 0 ? "deftere girmemiş bir gelir/transfer var" : "deftere girmemiş bir harcama var"}.
              Onaylarsan bu fark <b>düzeltme hareketi</b> olarak deftere yazılır.</>}
        </div>
      )}
      {entered && diff !== 0 && since.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11.5, color: T.mut3, marginBottom: 4 }}>
            Son doğrulamadan bu yana ({since.length} hareket) — eksik kayıt bunların arasında olabilir:
          </div>
          {since.map((e) => (
            <div key={e.id} style={{ display: "flex", gap: 8, fontSize: 12, padding: "3px 0", color: T.mut }}>
              <span style={{ ...css.mono, width: 70 }}>{e.date}</span>
              <span style={{ flex: 1 }}>{e.note}</span>
              <span style={{ ...css.mono, color: e.amount < 0 ? T.neg : T.pos }}>{e.amount > 0 ? "+" : ""}{tl.format(Math.round(e.amount))}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ————— HESAP HAREKETLERİ (Faz 15) —————
   Hesabın bakiyesini açıklayan defter: her satır bir hareket + o hareketten sonraki bakiye.
   Hareketler sunucuda yazılır (bakiyeyi oynatan her akış), burada yalnız gösterilir — bu yüzden
   ekranda silme/düzenleme yok: hareket kaynağından (işlem, portföy işlemi, mevduat) düzenlenir.
   `ledgerDrift` 0 değilse defter bakiyeyi açıklamıyordur; sessizce düzeltmek yerine görünür yapılır. */
const KIND_LABEL: Record<AccountEntry["kind"], string> = {
  islem: "işlem", portfoy: "portföy", mevduat: "vadeli", duzeltme: "düzeltme", acilis: "açılış", virman: "transfer",
};
function HesapHareketleri({ data, account }: { data: AllData; account: AllData["accounts"][number] }) {
  const [limit, setLimit] = useState(20);
  const rows = accountLedger(data.account_entries, account.id);
  const drift = ledgerDrift(data.account_entries, account);
  const sum = ledgerSummary(rows);
  const shown = rows.slice(0, limit);
  return (
    <div style={{ background: T.panel2, borderRadius: 12, padding: "10px 12px", margin: "2px 0 10px" }}>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: T.mut, marginBottom: 8 }}>
        <span>{rows.length} hareket</span>
        <span>giren <span style={{ ...css.mono, color: T.pos }}>{tl.format(Math.round(sum.in))}</span></span>
        <span>çıkan <span style={{ ...css.mono, color: T.neg }}>{tl.format(Math.round(sum.out))}</span></span>
      </div>
      {drift !== 0 && (
        <div style={{ fontSize: 12, color: T.warn, marginBottom: 8 }}>
          Uyarı: defter bakiyeyi açıklamıyor — fark <span style={css.mono}>{tl.format(Math.round(drift))}</span>.
        </div>
      )}
      {rows.length === 0 && <Empty>Bu hesapta hareket yok.</Empty>}
      {shown.map((r) => (
        <div key={r.entry.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${T.line}` }}>
          <span style={{ ...css.mono, fontSize: 11.5, color: T.mut, width: 74 }}>
            {fmtD(new Date(r.entry.date + "T00:00:00"), { day: "2-digit", month: "short", year: "2-digit" })}
          </span>
          <span style={{ flex: 1, fontSize: 13 }}>
            {r.entry.note}
            <span style={{ fontSize: 11, color: T.mut3, marginLeft: 6 }}>{KIND_LABEL[r.entry.kind]}</span>
          </span>
          <span style={{ ...css.mono, fontSize: 13, color: r.entry.amount < 0 ? T.neg : T.pos }}>
            {r.entry.amount > 0 ? "+" : ""}{tl.format(Math.round(r.entry.amount))}
          </span>
          <span style={{ ...css.mono, fontSize: 12, color: T.mut, width: 96, textAlign: "right" }} title="bu hareketten sonraki bakiye">
            {tl.format(Math.round(r.balanceAfter))}
          </span>
        </div>
      ))}
      {rows.length > shown.length && (
        <button style={{ ...css.ghost, marginTop: 8, padding: "5px 10px", fontSize: 12 }} onClick={() => setLimit((l) => l + 50)}>
          Daha eski hareketler ({rows.length - shown.length})
        </button>
      )}
    </div>
  );
}

/* ————— VADELİ MEVDUAT — liste + vade kapatma ————— */
/* Ekleme global "+ Ekle"den; burada listeleme/silme + vade dolunca "Hesaba geçir".
   Değer net varlığa engine'de accrue eder (kilitli varlık); silme bağlı hesaba anaparayı iade eder. */
function VadeliMevduat({ data, reload, onEdit }: { data: AllData; reload: () => void; onEdit: (t: EditTarget) => void }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  /* vade kapatma: bağlı hesaba net faizi gelir olarak işle, sonra mevduatı sil (anapara iadesi) → hesap += vade değeri, Rapor'a faiz girer */
  const close = async (d: AllData["deposits"][number]) => {
    if (d.account_id) {
      const net = depositNetInterest(d);
      if (net !== 0) await api.post("transactions", { name: `${d.name} — vade faizi`, date: todayStr(), amount: net, account_id: d.account_id, category_id: null });
    }
    await api.del("deposits", d.id);
    reload();
  };
  return (
    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Vadeli Mevduat</div>
      <div style={{ fontSize: 12, color: T.mut, marginBottom: 8 }}>Anapara + faiz vade sonuna kadar net varlığa işleyerek girer; para vade sonuna dek kilitli sayılır (harcanabilir nakde girmez). "+ Ekle" → Vadeli mevduat ile açabilirsin.</div>
      {data.deposits.length === 0 && <Empty>Vadeli mevduatın yok.</Empty>}
      {data.deposits.map((d, i) => {
        const mat = depositMaturity(d);
        const matured = depositMatured(d, today);
        const daysLeft = depositDaysRemaining(d, today);
        const nowVal = depositValueOn(d, today);
        const accInt = depositAccruedInterest(d, today);
        const acc = d.account_id ? data.accounts.find((a) => a.id === d.account_id) : null;
        return (
          <Row key={d.id} last={i === data.deposits.length - 1}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14 }}>
                {d.name}{" "}
                {matured
                  ? <span style={{ fontSize: 11, color: T.pos }}>· vadesi doldu</span>
                  : <span style={{ fontSize: 11, color: T.mut }}>· {daysLeft} gün kaldı</span>}
              </div>
              <div style={{ fontSize: 11, color: T.mut }}>
                <span style={css.mono}>{tl.format(Math.round(d.principal))}</span> anapara · %{d.rate}/yıl · {d.term_days} gün · vade{" "}
                <span style={css.mono}>{fmtD(mat, { day: "2-digit", month: "short", year: "numeric" })}</span>
                {acc && <> · <span style={{ color: T.mut3 }}>{acc.name}</span></>}
              </div>
              <div style={{ fontSize: 11, color: T.mut }}>
                birikmiş faiz <span style={{ ...css.mono, color: T.pos }}>{tl.format(Math.round(accInt))}</span> · vade değeri{" "}
                <span style={css.mono}>{tl.format(Math.round(depositMaturityValue(d)))}</span>
              </div>
            </div>
            <span style={{ ...css.mono, color: T.acc, fontSize: 14 }}>{tl.format(Math.round(nowVal))}</span>
            {matured && d.account_id != null && (
              <button style={{ ...css.ghost, padding: "5px 10px", fontSize: 12, color: T.pos, borderColor: T.pos }}
                title="Net faizi hesaba gelir olarak işle, anaparayı iade et ve mevduatı kapat"
                onClick={() => close(d)}>Hesaba geçir</button>
            )}
            <button style={css.edit} title="Mevduatı düzenle" onClick={() => onEdit({ kind: "deposit", row: d })}>✎</button>
            <button style={css.del} title={d.account_id != null ? "Sil (anapara bağlı hesaba iade edilir)" : "Sil"}
              onClick={async () => { await api.del("deposits", d.id); reload(); }}>✕</button>
          </Row>
        );
      })}
    </div>
  );
}

/* ————— HESAP & VERİ (KVKK: dışa aktarım + hesap silme) ————— */
function HesapKvkk({ user, onDeleted }: { user: { email: string }; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const download = async () => {
    try {
      const blob = await api.exportData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `finans-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(url);
    } catch { setErr("Dışa aktarılamadı"); }
  };
  const remove = async () => {
    setErr(""); setBusy(true);
    try { await api.deleteAccount(pw); onDeleted(); }
    catch { setErr("Parola hatalı"); setBusy(false); }
  };

  return (
    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Hesap & Veri</div>
      <div style={{ fontSize: 13, color: T.mut, marginBottom: 12 }}>{user.email}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={css.ghost} onClick={download}>Verilerini indir (JSON)</button>
        {!confirm && <button style={{ ...css.ghost, color: T.neg, borderColor: T.neg }} onClick={() => setConfirm(true)}>Hesabı sil</button>}
      </div>
      {confirm && (
        <div style={{ marginTop: 12, padding: 12, border: `1px solid ${T.neg}`, borderRadius: 12, background: T.negSoft }}>
          <div style={{ fontSize: 13, color: T.text, marginBottom: 8 }}>
            <b>Hesabın ve tüm verilerin kalıcı olarak silinir.</b> Onaylamak için parolanı gir.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input style={{ ...css.input, width: 200 }} type="password" placeholder="parola" value={pw}
              onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
            <button style={{ ...css.btn, background: T.neg }} disabled={busy || !pw} onClick={remove}>{busy ? "…" : "Kalıcı olarak sil"}</button>
            <button style={css.ghost} onClick={() => { setConfirm(false); setPw(""); setErr(""); }}>Vazgeç</button>
          </div>
          {err && <div style={{ fontSize: 13, color: T.neg, marginTop: 8 }}>{err}</div>}
        </div>
      )}
    </div>
  );
}
