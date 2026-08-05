import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  todayStr, num, fmtD, qtyFromAmount, amountFromQty, cashDelta, positions,
  depositMaturity, depositGrossInterest, depositNetInterest, depositMaturityValue,
  type AllData, type AssetType, type CardTx, type Currency, type Deposit, type OneOff, type Recurring,
  type Trade, type Transaction, type Transfer, type Loan,
} from "@finans/engine";
import { api } from "../../api";
import { T, css, fmtMoney, TYPE_HINT } from "../../theme";
import { Field, AmountField, Hint, SuggestInput } from "../../ui";
import {
  kalemSuggestions, cardTxSuggestions, symbolSuggestions, priceOf, priceCcyOf, heldQty, lastUsedPortfolio,
  type KalemSuggestion, type CardTxSuggestion, type SymbolSuggestion,
} from "./recall";

/** Varlık türünün doğal para birimi: yurt dışı borsa (KRIPTO/ETF) USD, diğerleri TRY */
const defaultCcy = (t: AssetType): Currency => (t === "KRIPTO" || t === "ETF" ? "USD" : "TRY");

/* ————— GLOBAL "+ EKLE" AKIŞININ FORMLARI —————
   Her form modal içinde yaşar: "Kaydet" kaydedip kapatır, "Kaydet, yeni ekle"
   kaydedip formu sıfırlar ve odağı ilk alana döndürür (art arda giriş). */

export type AddKind = "kalem" | "transfer" | "cardtx" | "recurring" | "loan" | "trade" | "deposit" | "import";
export { ImportForm } from "./ImportForm";
type FormProps = { data: AllData; reload: () => void; onClose: () => void };
/** Formu önden doldurma: Plan'daki ileri tarihli kalemi "Gerçekleşti" ile deftere geçirirken
    (`oneoffId` ile — kaydedilince plan kalemi silinir) veya "+ Ekle"deki şablon çipinden. */
export type KalemPrefill = {
  name: string; amount: number; type: "gider" | "gelir"; oneoffId?: number;
  category_id?: number | null; account_id?: number | null;
};
/** Kart harcaması şablon çipinden önden doldurma */
export type CardTxPrefill = { name: string; amount: number; card_id: number; installments: number };

/** Düzenleme (Faz 14): aynı formlar "düzenle" modunda da kullanılır — ayrı düzenleme formu yazmak
    aynı doğrulama/ipucu mantığını iki yerde bakmak demek olurdu. Fark yalnız kayıt yolunda:
    POST yerine ilgili PUT ucu, ve "Kaydet, yeni ekle" düğmesi olmaz. Kayıt türü değişmez —
    gerçekleşen kayıt düzenlenince gerçekleşen kalır (plan'a çevirmek için sil + yeniden ekle). */
export type EditTarget =
  | { kind: "transaction"; row: Transaction }
  | { kind: "oneoff"; row: OneOff }
  | { kind: "cardtx"; row: CardTx }
  | { kind: "trade"; row: Trade }
  | { kind: "transfer"; row: Transfer }
  /* Faz 18 — TANIM kayıtları. İşlem kayıtlarından farkı: bunların "sil + yeniden ekle" alternatifi
     yıkıcıydı (bağlı işlemler `ON DELETE SET NULL`/CASCADE ile kopar ya da silinir). Kredi/mevduat
     gibi tanımlar global "+ Ekle" formlarına sahip olduğundan aynı formlar `edit` ile açılır;
     kart/kategori/portföy/hesap gibi kendi sekmesinde tanımlananlar satır içinde düzenlenir. */
  | { kind: "recurring"; row: Recurring }
  | { kind: "loan"; row: Loan }
  | { kind: "deposit"; row: Deposit };

/** Kaydet (kapat) + Kaydet-yeni-ekle buton çifti; düzenlemede tek "Kaydet" kalır */
function SaveButtons({ ok, reason, onSaveNew, editing }: { ok: boolean; reason: string | null; onSaveNew: () => void; editing?: boolean }) {
  return (<>
    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
      <button type="submit" style={{ ...css.btn, opacity: ok ? 1 : 0.4 }} disabled={!ok}>Kaydet</button>
      {!editing && <button type="button" style={{ ...css.ghost, opacity: ok ? 1 : 0.4 }} disabled={!ok} onClick={onSaveNew}>Kaydet, yeni ekle</button>}
    </div>
    {reason && <Hint>{reason}</Hint>}
  </>);
}

/** Gelir/gider kalemi — tarihe göre otomatik yönlendirilir:
    bugün/geçmiş → gerçekleşen kayıt (transactions; hesaba bağlıysa bakiyeye işler, Rapor'a girer),
    ileri tarih → plan kalemi (oneoffs; nakit projeksiyonuna girer). */
