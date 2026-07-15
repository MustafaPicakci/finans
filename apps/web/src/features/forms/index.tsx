import React, { useEffect, useRef, useState } from "react";
import {
  todayStr, num, fmtD,
  depositMaturity, depositGrossInterest, depositNetInterest, depositMaturityValue,
  type AllData, type AssetType, type Currency, type Deposit, type Recurring, type Trade,
} from "@finans/engine";
import { api } from "../../api";
import { T, css, fmtMoney, TYPE_HINT } from "../../theme";
import { Field, AmountField, Hint } from "../../ui";

/** Varlık türünün doğal para birimi: yurt dışı borsa (KRIPTO/ETF) USD, diğerleri TRY */
const defaultCcy = (t: AssetType): Currency => (t === "KRIPTO" || t === "ETF" ? "USD" : "TRY");

/* ————— GLOBAL "+ EKLE" AKIŞININ FORMLARI —————
   Her form modal içinde yaşar: "Kaydet" kaydedip kapatır, "Kaydet, yeni ekle"
   kaydedip formu sıfırlar ve odağı ilk alana döndürür (art arda giriş). */

export type AddKind = "kalem" | "cardtx" | "recurring" | "loan" | "trade" | "deposit";
type FormProps = { data: AllData; reload: () => void; onClose: () => void };
/** Plan'daki ileri tarihli kalemi "Gerçekleşti" ile deftere geçirirken önden doldurma */
export type KalemPrefill = { name: string; amount: number; type: "gider" | "gelir"; oneoffId: number };

/** Kaydet (kapat) + Kaydet-yeni-ekle buton çifti */
function SaveButtons({ ok, reason, onSaveNew }: { ok: boolean; reason: string | null; onSaveNew: () => void }) {
  return (<>
    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
      <button type="submit" style={{ ...css.btn, opacity: ok ? 1 : 0.4 }} disabled={!ok}>Kaydet</button>
      <button type="button" style={{ ...css.ghost, opacity: ok ? 1 : 0.4 }} disabled={!ok} onClick={onSaveNew}>Kaydet, yeni ekle</button>
    </div>
    {reason && <Hint>{reason}</Hint>}
  </>);
}

/** Gelir/gider kalemi — tarihe göre otomatik yönlendirilir:
    bugün/geçmiş → gerçekleşen kayıt (transactions; hesaba bağlıysa bakiyeye işler, Rapor'a girer),
    ileri tarih → plan kalemi (oneoffs; nakit projeksiyonuna girer). */
export function KalemForm({ data, reload, onClose, prefill }: FormProps & { prefill?: KalemPrefill }) {
  const [tx, setTx] = useState({
    date: todayStr(), name: prefill?.name ?? "", amount: prefill ? String(prefill.amount) : "",
    type: prefill?.type ?? "gider", category_id: "", account_id: data.accounts[0] ? String(data.accounts[0].id) : "",
  });
  const nameRef = useRef<HTMLInputElement>(null);
  const future = tx.date > todayStr(); // ISO tarihte string karşılaştırması güvenli
  const ok = !!tx.name && num(tx.amount) > 0 && !!tx.date;
  const reason = !tx.name ? "Ad gerekli" : !(num(tx.amount) > 0) ? "Tutar 0'dan büyük olmalı" : !tx.date ? "Tarih gerekli" : null;
  const save = async (andNew: boolean) => {
    if (!ok) return;
    const amount = (tx.type === "gider" ? -1 : 1) * num(tx.amount);
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
        <Field label="Ad" flex={2}><input ref={nameRef} autoFocus style={css.input} value={tx.name} placeholder="örn. Migros" onChange={(e) => setTx({ ...tx, name: e.target.value })} /></Field>
        <AmountField label="Tutar (₺)" value={tx.amount} onChange={(v) => setTx({ ...tx, amount: v })} />
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
        {future
          ? "İleri tarihli → plan kalemi olarak kaydedilir: Nakit Akışı projeksiyonuna girer, günü gelince Plan'dan \"Gerçekleşti\" ile deftere geçirebilirsin."
          : tx.account_id
            ? "Gerçekleşen kayıt: seçili hesabın bakiyesine hemen işler ve Rapor'a girer."
            : "Gerçekleşen kayıt: hesap seçilmedi — sadece Rapor'a girer, bakiyeye dokunmaz."}
      </div>
      <SaveButtons ok={ok} reason={reason} onSaveNew={() => save(true)} />
    </form>
  );
}

