import React, { useMemo, useState } from "react";
import { parseD, fmtD, keyOf, num, cardInfos, stmtKey, txShares, type AllData, type Card } from "@finans/engine";
import { api } from "../../api";
import { T, css, tl, fmtMoney } from "../../theme";
import { Empty, Aciklama, Modal, SilDugmesi, useSayfalama, DahaFazla } from "../../ui";
import type { AddKind } from "../forms";
import { KategoriAlani } from "../forms/KategoriAlani";
import { girdi, Bolum, Etiketli, TutarGirdisi, Satirlar, SatirSec, SatirMetin, FormAlt, Vurgu } from "../forms/parcalar";
import { EditSheet, type EditTarget } from "../../EditSheet";

/* ————— KARTLAR —————
   Kart TANIMI burada yapılır; kart HARCAMASI girişi global "+" akışındadır.
   Ekstre ödeme (Faz 8.2): "Ödedim" ekstreyi gerçek gider kaydına çevirir (hesap seçilirse bakiye düşer,
   gelir/gider defterine girer) ve borç/projeksiyondan düşer; "Geri al" kaydı ve işareti siler.

   Yeniden tasarım (Ekim 2026, grup 3): her kart eskiden İKİ KEZ çiziliyordu — üstte renkli kart görseli,
   altında "Kredi Kartları" listesinde aynı ad/borç/limit çubuğu. Artık kart başına TEK kutu: renkli
   başlık + ekstreler + otomatik ödeme + "Kartı düzenle". Ekstre satırlarındaki eşit ağırlıklı "Ödedim"
   düğmeleri (iki kartta 7 tane) tek birincil düğmeye indi: kart başına sıradaki ödenmemiş ekstre; diğer
   ekstreler küçük "öde" bağlantısıyla yine ödenebilir. Kart ekleme/düzenleme ve ödeme alttan açılan
   sayfada (2. grubun form dili); ekleme formu artık sayfada hep açık durmuyor. */

/** Son ~40 gün içinde vadesi GEÇMİŞ en yakın ekstre (kayıt altına almak için) — cardInfos yalnız
    bugünden sonrakileri döndürdüğünden geçmişteki son ekstre burada ayrıca hesaplanır. */
function lastPastStatement(card: Card, txs: AllData["card_txs"], today: Date): { due: Date; amount: number } | null {
  const byDue = new Map<string, { due: Date; amount: number }>();
  txs.filter((t) => t.card_id === card.id).forEach((t) => {
    txShares(t, card).forEach((s) => {
      if (s.due < today && today.getTime() - s.due.getTime() <= 40 * 86_400_000) {
        const k = keyOf(s.due);
        if (!byDue.has(k)) byDue.set(k, { due: s.due, amount: 0 });
        byDue.get(k)!.amount += s.amount;
      }
    });
  });
  const list = [...byDue.values()].sort((a, b) => +b.due - +a.due);
  return list[0] ?? null;
}

/* Kart başlıklarının degrade paleti — marka mor + tür renklerinden dönüşümlü */
const KART_RENK = [
  "linear-gradient(135deg,#5B5BD6,#7C6BE8)",
  "linear-gradient(135deg,#2f74c9,#1a9d86)",
  "linear-gradient(135deg,#c9971f,#dd6a2e)",
  "linear-gradient(135deg,#5a4ec2,#c26191)",
];

const kisaTarih = (d: Date) => fmtD(d, { day: "numeric", month: "short" });
const satir: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, minHeight: 46, padding: "0 16px", borderTop: `1px solid ${T.line2}`, fontSize: 14.5 };