export function KalemForm({ data, reload, onClose, prefill, edit }: FormProps & {
  prefill?: KalemPrefill; edit?: Extract<EditTarget, { kind: "transaction" | "oneoff" }>;
}) {
  const [tx, setTx] = useState(() => {
    if (edit) {
      const r = edit.row;
      const t = edit.kind === "transaction" ? (r as Transaction) : null;
      return {
        date: r.date, name: r.name, amount: String(Math.abs(r.amount)),
        type: (r.amount < 0 ? "gider" : "gelir") as "gider" | "gelir",
        category_id: t?.category_id != null ? String(t.category_id) : "",
        account_id: t?.account_id != null ? String(t.account_id) : "",
      };
    }
    return {
      date: todayStr(), name: prefill?.name ?? "", amount: prefill ? String(prefill.amount) : "",
      type: (prefill?.type ?? "gider") as "gider" | "gelir",
      category_id: prefill?.category_id != null ? String(prefill.category_id) : "",
      account_id: prefill?.account_id != null ? String(prefill.account_id) : data.accounts[0] ? String(data.accounts[0].id) : "",
    };
  });
  const nameRef = useRef<HTMLInputElement>(null);
  const sugs = useMemo(() => kalemSuggestions(data), [data]);
  /** geçmişten seçildi: tutar/tür/kategori/hesap o kaydın son halinden dolar (hepsi elle değiştirilebilir) */
  const pick = (s: KalemSuggestion) => {
    setTx((t) => ({
      ...t, name: s.name, amount: String(s.amount), type: s.type,
      category_id: s.category_id != null ? String(s.category_id) : "",
      account_id: s.account_id != null ? String(s.account_id) : t.account_id,
    }));
  };
  /* Yeni kayıtta tarih hedefi belirler (ileri → plan). Düzenlemede kayıt zaten bir tabloda yaşıyor:
     tarihi ileri almak onu plana çevirmez, yalnız tarihi değişir. */
  const future = edit ? edit.kind === "oneoff" : tx.date > todayStr(); // ISO tarihte string karşılaştırması güvenli
  const ok = !!tx.name && num(tx.amount) > 0 && !!tx.date;
  const reason = !tx.name ? "Ad gerekli" : !(num(tx.amount) > 0) ? "Tutar 0'dan büyük olmalı" : !tx.date ? "Tarih gerekli" : null;
  const save = async (andNew: boolean) => {
    if (!ok) return;
    const amount = (tx.type === "gider" ? -1 : 1) * num(tx.amount);
    if (edit) {
      if (edit.kind === "oneoff") {
        await api.put(`oneoffs/${edit.row.id}`, { name: tx.name, date: tx.date, amount });
      } else {
        await api.put(`transactions/${edit.row.id}`, {
          name: tx.name, date: tx.date, amount,
          category_id: tx.category_id ? +tx.category_id : null,
          account_id: tx.account_id ? +tx.account_id : null,
        });
      }
      reload();
      onClose();
      return;
    }
    if (future) {
      await api.post("oneoffs", { name: tx.name, date: tx.date, amount });
    } else {
      await api.post("transactions", {
        name: tx.name, date: tx.date, amount,
        category_id: tx.category_id ? +tx.category_id : null,
        account_id: tx.account_id ? +tx.account_id : null,
      });
    }
    if (prefill?.oneoffId) await api.del("oneoffs", prefill.oneoffId); // "Gerçekleşti": plan kalemi deftere geçti
    reload();
    // tarih/tür/kategori/hesap korunur — aynı günün fişlerini art arda girerken tekrar seçmek gerekmez
    if (andNew) { setTx({ ...tx, name: "", amount: "" }); nameRef.current?.focus(); } else onClose();
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Field label="Ad" flex={2}>
          <SuggestInput autoFocus inputRef={nameRef} value={tx.name} onChange={(v) => setTx({ ...tx, name: v })}
            onPick={pick} options={sugs} labelOf={(s) => s.name}
            subOf={(s) => `${fmtMoney(s.amount, "TRY", true)} · ${s.count}×`} placeholder="örn. Migros" />
        </Field>
        <AmountField label="Tutar (TL)" value={tx.amount} onChange={(v) => setTx({ ...tx, amount: v })} />
        <Field label="Tarih"><input type="date" style={css.input} value={tx.date} onChange={(e) => setTx({ ...tx, date: e.target.value })} /></Field>
        <Field label="Tür">
          <select style={css.input} value={tx.type} onChange={(e) => setTx({ ...tx, type: e.target.value as "gider" | "gelir" })}>
            <option value="gider">Gider (−)</option><option value="gelir">Gelir (+)</option>
          </select>
        </Field>
      </div>
      {!future && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <Field label="Hesap" flex={2}>
            <select style={css.input} value={tx.account_id} onChange={(e) => setTx({ ...tx, account_id: e.target.value })}>
              <option value="">— (bakiyeye işleme)</option>
              {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Kategori" flex={2}>
            <select style={css.input} value={tx.category_id} onChange={(e) => setTx({ ...tx, category_id: e.target.value })}>
              <option value="">Kategorisiz</option>
              {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
      )}
      <div style={{ fontSize: 12, color: T.mut, marginTop: 10, background: T.panel2, borderRadius: 8, padding: "8px 12px" }}>
        {edit
          ? edit.kind === "oneoff"
            ? "Plan kalemi düzenleniyor: değişiklik Nakit Akışı projeksiyonuna yansır. (Deftere geçirmek için Plan'daki “Gerçekleşti” düğmesini kullan.)"
            : "Gerçekleşen kayıt düzenleniyor: bakiye etkisi otomatik düzeltilir — eski tutar ilgili hesaptan geri alınır, yenisi işlenir (hesabı değiştirsen bile)."
          : future
            ? "İleri tarihli → plan kalemi olarak kaydedilir: Nakit Akışı projeksiyonuna girer, günü gelince Plan'dan \"Gerçekleşti\" ile deftere geçirebilirsin."
            : tx.account_id
              ? "Gerçekleşen kayıt: seçili hesabın bakiyesine hemen işler ve Rapor'a girer."
              : "Gerçekleşen kayıt: hesap seçilmedi — sadece Rapor'a girer, bakiyeye dokunmaz."}
      </div>
      <SaveButtons ok={ok} reason={reason} onSaveNew={() => save(true)} editing={!!edit} />
    </form>
  );
}

/** Kart harcaması → ekstreye işlenir, son ödeme günü nakit akışına düşer */
export function CardTxForm({ data, reload, onClose, prefill, edit }: FormProps & { prefill?: CardTxPrefill; edit?: CardTx }) {
  const [tf, setTf] = useState(() => edit
    ? { card_id: edit.card_id, date: edit.date, name: edit.name, amount: String(edit.amount), installments: String(edit.installments) }
    : {
      card_id: prefill?.card_id ?? 0, date: todayStr(), name: prefill?.name ?? "",
      amount: prefill ? String(prefill.amount) : "", installments: String(prefill?.installments ?? 1),
    });
  const nameRef = useRef<HTMLInputElement>(null);
  const sugs = useMemo(() => cardTxSuggestions(data), [data]);
  /** geçmişten seçildi: tutar/kart/taksit son kaydından dolar */
  const pick = (s: CardTxSuggestion) =>
    setTf((t) => ({ ...t, name: s.name, amount: String(s.amount), card_id: s.card_id, installments: String(s.installments) }));
  useEffect(() => { if (!edit && data.cards.length === 1 && tf.card_id === 0) setTf((s) => ({ ...s, card_id: data.cards[0].id })); }, [data.cards]);
  const ok = tf.card_id > 0 && !!tf.name && num(tf.amount) > 0 && !!tf.date && +tf.installments >= 1;
  const reason = tf.card_id === 0 ? "Kart seçilmeli" : !tf.name ? "Açıklama gerekli" : !(num(tf.amount) > 0) ? "Tutar 0'dan büyük olmalı" : null;
  const save = async (andNew: boolean) => {
    if (!ok) return;
    const body = { card_id: tf.card_id, date: tf.date, name: tf.name, amount: num(tf.amount), installments: +tf.installments };
    if (edit) { await api.put(`cardtxs/${edit.id}`, body); reload(); onClose(); return; }
    await api.post("cardtxs", body);
    reload();
    if (andNew) { setTf({ ...tf, name: "", amount: "", installments: "1" }); nameRef.current?.focus(); } else onClose();
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Field label="Kart">
          <select style={css.input} value={tf.card_id} onChange={(e) => setTf({ ...tf, card_id: +e.target.value })}>
            <option value={0}>Seç…</option>
            {data.cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Tarih"><input type="date" style={css.input} value={tf.date} onChange={(e) => setTf({ ...tf, date: e.target.value })} /></Field>
        <Field label="Açıklama" flex={2}>
          <SuggestInput autoFocus inputRef={nameRef} value={tf.name} onChange={(v) => setTf({ ...tf, name: v })}
            onPick={pick} options={sugs} labelOf={(s) => s.name}
            subOf={(s) => `${fmtMoney(s.amount, "TRY", true)} · ${s.count}×`} placeholder="örn. Telefon" />
        </Field>
        <AmountField label="Toplam tutar (TL)" value={tf.amount} onChange={(v) => setTf({ ...tf, amount: v })} />
        <Field label="Taksit"><input style={css.input} inputMode="numeric" placeholder="1" value={tf.installments} onChange={(e) => setTf({ ...tf, installments: e.target.value })} /></Field>
      </div>
      {ok && +tf.installments > 1 && (
        <div style={{ fontSize: 12, color: T.mut, marginTop: 8 }}>
          aylık pay: <span style={{ ...css.mono, color: T.text }}>{fmtMoney(num(tf.amount) / +tf.installments, "TRY", true)}</span> × {tf.installments}
        </div>
      )}
      {edit && (
        <div style={{ fontSize: 12, color: T.mut, marginTop: 10, background: T.panel2, borderRadius: 8, padding: "8px 12px" }}>
          Harcama düzenleniyor: tarih veya taksit değişirse harcama yeniden hesaplanıp doğru ekstrelere dağıtılır.
        </div>
      )}
      <SaveButtons ok={ok} reason={reason} onSaveNew={() => save(true)} editing={!!edit} />
    </form>
  );
}

/** Düzenli gelir/gider → her ay tekrarlar, nakit projeksiyonuna girer.
    Opsiyonel hedef (hesap veya kart) bağlanırsa günü gelince Plan'dan "Gerçekleşti" ile (veya "otomatik"
    açıksa cron ile) gerçek kayda dönüşür: hesap → transactions (bakiye+Rapor), kart → o ayki ekstreye. */
export function RecurringForm({ data, reload, onClose, edit }: FormProps & { edit?: Recurring }) {
  /* Faz 18 — düzenlemede TUTAR yoktur: kimlik (`recurring`) ile tutar (`recurring_amounts` zaman
     çizelgesi) Faz 9'da bilinçli olarak ayrıldı. Tutarı buradan değiştirmek geçmiş projeksiyonu
     geriye dönük bozardı; doğru yol Plan'daki "Değiştir" (seçilen aydan itibaren yeni tutar satırı). */
  const [rec, setRec] = useState(() => edit
    ? {
      kind: edit.kind, name: edit.name, amount: "", day: String(edit.day),
      from_month: edit.from_month ?? "", to_month: edit.to_month ?? "",
      target: edit.account_id != null ? `acc:${edit.account_id}` : edit.card_id != null ? `card:${edit.card_id}` : "",
      category_id: edit.category_id != null ? String(edit.category_id) : "", auto: !!edit.auto,
    }
    : {
      kind: "income" as Recurring["kind"], name: "", amount: "", day: "", from_month: "", to_month: "",
      target: "", category_id: "", auto: false, // target: "" | "acc:<id>" | "card:<id>"
    });
  const nameRef = useRef<HTMLInputElement>(null);
  const ok = !!rec.name && (edit ? true : num(rec.amount) > 0) && +rec.day >= 1 && +rec.day <= 31;
  const reason = !rec.name ? "Ad gerekli"
    : !edit && !(num(rec.amount) > 0) ? "Tutar 0'dan büyük olmalı"
      : !(+rec.day >= 1 && +rec.day <= 31) ? "Gün 1-31 arası olmalı" : null;
  const isAcc = rec.target.startsWith("acc:");
  const cats = data.categories.filter((c) => c.kind === rec.kind);
  const save = async (andNew: boolean) => {
    if (!ok) return;
    const account_id = rec.target.startsWith("acc:") ? +rec.target.slice(4) : null;
    const card_id = rec.target.startsWith("card:") ? +rec.target.slice(5) : null;
    const idCols = {
      kind: rec.kind, name: rec.name, day: +rec.day,
      from_month: rec.from_month || null, to_month: rec.to_month || null,
      account_id, card_id, category_id: account_id && rec.category_id ? +rec.category_id : null, auto: rec.auto,
    };
    if (edit) { await api.put(`recurring/${edit.id}`, idCols); reload(); onClose(); return; }
    await api.post("recurring", { ...idCols, amount: num(rec.amount) });
    reload();
    if (andNew) { setRec({ ...rec, name: "", amount: "", day: "" }); nameRef.current?.focus(); } else onClose();
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Field label="Tür">
          <select style={css.input} value={rec.kind}
            onChange={(e) => { const kind = e.target.value as Recurring["kind"]; setRec({ ...rec, kind, category_id: "", ...(kind === "income" && rec.target.startsWith("card:") ? { target: "" } : {}) }); }}>
            <option value="income">Gelir</option><option value="expense">Gider</option>
          </select>
        </Field>
        <Field label="Ad" flex={2}><input ref={nameRef} autoFocus style={css.input} value={rec.name} placeholder="örn. Maaş" onChange={(e) => setRec({ ...rec, name: e.target.value })} /></Field>
        {!edit && <AmountField label="Tutar (TL)" value={rec.amount} onChange={(v) => setRec({ ...rec, amount: v })} />}
        <Field label="Gün (1-31)"><input style={css.input} inputMode="numeric" placeholder="1" value={rec.day} onChange={(e) => setRec({ ...rec, day: e.target.value })} /></Field>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <Field label="Hedef (ops.)" flex={2}>
          <select style={css.input} value={rec.target} onChange={(e) => setRec({ ...rec, target: e.target.value, category_id: "" })}>
            <option value="">Hedef yok (yalnız tahmin)</option>
            {data.accounts.map((a) => <option key={`a${a.id}`} value={`acc:${a.id}`}>Hesap: {a.name}</option>)}
            {rec.kind === "expense" && data.cards.map((c) => <option key={`c${c.id}`} value={`card:${c.id}`}>Kart: {c.name}</option>)}
          </select>
        </Field>
        {isAcc && cats.length > 0 && (
          <Field label="Kategori (ops.)" flex={2}>
            <select style={css.input} value={rec.category_id} onChange={(e) => setRec({ ...rec, category_id: e.target.value })}>
              <option value="">Kategorisiz</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <Field label="Başlangıç ayı (ops.)"><input type="month" style={css.input} value={rec.from_month} onChange={(e) => setRec({ ...rec, from_month: e.target.value })} /></Field>
        <Field label="Bitiş ayı (ops.)"><input type="month" style={css.input} value={rec.to_month} onChange={(e) => setRec({ ...rec, to_month: e.target.value })} /></Field>
      </div>
      {rec.target && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13, color: T.text, cursor: "pointer" }}>
          <input type="checkbox" checked={rec.auto} onChange={(e) => setRec({ ...rec, auto: e.target.checked })} />
          Otomatik gerçekleştir — günü gelince kendiliğinden {rec.target.startsWith("card:") ? "ekstreye" : "hesaba"} işlensin
        </label>
      )}
      <div style={{ fontSize: 12, color: T.mut, marginTop: 8, background: T.panel2, borderRadius: 8, padding: "8px 12px" }}>
        {!rec.target
          ? "Hedef yok: yalnız Nakit Akışı tahminine girer, bakiyeye/Rapor'a dokunmaz."
          : rec.target.startsWith("card:")
            ? "Kart hedefi: gerçekleşince o ayki kart ekstresine düşer; son ödeme günü nakit akışına gider olarak girer."
            : "Hesap hedefi: gerçekleşince seçili hesabın bakiyesine işler ve Rapor'a girer."}
        {rec.target && " Günü gelince Plan'dan “Gerçekleşti” ile, otomatik açıksa kendiliğinden işlenir."}
      </div>
      {edit && (
        <div style={{ fontSize: 12, color: T.mut, marginTop: 8, background: T.panel2, borderRadius: 8, padding: "8px 12px" }}>
          <b>Tutar burada değişmez.</b> Tutar bir zaman çizelgesinde yaşar; buradan değiştirmek geçmiş
          projeksiyonu da geriye dönük bozardı. Plan'daki <b>“Değiştir”</b> ile seçtiğin aydan itibaren
          yeni tutar geçerli olur, öncesi eski tutarla korunur.
        </div>
      )}
      <SaveButtons ok={ok} reason={reason} onSaveNew={() => save(true)} editing={!!edit} />
    </form>
  );
}

/** Kredi/taksit → kalan taksitler nakit projeksiyonuna girer */
export function LoanForm({ reload, onClose, edit }: FormProps & { edit?: Loan }) {
  const [f, setF] = useState(() => edit
    ? { name: edit.name, amount: String(edit.amount), first_date: edit.first_date, total: String(edit.total) }
    : { name: "", amount: "", first_date: todayStr(), total: "" });
  const nameRef = useRef<HTMLInputElement>(null);
  const ok = !!f.name && num(f.amount) > 0 && !!f.first_date && +f.total >= 1;
  const reason = !f.name ? "Ad gerekli" : !(num(f.amount) > 0) ? "Aylık taksit 0'dan büyük olmalı" : !(+f.total >= 1) ? "Toplam taksit en az 1 olmalı" : null;
  const save = async (andNew: boolean) => {
    if (!ok) return;
    const body = { name: f.name, amount: num(f.amount), first_date: f.first_date, total: +f.total };
    if (edit) { await api.put(`loans/${edit.id}`, body); reload(); onClose(); return; }
    await api.post("loans", body);
    reload();
    if (andNew) { setF({ name: "", amount: "", first_date: f.first_date, total: "" }); nameRef.current?.focus(); } else onClose();
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Field label="Ad" flex={2}><input ref={nameRef} autoFocus style={css.input} value={f.name} placeholder="örn. İhtiyaç kredisi" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <AmountField label="Aylık taksit (TL)" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
        <Field label="İlk taksit tarihi"><input type="date" style={css.input} value={f.first_date} onChange={(e) => setF({ ...f, first_date: e.target.value })} /></Field>
        <Field label="Toplam taksit"><input style={css.input} inputMode="numeric" placeholder="12" value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} /></Field>
      </div>
      {edit && (
        <div style={{ fontSize: 12, color: T.mut, marginTop: 8, background: T.panel2, borderRadius: 8, padding: "8px 12px" }}>
          Kalan taksit sayısı ilk taksit tarihi + toplamdan hesaplanır (elle tutulmaz), bu yüzden
          düzenleme kalan borcu ve projeksiyonu anında düzeltir.
        </div>
      )}
      <SaveButtons ok={ok} reason={reason} onSaveNew={() => save(true)} editing={!!edit} />
    </form>
  );
}