/** Kart harcaması → ekstreye işlenir, son ödeme günü nakit akışına düşer */
export function CardTxForm({ data, reload, onClose }: FormProps) {
  const [tf, setTf] = useState({ card_id: 0, date: todayStr(), name: "", amount: "", installments: "1" });
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (data.cards.length === 1 && tf.card_id === 0) setTf((s) => ({ ...s, card_id: data.cards[0].id })); }, [data.cards]);
  const ok = tf.card_id > 0 && !!tf.name && num(tf.amount) > 0 && !!tf.date && +tf.installments >= 1;
  const reason = tf.card_id === 0 ? "Kart seçilmeli" : !tf.name ? "Açıklama gerekli" : !(num(tf.amount) > 0) ? "Tutar 0'dan büyük olmalı" : null;
  const save = async (andNew: boolean) => {
    if (!ok) return;
    await api.post("cardtxs", { card_id: tf.card_id, date: tf.date, name: tf.name, amount: num(tf.amount), installments: +tf.installments });
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
        <Field label="Açıklama" flex={2}><input ref={nameRef} autoFocus style={css.input} value={tf.name} placeholder="örn. Telefon" onChange={(e) => setTf({ ...tf, name: e.target.value })} /></Field>
        <AmountField label="Toplam tutar (₺)" value={tf.amount} onChange={(v) => setTf({ ...tf, amount: v })} />
        <Field label="Taksit"><input style={css.input} inputMode="numeric" placeholder="1" value={tf.installments} onChange={(e) => setTf({ ...tf, installments: e.target.value })} /></Field>
      </div>
      {ok && +tf.installments > 1 && (
        <div style={{ fontSize: 12, color: T.mut, marginTop: 8 }}>
          aylık pay: <span style={{ ...css.mono, color: T.text }}>{fmtMoney(num(tf.amount) / +tf.installments, "TRY", true)}</span> × {tf.installments}
        </div>
      )}
      <SaveButtons ok={ok} reason={reason} onSaveNew={() => save(true)} />
    </form>
  );
}

/** Düzenli gelir/gider → her ay tekrarlar, nakit projeksiyonuna girer */
export function RecurringForm({ reload, onClose }: FormProps) {
  const [rec, setRec] = useState({ kind: "income" as Recurring["kind"], name: "", amount: "", day: "", from_month: "", to_month: "" });
  const nameRef = useRef<HTMLInputElement>(null);
  const ok = !!rec.name && num(rec.amount) > 0 && +rec.day >= 1 && +rec.day <= 31;
  const reason = !rec.name ? "Ad gerekli" : !(num(rec.amount) > 0) ? "Tutar 0'dan büyük olmalı" : !(+rec.day >= 1 && +rec.day <= 31) ? "Gün 1-31 arası olmalı" : null;
  const save = async (andNew: boolean) => {
    if (!ok) return;
    await api.post("recurring", {
      kind: rec.kind, name: rec.name, amount: num(rec.amount), day: +rec.day,
      from_month: rec.from_month || null, to_month: rec.to_month || null,
    });
    reload();
    if (andNew) { setRec({ ...rec, name: "", amount: "", day: "" }); nameRef.current?.focus(); } else onClose();
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Field label="Tür">
          <select style={css.input} value={rec.kind} onChange={(e) => setRec({ ...rec, kind: e.target.value as Recurring["kind"] })}>
            <option value="income">Gelir</option><option value="expense">Gider</option>
          </select>
        </Field>
        <Field label="Ad" flex={2}><input ref={nameRef} autoFocus style={css.input} value={rec.name} placeholder="örn. Maaş" onChange={(e) => setRec({ ...rec, name: e.target.value })} /></Field>
        <AmountField label="Tutar (₺)" value={rec.amount} onChange={(v) => setRec({ ...rec, amount: v })} />
        <Field label="Gün (1-31)"><input style={css.input} inputMode="numeric" placeholder="1" value={rec.day} onChange={(e) => setRec({ ...rec, day: e.target.value })} /></Field>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <Field label="Başlangıç ayı (ops.)"><input type="month" style={css.input} value={rec.from_month} onChange={(e) => setRec({ ...rec, from_month: e.target.value })} /></Field>
        <Field label="Bitiş ayı (ops.)"><input type="month" style={css.input} value={rec.to_month} onChange={(e) => setRec({ ...rec, to_month: e.target.value })} /></Field>
      </div>
      <SaveButtons ok={ok} reason={reason} onSaveNew={() => save(true)} />
    </form>
  );
}