export function Kartlar({ data, reload }: { data: AllData; reload: () => void; onAdd?: (k: AddKind) => void }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const paidSet = new Set(data.statement_payments.map((p) => stmtKey(p.card_id, p.due)));
  const infos = cardInfos(data.cards, data.card_txs, today, paidSet);
  const totalDebt = infos.reduce((s, c) => s + c.debt, 0);
  /* Kart harcamaları uygulamanın EN HIZLI büyüyen listesidir (her alışveriş bir satır). Sıralama
     hook'un dışında memolanır; satır tek katmanlı → 20'lik dilim. */
  const kartTxS = useSayfalama(
    useMemo(() => [...data.card_txs].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id), [data.card_txs]),
    20,
  );
  const [paying, setPaying] = useState<{ card: Card; dueK: string; amount: number } | null>(null);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  /** Kart sayfası: `null` kapalı, `"yeni"` ekleme, kart nesnesi düzenleme */
  const [kartSayfa, setKartSayfa] = useState<Card | "yeni" | null>(null);
  const unpay = async (cardId: number, dueK: string) => { await api.unpayStatement(cardId, dueK); reload(); };

  return (<>
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: T.mut }}>Toplam kart borcu</div>
        <div style={{ ...css.mono, fontSize: 26, fontWeight: 600, color: totalDebt > 0 ? T.neg : T.text }}>{tl.format(Math.round(totalDebt))}</div>
      </div>
      <button onClick={() => setKartSayfa("yeni")} style={{
        height: 40, padding: "0 14px", borderRadius: 11, border: `1px solid ${T.line}`, background: T.panel,
        fontFamily: T.disp, fontSize: 14, fontWeight: 600, color: T.text, cursor: "pointer",
      }}>+ Kart</button>
    </div>
    <Aciklama k="kart-ekstre" label="ekstreler nasıl oluşuyor?">
      Harcamalar kesim gününe göre ekstreye dağılır; her ekstre son ödeme tarihinde nakit akışına gider olarak düşer. Geçmiş vadeli ekstreler ödendi varsayılır.
      Otomatik ödeme talimatı varsa vade günü geldiğinde ekstre seçili hesaptan kendiliğinden ödenir; talimat verildiği günden önceki ekstrelere dokunulmaz.
    </Aciklama>
    {infos.length === 0 && <div style={css.card}><Empty>Henüz kart yok. “+ Kart” ile ekle.</Empty></div>}

    {infos.length > 0 && (
      <div className="grid2" style={{ alignItems: "start" }}>
        {infos.map((ci, i) => {
          const usage = ci.card.limit_amount > 0 ? Math.min(1, ci.debt / ci.card.limit_amount) : 0;
          const past = lastPastStatement(ci.card, data.card_txs, today);
          const ekstreler = [
            ...(past ? [{ et: "Geçen", due: past.due, amount: past.amount, paid: paidSet.has(stmtKey(ci.card.id, keyOf(past.due))) }] : []),
            ...ci.statements.slice(0, 3).map((s, j) => ({ et: j === 0 ? "Sıradaki" : "Sonraki", due: s.due, amount: s.amount, paid: s.paid })),
          ];
          /* Birincil "Ödedim" yalnız ilk ödenmemiş ekstrede: sıradaki iş odur */
          const ilkOdenmemis = ekstreler.findIndex((e) => !e.paid);
          const oto = ci.card.pay_account_id != null ? data.accounts.find((a) => a.id === ci.card.pay_account_id) : null;
          return (
            <div key={ci.card.id} style={{ ...css.card, padding: 0, overflow: "hidden" }}>
              <div style={{ background: KART_RENK[i % KART_RENK.length], color: "#fff", padding: "18px 18px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 650, fontSize: 15, flex: 1, minWidth: 0 }}>{ci.card.name}</span>
                  <span style={{ fontSize: 12, opacity: 0.85, whiteSpace: "nowrap" }}>kesim {ci.card.statement_day} · ödeme {ci.card.due_day}</span>
                </div>
                <div style={{ fontSize: 12, opacity: 0.85, marginTop: 14 }}>güncel borç</div>
                <div style={{ ...css.mono, fontSize: 28, fontWeight: 600 }}>{tl.format(Math.round(ci.debt))}</div>
                {ci.card.limit_amount > 0 && (<>
                  <div style={{ height: 6, background: "rgba(255,255,255,.25)", borderRadius: 3, overflow: "hidden", marginTop: 12 }}>
                    <div style={{ height: "100%", width: `${usage * 100}%`, background: "#fff", borderRadius: 3 }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", ...css.mono, fontSize: 11.5, opacity: 0.9, marginTop: 6 }}>
                    <span>kullanılabilir {tl.format(Math.round(ci.card.limit_amount - ci.debt))}</span>
                    <span>limit {tl.format(ci.card.limit_amount)}</span>
                  </div>
                </>)}
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: T.mut, padding: "12px 16px 6px" }}>Ekstreler</div>
              {ekstreler.length === 0 && <div style={{ ...satir, color: T.mut, fontSize: 13.5 }}>Yaklaşan ekstre yok.</div>}
              {ekstreler.map((e, j) => {
                const dueK = keyOf(e.due);
                return (
                  <div key={dueK} style={satir}>
                    <span style={{ flex: 1, minWidth: 0 }}>{e.et} <span style={{ color: T.mut, fontSize: 13 }}>· {kisaTarih(e.due)}</span></span>
                    <span style={{ ...css.mono, color: e.paid ? T.mut : T.text, textDecoration: e.paid ? "line-through" : "none", fontWeight: j === ilkOdenmemis ? 600 : 400 }}>
                      {tl.format(Math.round(e.amount))}
                    </span>
                    {e.paid ? (<>
                      <span style={{ fontSize: 11.5, fontWeight: 600, padding: "2px 7px", borderRadius: 6, background: T.posSoft, color: T.pos }}>ödendi</span>
                      <button title="Ödemeyi geri al (gider kaydı silinir, bakiye iade edilir)" onClick={() => unpay(ci.card.id, dueK)}
                        style={{ background: "none", border: "none", color: T.mut, fontFamily: T.disp, fontSize: 13, cursor: "pointer", padding: "6px 0", minHeight: 0 }}>geri al</button>
                    </>) : j === ilkOdenmemis ? (
                      <button onClick={() => setPaying({ card: ci.card, dueK, amount: e.amount })} style={{
                        height: 34, minHeight: 0, padding: "0 14px", border: "none", borderRadius: 10, background: T.acc, color: T.accInk,
                        fontFamily: T.disp, fontSize: 13.5, fontWeight: 600, cursor: "pointer",
                      }}>Ödedim</button>
                    ) : (
                      <button onClick={() => setPaying({ card: ci.card, dueK, amount: e.amount })}
                        style={{ background: "none", border: "none", color: T.acc, fontFamily: T.disp, fontSize: 13.5, cursor: "pointer", padding: "6px 0", minHeight: 0 }}>öde</button>
                    )}
                  </div>
                );
              })}
              {/* otomatik ödeme talimatı: hesap seçiliyse vadesi gelen ekstre o hesaptan ödenir (uygulama
                  açılışında, vade tarihiyle); talimattan önceki ekstrelere dokunulmaz (engine/otomatik.ts) */}
              <SatirSec etiket="Otomatik ödeme" goruntu={oto ? oto.name : "talimat yok"} soluk={!oto} value={ci.card.pay_account_id ?? ""}
                    onChange={async (v) => { await api.put(`cards/${ci.card.id}`, { pay_account_id: v ? +v : null }); reload(); }}>
                    <option value="">Talimat yok (elle öderim)</option>
                    {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </SatirSec>
              <div style={{ ...satir, justifyContent: "flex-end" }}>
                <button onClick={() => setKartSayfa(ci.card)} style={{ background: "none", border: "none", color: T.mut, fontFamily: T.disp, fontSize: 14, cursor: "pointer", padding: "8px 0" }}>Kartı düzenle</button>
              </div>
            </div>
          );
        })}
      </div>
    )}

    {data.card_txs.length > 0 && (
      <div style={{ ...css.card, padding: "14px 0 6px" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "0 16px 8px", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 16, flex: 1 }}>Kart harcamaları</span>
          <span style={{ fontSize: 12.5, color: T.mut }}>dokun: düzenle</span>
        </div>
        {/* Satırın tamamı dokunma hedefi (yeniden tasarım, grup 3 — Faz 24 kural 1'in güncellemesi):
            ✎ ✕ satırdan kalktı, silme düzenleme sayfasının içinde (yan etkisiyle). */}
        {kartTxS.gorunen.map((t) => {
          const card = data.cards.find((c) => c.id === t.card_id);
          const shares = card ? txShares(t, card) : [];
          const remaining = shares.filter((s) => s.due >= today);
          const kat = t.category_id != null ? data.categories.find((c) => c.id === t.category_id)?.name : null;
          const alt = [card?.name, kat, t.installments > 1 ? `${t.installments} taksit, ${t.installments - remaining.length} ödendi` : null].filter(Boolean).join(" · ");
          return (
            <button key={t.id} onClick={() => setEditing({ kind: "cardtx", row: t })} className="liste-satir" style={{
              ...satir, width: "100%", minHeight: 56, background: "none", border: "none", borderTop: `1px solid ${T.line2}`,
              textAlign: "left", cursor: "pointer", fontFamily: T.disp, color: T.text,
            }}>
              <span style={{ width: 32, textAlign: "center", lineHeight: 1.05, flexShrink: 0 }}>
                <span style={{ display: "block", ...css.mono, fontSize: 15, fontWeight: 600 }}>{fmtD(parseD(t.date), { day: "2-digit" })}</span>
                <span style={{ display: "block", fontSize: 11, color: T.mut }}>{fmtD(parseD(t.date), { month: "short" })}</span>
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                {alt && <span style={{ display: "block", fontSize: 12.5, color: T.mut, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{alt}</span>}
              </span>
              <span style={{ ...css.mono, flexShrink: 0 }}>{tl.format(Math.round(t.amount))}</span>
            </button>
          );
        })}
        <div style={{ padding: "0 16px" }}><DahaFazla s={kartTxS} ad="harcama" /></div>
      </div>
    )}

    {paying && <EkstreOde data={data} reload={reload} odeme={paying} onClose={() => setPaying(null)} />}
    {kartSayfa && <KartSayfasi data={data} reload={reload} kart={kartSayfa === "yeni" ? null : kartSayfa}
      borc={kartSayfa === "yeni" ? 0 : infos.find((c) => c.card.id === kartSayfa.id)?.debt ?? 0} onClose={() => setKartSayfa(null)} />}
    {editing && <EditSheet data={data} target={editing} reload={reload} onClose={() => setEditing(null)} />}
  </>);
}

/** "Ödedim": ekstre gider olarak deftere geçer, borçtan düşer. Tutar ekranda yazan ekstre tutarıdır
    (`statementAmount`) — kullanıcının onayladığı ile yazılan tanım gereği aynı (E2EE aşama 1b). */
function EkstreOde({ data, reload, odeme, onClose }: {
  data: AllData; reload: () => void; odeme: { card: Card; dueK: string; amount: number }; onClose: () => void;
}) {
  const [pp, setPp] = useState({ account_id: odeme.card.pay_account_id != null ? String(odeme.card.pay_account_id) : "", category_id: "" });
  const [busy, setBusy] = useState(false);
  const acc = pp.account_id ? data.accounts.find((a) => a.id === +pp.account_id) : null;
  const kaydet = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.payStatement(odeme.card.id, odeme.dueK, {
        account_id: pp.account_id ? +pp.account_id : null,
        category_id: pp.category_id ? +pp.category_id : null,
        amount: odeme.amount,
      });
      reload(); onClose();
    } finally { setBusy(false); }
  };
  return (
    <Modal title="Ekstreyi öde" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); kaydet(); }}>
        <Bolum>
          <div>
            <div style={{ fontSize: 13, color: T.mut, marginBottom: 2 }}>{odeme.card.name} · {fmtD(parseD(odeme.dueK), { day: "numeric", month: "long" })} ekstresi</div>
            <div style={{ ...css.mono, fontSize: 38, fontWeight: 600, letterSpacing: "-0.02em" }}>{fmtMoney(odeme.amount, "TRY", true)}</div>
          </div>
          <Satirlar>
            <SatirSec etiket="Hesap" goruntu={acc ? acc.name : "Bakiyeye işleme"} soluk={!acc} value={pp.account_id} onChange={(v) => setPp({ ...pp, account_id: v })}>
              <option value="">— Bakiyeye işleme</option>
              {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </SatirSec>
            {/* Ekstre ödemesi her zaman bir GİDER kaydıdır → yeni kategori gider türünde açılır */}
            <KategoriAlani satir bos="seç (isteğe bağlı)" data={data} reload={reload} value={pp.category_id}
              onChange={(v) => setPp({ ...pp, category_id: v })} kind="expense" />
          </Satirlar>
        </Bolum>
        <FormAlt ok={!busy} reason="Kaydediliyor…" editing etiket="Ödendi olarak kaydet"
          sonuc={acc
            ? <><b>{acc.name}</b> bakiyesinden <Vurgu v={odeme.amount} isaret="−" /> düşer; ekstre ödendi sayılır, borçtan çıkar.</>
            : "Hesap seçilmedi: yalnız gider kaydı olur, bakiyeye dokunmaz; ekstre ödendi sayılır."} />
      </form>
    </Modal>
  );
}