/** Vadeli mevduat → net varlığa "kilitli varlık" olarak accrue eder; opsiyonel hesaptan anapara düşer */
export function DepositForm({ data, reload, onClose, edit }: FormProps & { edit?: Deposit }) {
  const [f, setF] = useState(() => edit
    ? {
      name: edit.name, principal: String(edit.principal), rate: String(edit.rate),
      term_days: String(edit.term_days), withholding: edit.withholding ? String(edit.withholding) : "",
      open_date: edit.open_date, account_id: edit.account_id != null ? String(edit.account_id) : "",
    }
    : { name: "", principal: "", rate: "", term_days: "", withholding: "", open_date: todayStr(), account_id: "" });
  const nameRef = useRef<HTMLInputElement>(null);
  const ok = !!f.name && num(f.principal) > 0 && num(f.rate) >= 0 && +f.term_days >= 1 && !!f.open_date;
  const reason = !f.name ? "Ad gerekli" : !(num(f.principal) > 0) ? "Anapara 0'dan büyük olmalı"
    : !(+f.term_days >= 1) ? "Gün sayısı en az 1 olmalı" : !(num(f.rate) >= 0) ? "Faiz oranı geçersiz" : null;
  /* canlı önizleme için geçici mevduat nesnesi */
  const preview: Deposit | null = ok ? {
    id: 0, name: f.name, principal: num(f.principal), rate: num(f.rate),
    open_date: f.open_date, term_days: +f.term_days, withholding: num(f.withholding),
  } : null;
  const save = async (andNew: boolean) => {
    if (!ok) return;
    const body = {
      name: f.name, principal: num(f.principal), rate: num(f.rate), open_date: f.open_date,
      term_days: +f.term_days, withholding: num(f.withholding),
      account_id: f.account_id ? +f.account_id : null,
    };
    if (edit) { await api.put(`deposits/${edit.id}`, body); reload(); onClose(); return; }
    await api.post("deposits", body);
    reload();
    if (andNew) { setF({ ...f, name: "", principal: "", rate: "", term_days: "" }); nameRef.current?.focus(); } else onClose();
  };
  const acc = f.account_id ? data.accounts.find((a) => a.id === +f.account_id) : null;
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Field label="Ad" flex={2}><input ref={nameRef} autoFocus style={css.input} value={f.name} placeholder="örn. Vakıfbank 32 gün" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <AmountField label="Anapara (TL)" value={f.principal} onChange={(v) => setF({ ...f, principal: v })} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <Field label="Faiz oranı (yıllık %)"><input style={css.input} inputMode="decimal" placeholder="örn. 45" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></Field>
        <Field label="Vade (gün)"><input style={css.input} inputMode="numeric" placeholder="örn. 32" value={f.term_days} onChange={(e) => setF({ ...f, term_days: e.target.value })} /></Field>
        <Field label="Stopaj (%, ops.)"><input style={css.input} inputMode="decimal" placeholder="0" value={f.withholding} onChange={(e) => setF({ ...f, withholding: e.target.value })} /></Field>
        <Field label="Açılış tarihi"><input type="date" style={css.input} value={f.open_date} onChange={(e) => setF({ ...f, open_date: e.target.value })} /></Field>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <Field label="Nakit hesap (opsiyonel)" flex={2}>
          <select style={css.input} value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value })}>
            <option value="">— (bakiyeye işleme)</option>
            {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
      </div>
      {preview && (
        <div style={{ fontSize: 12, color: T.mut, marginTop: 10, background: T.panel2, borderRadius: 8, padding: "10px 12px", display: "grid", gap: 4 }}>
          <div>Vade tarihi: <span style={{ ...css.mono, color: T.text }}>{fmtD(depositMaturity(preview), { day: "numeric", month: "long", year: "numeric" })}</span></div>
          <div>Brüt faiz: <span style={{ ...css.mono, color: T.text }}>{fmtMoney(depositGrossInterest(preview), "TRY", true)}</span>
            {num(f.withholding) > 0 && <> · net: <span style={{ ...css.mono, color: T.pos }}>{fmtMoney(depositNetInterest(preview), "TRY", true)}</span></>}</div>
          <div>Vade sonunda: <span style={{ ...css.mono, color: T.pos, fontWeight: 700 }}>{fmtMoney(depositMaturityValue(preview), "TRY", true)}</span></div>
          {acc && <div><b>{acc.name}</b> bakiyesinden <span style={{ color: T.neg }}>−{fmtMoney(num(f.principal), "TRY", true)}</span> düşülür (silinirse geri döner)</div>}
        </div>
      )}
      {edit && (
        <div style={{ fontSize: 12, color: T.mut, marginTop: 8, background: T.panel2, borderRadius: 8, padding: "8px 12px" }}>
          Mevduat düzenleniyor: hesaba olan anapara etkisi otomatik düzeltilir (eskisi geri alınır,
          yenisi işlenir) — hesabı değiştirsen bile doğru. Faiz ve vade değeri yeni değerlerden hesaplanır.
        </div>
      )}
      <SaveButtons ok={ok} reason={reason} onSaveNew={() => save(true)} editing={!!edit} />
    </form>
  );
}