/** Kredi/taksit → kalan taksitler nakit projeksiyonuna girer */
export function LoanForm({ reload, onClose }: FormProps) {
  const [f, setF] = useState({ name: "", amount: "", first_date: todayStr(), total: "" });
  const nameRef = useRef<HTMLInputElement>(null);
  const ok = !!f.name && num(f.amount) > 0 && !!f.first_date && +f.total >= 1;
  const reason = !f.name ? "Ad gerekli" : !(num(f.amount) > 0) ? "Aylık taksit 0'dan büyük olmalı" : !(+f.total >= 1) ? "Toplam taksit en az 1 olmalı" : null;
  const save = async (andNew: boolean) => {
    if (!ok) return;
    await api.post("loans", { name: f.name, amount: num(f.amount), first_date: f.first_date, total: +f.total });
    reload();
    if (andNew) { setF({ name: "", amount: "", first_date: f.first_date, total: "" }); nameRef.current?.focus(); } else onClose();
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Field label="Ad" flex={2}><input ref={nameRef} autoFocus style={css.input} value={f.name} placeholder="örn. İhtiyaç kredisi" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <AmountField label="Aylık taksit (₺)" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
        <Field label="İlk taksit tarihi"><input type="date" style={css.input} value={f.first_date} onChange={(e) => setF({ ...f, first_date: e.target.value })} /></Field>
        <Field label="Toplam taksit"><input style={css.input} inputMode="numeric" placeholder="12" value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} /></Field>
      </div>
      <SaveButtons ok={ok} reason={reason} onSaveNew={() => save(true)} />
    </form>
  );
}

/** Vadeli mevduat → net varlığa "kilitli varlık" olarak accrue eder; opsiyonel hesaptan anapara düşer */
export function DepositForm({ data, reload, onClose }: FormProps) {
  const [f, setF] = useState({
    name: "", principal: "", rate: "", term_days: "", withholding: "", open_date: todayStr(), account_id: "",
  });
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
    await api.post("deposits", {
      name: f.name, principal: num(f.principal), rate: num(f.rate), open_date: f.open_date,
      term_days: +f.term_days, withholding: num(f.withholding),
      account_id: f.account_id ? +f.account_id : null,
    });
    reload();
    if (andNew) { setF({ ...f, name: "", principal: "", rate: "", term_days: "" }); nameRef.current?.focus(); } else onClose();
  };
  const acc = f.account_id ? data.accounts.find((a) => a.id === +f.account_id) : null;
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Field label="Ad" flex={2}><input ref={nameRef} autoFocus style={css.input} value={f.name} placeholder="örn. Vakıfbank 32 gün" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <AmountField label="Anapara (₺)" value={f.principal} onChange={(v) => setF({ ...f, principal: v })} />
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
      <SaveButtons ok={ok} reason={reason} onSaveNew={() => save(true)} />
    </form>
  );
}