/** Kart ekleme / düzenleme (Faz 18: kart tanımı kendi sekmesinde düzenlenir — sil+yeniden ekle kartın
    TÜM harcamalarını CASCADE ile götürürdü). Kesim/son ödeme günü değişince ekstreler yeniden türetilir. */
function KartSayfasi({ data, reload, kart, borc, onClose }: {
  data: AllData; reload: () => void; kart: Card | null; borc: number; onClose: () => void;
}) {
  const [f, setF] = useState({
    name: kart?.name ?? "", limit_amount: kart?.limit_amount ? String(kart.limit_amount) : "",
    statement_day: kart ? String(kart.statement_day) : "", due_day: kart ? String(kart.due_day) : "",
    pay_account_id: kart?.pay_account_id != null ? String(kart.pay_account_id) : "",
  });
  const gunOk = (v: string) => +v >= 1 && +v <= 31;
  const ok = !!f.name.trim() && gunOk(f.statement_day) && gunOk(f.due_day);
  const reason = !f.name.trim() ? "Kartın adını yaz." : !gunOk(f.statement_day) ? "Kesim günü 1-31 arası olmalı." : !gunOk(f.due_day) ? "Son ödeme günü 1-31 arası olmalı." : null;
  const acc = f.pay_account_id ? data.accounts.find((a) => a.id === +f.pay_account_id) : null;
  const kaydet = async () => {
    if (!ok) return;
    const govde = { name: f.name.trim(), limit_amount: num(f.limit_amount), statement_day: +f.statement_day, due_day: +f.due_day };
    if (kart) await api.put(`cards/${kart.id}`, { ...govde, pay_account_id: f.pay_account_id ? +f.pay_account_id : null });
    else await api.post("cards", govde);
    reload(); onClose();
  };
  return (
    <Modal title={kart ? "Kartı düzenle" : "Kart ekle"} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); kaydet(); }}>
        <Bolum>
          <Etiketli etiket="Kart adı">
            <input autoFocus={!kart} style={girdi} value={f.name} placeholder="örn. Yapı Kredi" onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Etiketli>
          <TutarGirdisi etiket="Limit (isteğe bağlı)" value={f.limit_amount} onChange={(v) => setF({ ...f, limit_amount: v })} />
          <Satirlar>
            <SatirMetin etiket="Kesim günü" sayi placeholder="1-31" value={f.statement_day} onChange={(v) => setF({ ...f, statement_day: v.replace(/\D/g, "").slice(0, 2) })} />
            <SatirMetin etiket="Son ödeme günü" sayi placeholder="1-31" value={f.due_day} onChange={(v) => setF({ ...f, due_day: v.replace(/\D/g, "").slice(0, 2) })} />
            {kart && (
              <SatirSec etiket="Otomatik ödeme" goruntu={acc ? acc.name : "talimat yok"} soluk={!acc} value={f.pay_account_id} onChange={(v) => setF({ ...f, pay_account_id: v })}>
                <option value="">Talimat yok (elle öderim)</option>
                {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </SatirSec>
            )}
          </Satirlar>
          {kart && <div style={{ fontSize: 13, color: T.mut, lineHeight: 1.45 }}>Kesim/son ödeme günü değişirse geçmiş harcamalar yeni günlere göre yeniden ekstrelenir — harcamalar silinmez.</div>}
        </Bolum>
        <FormAlt ok={ok} reason={reason} editing etiket={kart ? "Değişikliği kaydet" : "Kartı ekle"}
          sonuc={<>Harcamalar her ayın {f.statement_day}. günü ekstreye kesilir, son ödeme {f.due_day}. gün.</>}
          sil={kart ? (
            /* CASCADE: kartın tüm harcamaları da gider — uygulamanın en ağır silmelerinden */
            <SilDugmesi ad={kart.name} title="Kartı sil" ikon="Sil" className="form-sil"
              style={{ color: T.neg, fontSize: 14.5, fontWeight: 600, padding: "8px 6px" }}
              onSil={async () => { await api.del("cards", kart.id); reload(); onClose(); }}
              sonuc={<>Bu karta ait <b>tüm harcamalar</b> ve ekstre geçmişi de silinir. Güncel borç: {tl.format(Math.round(borc))}.</>} />
          ) : undefined} />
      </form>
    </Modal>
  );
}