/** Virman (Faz 16) — kendi hesapların arası para hareketi. TEK kayıt iki bacağı birden yazar:
    kaynaktan düşer, hedefe ekler. Rapor'a girmez, net varlığı değiştirmez.
    Bu form olmadan kullanıcı iki sahte gelir/gider kaydı girmek zorundaydı — biri unutulunca
    bakiye kayar, Rapor'da olmayan bir gelir/gider görünürdü. */
export function TransferForm({ data, reload, onClose, edit }: FormProps & { edit?: Transfer }) {
  const [f, setF] = useState(() => edit
    ? {
      date: edit.date, from_account_id: String(edit.from_account_id),
      to_account_id: String(edit.to_account_id), amount: String(edit.amount), note: edit.note ?? "",
    }
    : { date: todayStr(), from_account_id: "", to_account_id: "", amount: "", note: "" });
  const amountRef = useRef<HTMLInputElement>(null);
  const from = f.from_account_id ? data.accounts.find((a) => a.id === +f.from_account_id) : null;
  const to = f.to_account_id ? data.accounts.find((a) => a.id === +f.to_account_id) : null;
  const amount = num(f.amount);
  const same = !!from && !!to && from.id === to.id;
  const ok = !!from && !!to && !same && amount > 0 && !!f.date;
  const reason = !from ? "Kaynak hesap seçilmeli" : !to ? "Hedef hesap seçilmeli"
    : same ? "Kaynak ve hedef hesap aynı olamaz" : !(amount > 0) ? "Tutar 0'dan büyük olmalı" : null;
  const save = async (andNew: boolean) => {
    if (!ok) return;
    const body = {
      date: f.date, from_account_id: +f.from_account_id, to_account_id: +f.to_account_id,
      amount, note: f.note.trim() || null,
    };
    if (edit) { await api.put(`transfers/${edit.id}`, body); reload(); onClose(); return; }
    await api.post("transfers", body);
    reload();
    if (andNew) { setF({ ...f, amount: "", note: "" }); amountRef.current?.focus(); } else onClose();
  };
  const swap = () => setF({ ...f, from_account_id: f.to_account_id, to_account_id: f.from_account_id });
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Field label="Tarih"><input type="date" style={css.input} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <AmountField label="Tutar (TL)" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} inputRef={amountRef} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "flex-end" }}>
        <Field label="Nereden" flex={2}>
          <select autoFocus style={css.input} value={f.from_account_id} onChange={(e) => setF({ ...f, from_account_id: e.target.value })}>
            <option value="">— seç —</option>
            {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {fmtMoney(a.balance, "TRY", true)}</option>)}
          </select>
        </Field>
        <button type="button" onClick={swap} title="Yönü değiştir"
          style={{ ...css.ghost, padding: "9px 12px", flexShrink: 0 }}>⇄</button>
        <Field label="Nereye" flex={2}>
          <select style={css.input} value={f.to_account_id} onChange={(e) => setF({ ...f, to_account_id: e.target.value })}>
            <option value="">— seç —</option>
            {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {fmtMoney(a.balance, "TRY", true)}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <Field label="Not (opsiyonel)" flex={2}>
          <input style={css.input} value={f.note} placeholder="örn. ATM çekimi, Midas'a aktarım"
            onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
      {ok && from && to && (
        <div style={{ fontSize: 12, color: T.mut, marginTop: 10, background: T.panel2, borderRadius: 8, padding: "10px 12px", display: "grid", gap: 4 }}>
          <div><b>{from.name}</b> <span style={{ color: T.neg }}>−{fmtMoney(amount, "TRY", true)}</span> → <span style={{ ...css.mono }}>{fmtMoney(from.balance - amount, "TRY", true)}</span></div>
          <div><b>{to.name}</b> <span style={{ color: T.pos }}>+{fmtMoney(amount, "TRY", true)}</span> → <span style={{ ...css.mono }}>{fmtMoney(to.balance + amount, "TRY", true)}</span></div>
          <div style={{ color: T.mut3 }}>Net varlığın değişmez; Rapor'a gelir/gider olarak girmez.</div>
          {from.balance - amount < 0 && <div style={{ color: T.neg }}>Uyarı: {from.name} bakiyesi eksiye düşüyor.</div>}
        </div>
      )}
      <SaveButtons ok={ok} reason={reason} onSaveNew={() => save(true)} editing={!!edit} />
    </form>
  );
}