/** Portföy işlemi (alış/satış) → pozisyonlara ve net varlığa yansır */
export function TradeForm({ data, reload, onClose }: FormProps) {
  const [f, setF] = useState({
    date: todayStr(), asset_type: "BIST" as AssetType, symbol: "", side: "ALIŞ" as Trade["side"],
    qty: "", price: "", fee: "", currency: "TRY" as Currency, account_id: "",
  });
  const symbolRef = useRef<HTMLInputElement>(null);
  const ok = !!f.symbol && num(f.qty) > 0 && num(f.price) > 0 && !!f.date;
  const reason = !f.symbol ? "Sembol gerekli" : !(num(f.qty) > 0) ? "Adet/miktar 0'dan büyük olmalı" : !(num(f.price) > 0) ? "Birim fiyat 0'dan büyük olmalı" : null;
  const save = async (andNew: boolean) => {
    if (!ok) return;
    await api.post("trades", { ...f, symbol: f.symbol.trim(), qty: num(f.qty), price: num(f.price), fee: num(f.fee), currency: f.currency, account_id: f.currency === "TRY" && f.account_id ? +f.account_id : null });
    reload();
    if (andNew) { setF({ ...f, symbol: "", qty: "", price: "", fee: "" }); symbolRef.current?.focus(); } else onClose();
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Field label="Tarih"><input type="date" style={css.input} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Varlık türü">
          <select style={css.input} value={f.asset_type}
            onChange={(e) => { const at = e.target.value as AssetType; setF({ ...f, asset_type: at, symbol: "", currency: defaultCcy(at) }); }}>
            {(["BIST", "FON", "ALTIN", "DOVIZ", "KRIPTO", "ETF"] as AssetType[]).map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Para birimi">
          <select style={css.input} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency })}>
            <option value="TRY">₺ TRY</option><option value="USD">$ USD</option>
          </select>
        </Field>
        <Field label="Sembol">
          <input ref={symbolRef} autoFocus style={{ ...css.input, textTransform: "uppercase" }} placeholder={TYPE_HINT[f.asset_type]}
            value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="İşlem">
          <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: `1px solid ${T.line}` }}>
            {(["ALIŞ", "SATIŞ"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setF({ ...f, side: s })} style={{
                flex: 1, padding: "9px 0", border: "none", cursor: "pointer", fontWeight: 700, fontSize: 12, fontFamily: T.disp,
                background: f.side === s ? (s === "ALIŞ" ? T.pos : T.neg) : T.panel2,
                color: f.side === s ? T.accInk : T.mut,
              }}>{s}</button>
            ))}
          </div>
        </Field>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <Field label="Adet / Miktar"><input style={css.input} inputMode="decimal" placeholder="0" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
        <AmountField label={`Birim fiyat (${f.currency === "USD" ? "$" : "₺"})`} value={f.price} onChange={(v) => setF({ ...f, price: v })} ccy={f.currency} />
        <AmountField label={`Komisyon (${f.currency === "USD" ? "$" : "₺"})`} value={f.fee} onChange={(v) => setF({ ...f, fee: v })} ccy={f.currency} />
      </div>
      {f.currency === "TRY" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <Field label="Nakit hesap (opsiyonel)" flex={2}>
            <select style={css.input} value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value })}>
              <option value="">— (bakiyeye işleme)</option>
              {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        </div>
      )}
      {ok && (
        <div style={{ fontSize: 12, color: T.mut, marginTop: 8 }}>
          İşlem tutarı: <span style={{ ...css.mono, color: T.text }}>{fmtMoney(num(f.qty) * num(f.price), f.currency, true)}</span>
          {f.currency === "TRY" && f.account_id && (() => {
            const acc = data.accounts.find((a) => a.id === +f.account_id);
            if (!acc) return null;
            const proceeds = num(f.qty) * num(f.price) - num(f.fee);
            const cost = num(f.qty) * num(f.price) + num(f.fee);
            return (
              <div style={{ marginTop: 4 }}>
                {f.side === "SATIŞ"
                  ? <><b>{acc.name}</b> bakiyesine <span style={{ color: T.pos }}>+{fmtMoney(proceeds, "TRY", true)}</span> işlenir</>
                  : <><b>{acc.name}</b> bakiyesinden <span style={{ color: T.neg }}>−{fmtMoney(cost, "TRY", true)}</span> düşülür</>}
              </div>
            );
          })()}
        </div>
      )}
      <SaveButtons ok={ok} reason={reason} onSaveNew={() => save(true)} />
    </form>
  );
}