/* ————— GİRİŞ MODU: ADET ⇄ TUTAR (Faz 17) —————
   Fonda kullanıcının kafasındaki sayı adet değil tutardır ("50 bin lira fona attım"); NAV ~0,043210
   olduğundan adedi elde hesaplamak hem zahmetli hem hataya açıktı. Tutar modunda tek sayı girilir,
   adet `qtyFromAmount` ile türetilir. Tutar = **hesaba giren/çıkan para** (bakiye etkisinin tersi),
   böylece "12.400 lazım" dendiğinde hesaba kuruşu kuruşuna 12.400 girer.
   Varsayılan mod varlık türüne göre: fonda tutar, hissede adet — çünkü hissede "50 lot" diye düşünülür. */
type TradeMode = "adet" | "tutar";
const defaultMode = (t: AssetType): TradeMode => (t === "FON" ? "tutar" : "adet");

/** Pozisyon olaylarının rengi ve tek cümlelik açıklaması (Faz 21) */
const SIDE_COLOR: Record<Trade["side"], string> = {
  "ALIŞ": T.pos, "SATIŞ": T.neg, "TEMETTÜ": "var(--cat-5)", "BEDELSİZ": "var(--cat-3)",
};
const SIDE_HINT: Record<Trade["side"], string> = {
  "ALIŞ": "Adet ve maliyet artar; hesap seçiliyse bakiyeden düşer.",
  "SATIŞ": "Adet azalır; kâr/zarar gerçekleşir, hesap seçiliyse bakiyeye girer.",
  "TEMETTÜ": "Adedin ve ortalama maliyetin DEĞİŞMEZ; nakit girer ve gerçekleşen getiriye yazılır.",
  "BEDELSİZ": "Adet artar, toplam maliyet aynı kalır → ortalama maliyet düşer. Para hareketi yoktur.",
};

/** Özet'teki "fon boz" önerisinden gelen önden doldurma (Faz 17) */
export type TradePrefill = {
  asset_type: AssetType; symbol: string; side: Trade["side"]; amount: number;
  date?: string; account_id?: number | null;
};

/** Portföy işlemi (alış/satış) → pozisyonlara ve net varlığa yansır */
export function TradeForm({ data, reload, onClose, edit, prefill }: FormProps & { edit?: Trade; prefill?: TradePrefill }) {
  const [f, setF] = useState(() => edit
    ? {
      date: edit.date, asset_type: edit.asset_type, symbol: edit.symbol, side: edit.side,
      qty: String(edit.qty), amount: "", price: String(edit.price), fee: edit.fee ? String(edit.fee) : "",
      currency: edit.currency, account_id: edit.account_id != null ? String(edit.account_id) : "",
      portfolio_id: edit.portfolio_id != null ? String(edit.portfolio_id) : "",
    }
    : {
      date: prefill?.date ?? todayStr(),
      asset_type: prefill?.asset_type ?? ("BIST" as AssetType),
      symbol: prefill?.symbol ?? "",
      side: prefill?.side ?? ("ALIŞ" as Trade["side"]),
      qty: "", amount: prefill ? String(prefill.amount) : "",
      price: prefill ? String(priceOf(data, prefill.symbol, prefill.asset_type) ?? "") : "",
      fee: "", currency: defaultCcy(prefill?.asset_type ?? "BIST") as Currency,
      account_id: prefill?.account_id != null ? String(prefill.account_id) : "",
      // portföy grubu: son kullanılan grup varsayılan gelir (art arda giriş)
      portfolio_id: (() => { const p = lastUsedPortfolio(data); return p != null ? String(p) : ""; })(),
    });
  /* Düzenlemede kayıt adet taşır → adet modu; yenisinde varlık türünün doğal modu (öneriden gelen tutarlı) */
  const [mode, setMode] = useState<TradeMode>(() => edit ? "adet" : prefill ? "tutar" : defaultMode(f.asset_type));
  const symbolRef = useRef<HTMLInputElement>(null);
  const sugs = useMemo(() => symbolSuggestions(data), [data]);
  /** Sembolün güncel fiyatı — para birimi eşleşiyorsa doldurulabilir (USD fiyatı TL alanına yazılmasın) */
  const livePrice = f.symbol && priceCcyOf(data, f.symbol, f.asset_type) === f.currency
    ? priceOf(data, f.symbol, f.asset_type) : null;
  /** Elde tutulan miktar — SATIŞ'ta "tümünü sat" için */
  const held = f.symbol ? heldQty(data.trades, f.symbol, f.asset_type) : 0;
  /** geçmişten seçildi: varlık türü/para birimi/hesap hatırlanır, birim fiyat güncel fiyattan dolar */
  const pickSymbol = (s: SymbolSuggestion) => setF((x) => ({
    ...x, symbol: s.symbol, asset_type: s.asset_type, currency: s.currency,
    account_id: s.account_id != null ? String(s.account_id) : x.account_id,
    portfolio_id: s.portfolio_id != null ? String(s.portfolio_id) : x.portfolio_id,
    price: s.price != null && priceCcyOf(data, s.symbol, s.asset_type) === s.currency ? String(s.price) : x.price,
  }));
  /* ————— Türe göre adet/fiyat çözümü (Faz 21) —————
     Üç ayrı ilişki var, hepsi `qty × price` üzerinden ama bilinmeyen farklı:
     - ALIŞ/SATIŞ + tutar modu → ADET türetilir (tutar ve birim fiyat biliniyor)
     - TEMETTÜ    + tutar modu → HİSSE BAŞINA türetilir; adet zaten elindeki hisse sayısıdır
                                 ("hesabıma 45,30 ₺ temettü girdi" — hisse başınayı kimse bilmez)
     - BEDELSİZ                → fiyat her zaman 0, para hareketi yok; yalnız adet girilir */
  const isDividend = f.side === "TEMETTÜ", isBonus = f.side === "BEDELSİZ";
  const fee = isBonus ? 0 : num(f.fee);
  const qty = (!isBonus && !isDividend && mode === "tutar")
    ? qtyFromAmount(f.side, num(f.amount), num(f.price), fee)
    : num(f.qty);
  const price = isBonus ? 0
    : (isDividend && mode === "tutar")
      ? (qty > 0 ? (num(f.amount) + fee) / qty : 0)
      : num(f.price);
  /** Toplam tutar (hesaba giren/çıkan) — önizleme ve mod geçişinde kullanılır */
  const total = isBonus ? 0 : Math.abs(cashDelta({ side: f.side, qty, price, fee }));
  /** Mod değişiminde girilen değer korunur (aynı işlemin iki farklı ifadesi) */
  const switchMode = (m: TradeMode) => {
    if (m === mode) return;
    if (m === "tutar") setF((x) => ({ ...x, amount: total > 0 ? String(+total.toFixed(2)) : "", qty: qty > 0 ? String(qty) : x.qty }));
    else setF((x) => ({ ...x, qty: qty > 0 ? String(qty) : "", price: price > 0 ? String(+price.toFixed(6)) : x.price }));
    setMode(m);
  };
  const ok = !!f.symbol && qty > 0 && (isBonus || price > 0) && !!f.date;
  const reason = !f.symbol ? "Sembol gerekli"
    : !(qty > 0) ? (isDividend ? "Temettü ödenen hisse adedi gerekli"
      : isBonus ? "Gelen bedelsiz hisse adedi gerekli"
        : mode === "tutar" ? "Tutar 0'dan büyük olmalı (komisyonu aşmalı)" : "Adet/miktar 0'dan büyük olmalı")
      : !isBonus && !(price > 0) ? (isDividend && mode === "tutar" ? "Temettü tutarı 0'dan büyük olmalı" : "Birim fiyat 0'dan büyük olmalı")
        : null;
  const save = async (andNew: boolean) => {
    if (!ok) return;
    const body = {
      ...f, symbol: f.symbol.trim(), qty, price, fee, currency: f.currency,
      account_id: f.currency === "TRY" && f.account_id ? +f.account_id : null,
      portfolio_id: f.portfolio_id ? +f.portfolio_id : null,
    };
    if (edit) { await api.put(`trades/${edit.id}`, body); reload(); onClose(); return; }
    await api.post("trades", body);
    reload();
    if (andNew) { setF({ ...f, symbol: "", qty: "", amount: "", price: "", fee: "" }); symbolRef.current?.focus(); } else onClose();
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Field label="Tarih"><input type="date" style={css.input} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Varlık türü">
          <select style={css.input} value={f.asset_type}
            onChange={(e) => {
              const at = e.target.value as AssetType;
              setF({ ...f, asset_type: at, symbol: "", currency: defaultCcy(at) });
              if (!edit) setMode(defaultMode(at)); // tür değişince o türün doğal giriş modu
            }}>
            {(["BIST", "FON", "ALTIN", "DOVIZ", "KRIPTO", "ETF"] as AssetType[]).map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Para birimi">
          <select style={css.input} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency })}>
            <option value="TRY">₺ TRY</option><option value="USD">$ USD</option>
          </select>
        </Field>
        <Field label="Sembol">
          <SuggestInput autoFocus inputRef={symbolRef} style={{ textTransform: "uppercase" }} placeholder={TYPE_HINT[f.asset_type]}
            value={f.symbol} onChange={(v) => setF({ ...f, symbol: v.toUpperCase() })}
            onPick={pickSymbol} options={sugs} labelOf={(s) => s.symbol}
            subOf={(s) => s.price != null ? `${s.asset_type} · ${fmtMoney(s.price, s.currency, true)}` : s.asset_type} />
        </Field>
        {/* Dört pozisyon olayı (Faz 21). Temettü/bedelsiz de bu deftere yazılır: ikisi de
            pozisyonun geçmişinin parçasıdır, ayrı bir yerde tutmak hikâyeyi bölerdi. */}
        <Field label="İşlem" flex={2}>
          <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: `1px solid ${T.line}` }}>
            {(["ALIŞ", "SATIŞ", "TEMETTÜ", "BEDELSİZ"] as const).map((s) => (
              <button key={s} type="button" title={SIDE_HINT[s]}
                onClick={() => { setF({ ...f, side: s }); if (s === "BEDELSİZ") setMode("adet"); }} style={{
                  flex: 1, padding: "9px 2px", border: "none", cursor: "pointer", fontWeight: 700,
                  fontSize: 10.5, fontFamily: T.disp, letterSpacing: "-0.01em",
                  background: f.side === s ? SIDE_COLOR[s] : T.panel2,
                  color: f.side === s ? T.accInk : T.mut,
                }}>{s}</button>
            ))}
          </div>
        </Field>
      </div>
      <div style={{ fontSize: 11.5, color: T.mut, marginTop: 6 }}>{SIDE_HINT[f.side]}</div>
      {/* Giriş modu: fonda tutar ("50 bin lira attım"), hissede adet ("50 lot aldım").
          Bedelsizde para hareketi olmadığından mod seçimi anlamsız — gizlenir. */}
      {!isBonus && (
        <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center" }}>
          <span style={{ ...css.label, marginBottom: 0 }}>Giriş</span>
          {(["adet", "tutar"] as TradeMode[]).map((m) => (
            <button key={m} type="button" onClick={() => switchMode(m)} style={{
              ...css.chip, fontWeight: 600,
              ...(mode === m ? { background: T.acc, color: T.accInk, borderColor: T.acc } : {}),
            }}>{m === "adet"
              ? (isDividend ? "Hisse başına gir" : "Adet gir")
              : (isDividend ? "Toplam tutar gir" : "Tutar gir")}</button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        {/* Temettü ve bedelsizde adet HER ZAMAN elle girilir (elindeki hisse sayısı) */}
        {(isDividend || isBonus || mode === "adet") && (
          <Field label={isDividend ? "Temettü ödenen adet" : isBonus ? "Gelen bedelsiz adet" : "Adet / Miktar"}>
            <input style={css.input} inputMode="decimal" placeholder="0" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
          </Field>
        )}
        {mode === "tutar" && !isBonus && (
          <AmountField ccy={f.currency} value={f.amount} onChange={(v) => setF({ ...f, amount: v })}
            label={isDividend ? `Hesaba giren toplam (${f.currency === "USD" ? "$" : "TL"})`
              : f.side === "SATIŞ" ? `Hesaba girecek (${f.currency === "USD" ? "$" : "TL"})`
                : `Hesaptan çıkacak (${f.currency === "USD" ? "$" : "TL"})`} />
        )}
        {!isBonus && !(isDividend && mode === "tutar") && (
          <AmountField label={isDividend ? `Hisse başına net (${f.currency === "USD" ? "$" : "TL"})` : `Birim fiyat (${f.currency === "USD" ? "$" : "TL"})`}
            value={f.price} onChange={(v) => setF({ ...f, price: v })} ccy={f.currency} />
        )}
        {!isBonus && (
          <AmountField label={isDividend ? `Stopaj / kesinti (${f.currency === "USD" ? "$" : "TL"})` : `Komisyon (${f.currency === "USD" ? "$" : "TL"})`}
            value={f.fee} onChange={(v) => setF({ ...f, fee: v })} ccy={f.currency} />
        )}
      </div>
      {/* Türetilen değer görünür olmalı: kaydedilen sayı bu */}
      {mode === "tutar" && !isBonus && qty > 0 && price > 0 && (
        <div style={{ fontSize: 12, color: T.mut, marginTop: 6 }}>
          {isDividend
            ? <>Hisse başına: <span style={{ ...css.mono, color: T.text }}>{fmtMoney(price, f.currency, true)}</span>{" "}
              <span style={{ color: T.mut3 }}>({fmtMoney(num(f.amount) + fee, f.currency, true)} ÷ {qty.toLocaleString("tr-TR")} adet)</span></>
            : <>Kaydedilecek adet: <span style={{ ...css.mono, color: T.text }}>{qty.toLocaleString("tr-TR", { maximumFractionDigits: 6 })}</span>{" "}
              <span style={{ color: T.mut3 }}>({fmtMoney(num(f.amount), f.currency, true)} ÷ {fmtMoney(price, f.currency, true)})</span></>}
        </div>
      )}
      {/* tek tık doldurmalar: güncel piyasa fiyatı, elde tutulan miktar (satış/temettü/bedelsizde) */}
      {((livePrice != null && !isBonus && !isDividend) || (held > 0 && (f.side === "SATIŞ" || isDividend || isBonus))) && (
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          {livePrice != null && !isBonus && !isDividend && String(livePrice) !== f.price && (
            <button type="button" style={css.chip} onClick={() => setF({ ...f, price: String(livePrice) })}>
              Güncel fiyat: {fmtMoney(livePrice, f.currency, true)}
            </button>
          )}
          {f.side === "SATIŞ" && held > 0 && (
            <button type="button" style={css.chip} onClick={() => mode === "tutar"
              ? setF({ ...f, amount: String(+amountFromQty("SATIŞ", held, price, fee).toFixed(2)) })
              : setF({ ...f, qty: String(held) })}>
              Tümünü sat: {mode === "tutar" && price > 0 ? fmtMoney(amountFromQty("SATIŞ", held, price, fee), f.currency, true) : held}
            </button>
          )}
          {/* Temettü neredeyse her zaman elindeki TÜM hisselere ödenir; bedelsizde oran hesabı için lazım */}
          {(isDividend || isBonus) && held > 0 && String(held) !== f.qty && (
            <button type="button" style={css.chip} onClick={() => setF({ ...f, qty: String(held) })}>
              Elimdeki adet: {held.toLocaleString("tr-TR")}
            </button>
          )}
          {isBonus && held > 0 && [50, 100, 200].map((pct) => (
            <button key={pct} type="button" style={css.chip}
              onClick={() => setF({ ...f, qty: String(+(held * pct / 100).toFixed(6)) })}>
              %{pct} bedelsiz
            </button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        {/* Bedelsizde para hareketi yok → hesap alanı gizlenir (seçilse de sunucu 0 uygular) */}
        {f.currency === "TRY" && !isBonus && (
          <Field label="Nakit hesap (opsiyonel)" flex={2}>
            <select style={css.input} value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value })}>
              <option value="">— (bakiyeye işleme)</option>
              {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        )}
        {/* Portföy grubu: yalnız raporlama/gruplama — pozisyon matematiğini veya net varlığı değiştirmez */}
        <Field label="Portföy (opsiyonel)" flex={2}>
          <select style={css.input} value={f.portfolio_id} onChange={(e) => setF({ ...f, portfolio_id: e.target.value })}>
            <option value="">Gruplanmamış</option>
            {data.portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </div>
      {ok && (
        <div style={{ fontSize: 12, color: T.mut, marginTop: 8 }}>
          {isBonus ? (() => {
            /* Bedelsizde asıl merak edilen: adet ne olur, ortalama maliyet kaça düşer.
               Toplam maliyet sabit kaldığından pozisyonun DEĞERİ değişmez — bunu açıkça söylüyoruz,
               çünkü "ortalamam düştü, kâra geçtim" en yaygın yanlış okumadır. */
            const pos = positions(data.trades.filter((t) => t.symbol.toUpperCase() === f.symbol.trim().toUpperCase() && t.asset_type === f.asset_type), []);
            const cur = pos[0];
            if (!cur || cur.qty <= 0) return <>Bedelsiz kaydedilecek: <span style={{ ...css.mono, color: T.text }}>{qty.toLocaleString("tr-TR")} adet</span></>;
            const newQty = cur.qty + qty, newAvg = (cur.avg * cur.qty) / newQty;
            return (<>
              Adet <span style={css.mono}>{cur.qty.toLocaleString("tr-TR")}</span> → <span style={{ ...css.mono, color: T.text }}>{newQty.toLocaleString("tr-TR")}</span>
              {" · "}ort. maliyet <span style={css.mono}>{fmtMoney(cur.avg, f.currency, true)}</span> → <span style={{ ...css.mono, color: T.acc }}>{fmtMoney(newAvg, f.currency, true)}</span>
              <div style={{ marginTop: 4, color: T.mut3 }}>Toplam maliyet ve pozisyon değeri değişmez — yalnız aynı para daha çok hisseye dağılır.</div>
            </>);
          })() : (<>
            {isDividend ? "Toplam temettü: " : "İşlem tutarı: "}
            <span style={{ ...css.mono, color: T.text }}>{fmtMoney(qty * price, f.currency, true)}</span>
            {isDividend && <div style={{ marginTop: 4, color: T.mut3 }}>Adedin ve ortalama maliyetin değişmez; tutar gerçekleşen getiriye yazılır.</div>}
            {f.currency === "TRY" && f.account_id && (() => {
              const acc = data.accounts.find((a) => a.id === +f.account_id);
              if (!acc) return null;
              const delta = cashDelta({ side: f.side, qty, price, fee });
              return (
                <div style={{ marginTop: 4 }}>
                  {delta >= 0
                    ? <><b>{acc.name}</b> bakiyesine <span style={{ color: T.pos }}>+{fmtMoney(delta, "TRY", true)}</span> işlenir</>
                    : <><b>{acc.name}</b> bakiyesinden <span style={{ color: T.neg }}>−{fmtMoney(-delta, "TRY", true)}</span> düşülür</>}
                </div>
              );
            })()}
          </>)}
        </div>
      )}
      {edit && (
        <div style={{ fontSize: 12, color: T.mut, marginTop: 8, background: T.panel2, borderRadius: 8, padding: "8px 12px" }}>
          İşlem düzenleniyor: pozisyon ve ortalama maliyet baştan hesaplanır. Hesaba bağlıysa bakiye etkisi de
          otomatik düzeltilir (eskisi geri alınır, yenisi işlenir).
        </div>
      )}
      <SaveButtons ok={ok} reason={reason} onSaveNew={() => save(true)} editing={!!edit} />
    </form>
  );
}
