import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  todayStr, num, fmtD, parseD, firstCutoff, dueOf, qtyFromAmount, amountFromQty, cashDelta, positions,
  depositMaturity, depositGrossInterest, depositNetInterest, depositMaturityValue,
  type AllData, type AssetType, type CardTx, type Currency, type Deposit, type OneOff, type Recurring,
  type Trade, type Transaction, type Transfer, type Loan,
  dripAcikMi, dripToggle, bedelliPlan, openPositions, balancesByAccount,
} from "@finans/engine";
import { api } from "../../api";
import { KategoriAlani } from "./KategoriAlani";
import { T, css, fmtMoney, TYPE_HINT } from "../../theme";
import { SuggestInput, Empty } from "../../ui";
import {
  girdi, girdiMono, Bolum, Etiketli, Segment, TutarGirdisi, Satirlar, SatirSec, SatirTarih, SatirMetin, Anahtar, Sayac,
  Cipler, Doldur, FormAlt, kisaGun, Vurgu,
} from "./parcalar";
import {
  kalemSuggestions, cardTxSuggestions, symbolSuggestions, priceOf, priceCcyOf, heldQty, lastUsedPortfolio,
  type KalemSuggestion, type CardTxSuggestion, type SymbolSuggestion,
} from "./recall";

/** Varlık türünün doğal para birimi: yurt dışı borsa (KRIPTO/ETF) USD, diğerleri TRY */
const defaultCcy = (t: AssetType): Currency => (t === "KRIPTO" || t === "ETF" ? "USD" : "TRY");

/* ————— GLOBAL "+ EKLE" AKIŞININ FORMLARI —————
   Her form modal içinde yaşar: "Kaydet" kaydedip kapatır, "Kaydet, yeni ekle"
   kaydedip formu sıfırlar ve odağı ilk alana döndürür (art arda giriş). */

export type AddKind = "kalem" | "transfer" | "cardtx" | "recurring" | "loan" | "trade" | "bedelli" | "deposit" | "import";
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

/** Düzenlemede formun dibine (FormAlt) EditSheet'ten gelen "Sil" düğmesi */
type DuzenleProps = { sil?: React.ReactNode };

/** Gelir/gider kalemi — tarihe göre otomatik yönlendirilir:
    bugün/geçmiş → gerçekleşen kayıt (transactions; hesaba bağlıysa bakiyeye işler, gelir/gider defterine girer),
    ileri tarih → plan kalemi (oneoffs; nakit projeksiyonuna girer). */
export function KalemForm({ data, reload, onClose, prefill, edit, sil }: FormProps & DuzenleProps & {
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
  const reason = !(num(tx.amount) > 0) ? "Tutarı gir." : !tx.name ? "Ne için olduğunu yaz." : !tx.date ? "Tarih seç." : null;
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
  const gider = tx.type === "gider";
  const acc = tx.account_id ? data.accounts.find((a) => a.id === +tx.account_id) : null;
  const cat = tx.category_id ? data.categories.find((c) => c.id === +tx.category_id) : null;
  /* Eskiden formun dibinde genel kuralı anlatan bir bilgi kutusu vardı; şimdi SOMUT sonuç: hangi
     hesaptan ne kadar, hangi kategoriye. Kural aynı (KalemForm'un yönlendirmesi değişmedi). */
  const sonuc = edit
    ? edit.kind === "oneoff"
      ? "Plan kalemi: değişiklik Nakit Akışı projeksiyonuna yansır. (Deftere geçirmek için Plan'daki “Gerçekleşti”.)"
      : "Kaydedince eski tutar ilgili hesaptan geri alınır, yenisi işlenir (hesabı değiştirsen bile)."
    : future
      ? "İleri tarih: plan kalemi olur, Nakit Akışı'na girer. Günü gelince Plan'dan “Gerçekleşti” ile deftere geçirirsin."
      : acc
        ? <><b>{acc.name}</b> {gider ? "bakiyesinden" : "bakiyesine"} <Vurgu v={num(tx.amount)} isaret={gider ? "−" : "+"} /> {gider ? "düşer" : "eklenir"}{cat ? <>, <b>{cat.name}</b> {gider ? "giderine" : "gelirine"} yazılır</> : null}.</>
        : "Hesap seçilmedi: yalnız gelir/gider kaydı olur, bakiyeye dokunmaz.";
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <Bolum>
        <Segment ad="Tür" deger={tx.type} sec={(v) => setTx({ ...tx, type: v, category_id: "" })}
          secenek={[{ v: "gider", l: "Gider", renk: T.neg }, { v: "gelir", l: "Gelir", renk: T.pos }]} />
        <TutarGirdisi value={tx.amount} onChange={(v) => setTx({ ...tx, amount: v })} renk={gider ? T.neg : T.pos} />
        <Etiketli etiket="Ne için?">
          <SuggestInput autoFocus inputRef={nameRef} value={tx.name} onChange={(v) => setTx({ ...tx, name: v })}
            onPick={pick} options={sugs} labelOf={(s) => s.name} style={girdi}
            subOf={(s) => `${fmtMoney(s.amount, "TRY", true)} · ${s.count}×`} placeholder="örn. Migros" />
        </Etiketli>
        <Satirlar>
          <SatirTarih value={tx.date} onChange={(v) => setTx({ ...tx, date: v })} />
          {!future && (
            <SatirSec etiket="Hesap" goruntu={acc ? acc.name : "Bakiyeye işleme"} soluk={!acc} value={tx.account_id}
              onChange={(v) => setTx({ ...tx, account_id: v })}>
              <option value="">— Bakiyeye işleme</option>
              {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </SatirSec>
          )}
          {!future && (
            <KategoriAlani satir data={data} reload={reload} value={tx.category_id}
              onChange={(v) => setTx({ ...tx, category_id: v })} kind={gider ? "expense" : "income"} />
          )}
        </Satirlar>
      </Bolum>
      <FormAlt sonuc={sonuc} ok={ok} reason={reason} onSaveNew={() => save(true)} editing={!!edit} sil={sil}
        etiket={edit ? "Değişikliği kaydet" : future ? "Plana ekle" : gider ? "Gideri kaydet" : "Geliri kaydet"} />
    </form>
  );
}

/** Kart harcaması → ekstreye işlenir, son ödeme günü nakit akışına düşer */
export function CardTxForm({ data, reload, onClose, prefill, edit, sil }: FormProps & DuzenleProps & { prefill?: CardTxPrefill; edit?: CardTx }) {
  const [tf, setTf] = useState(() => edit
    ? {
      card_id: edit.card_id, date: edit.date, name: edit.name, amount: String(edit.amount),
      installments: String(edit.installments), category_id: edit.category_id ? String(edit.category_id) : "",
    }
    : {
      card_id: prefill?.card_id ?? 0, date: todayStr(), name: prefill?.name ?? "",
      amount: prefill ? String(prefill.amount) : "", installments: String(prefill?.installments ?? 1),
      category_id: "",
    });
  const nameRef = useRef<HTMLInputElement>(null);
  const sugs = useMemo(() => cardTxSuggestions(data), [data]);
  /** geçmişten seçildi: tutar/kart/taksit/kategori son kaydından dolar */
  const pick = (s: CardTxSuggestion) =>
    setTf((t) => ({
      ...t, name: s.name, amount: String(s.amount), card_id: s.card_id, installments: String(s.installments),
      category_id: s.category_id != null ? String(s.category_id) : t.category_id,
    }));
  useEffect(() => { if (!edit && data.cards.length === 1 && tf.card_id === 0) setTf((s) => ({ ...s, card_id: data.cards[0].id })); }, [data.cards]);
  const ok = tf.card_id > 0 && !!tf.name && num(tf.amount) > 0 && !!tf.date && +tf.installments >= 1;
  const reason = tf.card_id === 0 ? "Kartı seç." : !(num(tf.amount) > 0) ? "Tutarı gir." : !tf.name ? "Ne aldığını yaz." : null;
  const save = async (andNew: boolean) => {
    if (!ok) return;
    const body = {
      card_id: tf.card_id, date: tf.date, name: tf.name, amount: num(tf.amount), installments: +tf.installments,
      category_id: tf.category_id ? +tf.category_id : null,
    };
    if (edit) { await api.put(`cardtxs/${edit.id}`, body); reload(); onClose(); return; }
    await api.post("cardtxs", body);
    reload();
    if (andNew) { setTf({ ...tf, name: "", amount: "", installments: "1" }); nameRef.current?.focus(); } else onClose();
  };
  const kart = data.cards.find((c) => c.id === tf.card_id);
  const taksit = Math.max(1, +tf.installments || 1);
  /* Hangi ekstreye düşer: motorun ekstre matematiğiyle (firstCutoff/dueOf — txShares'in kullandığı
     aynı fonksiyonlar). Eski formda bu yazmıyordu; kullanıcı ekstreyi Kartlar'da görünce öğreniyordu. */
  const kesim = kart && tf.date ? firstCutoff(parseD(tf.date), kart.statement_day) : null;
  const vade = kesim && kart ? dueOf(kesim, kart.due_day) : null;
  const sonuc = <>
    {kesim && vade && <>{kisaGun(kesim)} kesimli ekstreye düşer; {taksit > 1 ? "ilk taksit" : "son ödeme"} {kisaGun(vade)}.</>}
    {edit && " Tarih ya da taksit değişirse harcama yeniden doğru ekstrelere dağıtılır."}
  </>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <Bolum>
        {data.cards.length <= 4
          ? <Cipler ad="Kart" deger={tf.card_id} sec={(v) => setTf({ ...tf, card_id: v })} secenek={data.cards.map((c) => ({ v: c.id, l: c.name }))} />
          : (
            <Satirlar>
              <SatirSec etiket="Kart" goruntu={kart?.name ?? "Seç…"} soluk={!kart} value={tf.card_id} onChange={(v) => setTf({ ...tf, card_id: +v })}>
                <option value={0}>Seç…</option>
                {data.cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </SatirSec>
            </Satirlar>
          )}
        <TutarGirdisi etiket="Toplam tutar" value={tf.amount} onChange={(v) => setTf({ ...tf, amount: v })} renk={T.neg} />
        <Etiketli etiket="Ne aldın?">
          <SuggestInput autoFocus inputRef={nameRef} value={tf.name} onChange={(v) => setTf({ ...tf, name: v })}
            onPick={pick} options={sugs} labelOf={(s) => s.name} style={girdi}
            subOf={(s) => `${fmtMoney(s.amount, "TRY", true)} · ${s.count}×`} placeholder="örn. Telefon" />
        </Etiketli>
        <Sayac etiket="Taksit" value={tf.installments} onChange={(v) => setTf({ ...tf, installments: v })}
          alt={taksit > 1 && num(tf.amount) > 0 ? <>aylık <span style={{ fontFamily: T.mono, color: T.text }}>{fmtMoney(num(tf.amount) / taksit, "TRY", true)}</span> × {taksit}</> : null} />
        <Satirlar>
          <SatirTarih value={tf.date} onChange={(v) => setTf({ ...tf, date: v })} />
          {/* Faz 39 — kart harcamasının kategorisi (isteğe bağlı): girilmezse harcama özetinde
              "kategorisi girilmemiş" kovasında durur */}
          <KategoriAlani satir bos="seç (isteğe bağlı)" data={data} reload={reload} value={tf.category_id}
            onChange={(v) => setTf({ ...tf, category_id: v })} kind="expense" />
        </Satirlar>
      </Bolum>
      <FormAlt sonuc={sonuc} ok={ok} reason={reason} onSaveNew={() => save(true)} editing={!!edit} sil={sil}
        etiket={edit ? "Değişikliği kaydet" : "Harcamayı kaydet"} />
    </form>
  );
}

/** Düzenli gelir/gider → her ay tekrarlar, nakit projeksiyonuna girer.
    Opsiyonel hedef (hesap veya kart) bağlanırsa günü gelince Plan'dan "Gerçekleşti" ile (veya "otomatik"
    açıksa kendiliğinden) gerçek kayda dönüşür: hesap → transactions (bakiye + gelir/gider defteri), kart → o ayki ekstreye. */
export function RecurringForm({ data, reload, onClose, edit, sil }: FormProps & DuzenleProps & { edit?: Recurring }) {
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
  const reason = !edit && !(num(rec.amount) > 0) ? "Tutarı gir."
    : !rec.name ? "Ne olduğunu yaz (örn. Maaş, Kira)."
      : !(+rec.day >= 1 && +rec.day <= 31) ? "Ayın hangi günü? (1-31)" : null;
  const isAcc = rec.target.startsWith("acc:");
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
  const gelir = rec.kind === "income";
  const hedefAcc = isAcc ? data.accounts.find((a) => a.id === +rec.target.slice(4)) : null;
  const hedefKart = rec.target.startsWith("card:") ? data.cards.find((c) => c.id === +rec.target.slice(5)) : null;
  const tutar = num(rec.amount);
  const sonuc = <>
    {!rec.target
      ? "Hedef yok: yalnız Nakit Akışı tahminine girer, bakiyeye ve gelir/gider defterine dokunmaz."
      : hedefKart
        ? <>Her ayın {rec.day}. günü <b>{hedefKart.name}</b> kartına yazılır, o ayın ekstresiyle ödenir.</>
        : <>Her ayın {rec.day}. günü <b>{hedefAcc?.name}</b> {gelir ? "hesabına" : "hesabından"} {tutar > 0 ? <Vurgu v={tutar} isaret={gelir ? "+" : "−"} /> : null}; Nakit Akışı'na girer.</>}
    {rec.target && (rec.auto ? " Günü gelince kendiliğinden işlenir." : " Günü gelince Plan'dan “Gerçekleşti” ile işlenir.")}
  </>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <Bolum>
        <Segment ad="Tür" deger={rec.kind}
          sec={(kind) => setRec({ ...rec, kind, category_id: "", ...(kind === "income" && rec.target.startsWith("card:") ? { target: "" } : {}) })}
          secenek={[{ v: "income", l: "Gelir", renk: T.pos }, { v: "expense", l: "Gider", renk: T.neg }]} />
        {!edit && <TutarGirdisi value={rec.amount} onChange={(v) => setRec({ ...rec, amount: v })} renk={gelir ? T.pos : T.neg} />}
        <Etiketli etiket="Ne?">
          <input ref={nameRef} autoFocus style={girdi} value={rec.name} placeholder={gelir ? "örn. Maaş" : "örn. Kira"} onChange={(e) => setRec({ ...rec, name: e.target.value })} />
        </Etiketli>
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15 }}>
          <span>Her ayın</span>
          <input inputMode="numeric" aria-label="Ayın günü (1-31)" placeholder="1" value={rec.day}
            onChange={(e) => setRec({ ...rec, day: e.target.value.replace(/\D/g, "").slice(0, 2) })}
            style={{ ...girdiMono, width: 64, textAlign: "center", fontWeight: 600, padding: 0 }} />
          <span>. günü</span>
        </label>
        <Satirlar>
          <SatirSec etiket={gelir ? "Nereye" : "Nereden"} soluk={!rec.target}
            goruntu={hedefAcc ? hedefAcc.name : hedefKart ? `${hedefKart.name} (kart)` : "Hedef yok — yalnız tahmin"}
            value={rec.target} onChange={(v) => setRec({ ...rec, target: v, category_id: "" })}>
            <option value="">Hedef yok (yalnız tahmin)</option>
            {data.accounts.map((a) => <option key={`a${a.id}`} value={`acc:${a.id}`}>Hesap: {a.name}</option>)}
            {!gelir && data.cards.map((c) => <option key={`c${c.id}`} value={`card:${c.id}`}>Kart: {c.name}</option>)}
          </SatirSec>
          {isAcc && (
            <KategoriAlani satir bos="seç (isteğe bağlı)" data={data} reload={reload} value={rec.category_id}
              onChange={(v) => setRec({ ...rec, category_id: v })} kind={rec.kind} />
          )}
          <SatirTarih tur="month" etiket="Başlangıç" bos="baştan" temizle value={rec.from_month} onChange={(v) => setRec({ ...rec, from_month: v })} />
          <SatirTarih tur="month" etiket="Bitiş" bos="süresiz" temizle value={rec.to_month} onChange={(v) => setRec({ ...rec, to_month: v })} />
        </Satirlar>
        {rec.target && (
          <Anahtar etiket="Kendiliğinden işlensin" acik={rec.auto} onChange={(v) => setRec({ ...rec, auto: v })}
            alt={`günü gelince ${rec.target.startsWith("card:") ? "ekstreye" : "hesaba"} yazılır (açıldığı günden itibaren)`} />
        )}
        {edit && (
          <div style={{ fontSize: 13, color: T.mut, lineHeight: 1.5 }}>
            <b style={{ color: T.text }}>Tutar burada değişmez.</b> Tutar bir zaman çizelgesinde yaşar; buradan değiştirmek
            geçmiş projeksiyonu da bozardı. Plan'daki <b style={{ color: T.text }}>“Değiştir”</b> ile seçtiğin aydan itibaren yeni tutar geçerli olur.
          </div>
        )}
      </Bolum>
      <FormAlt sonuc={sonuc} ok={ok} reason={reason} onSaveNew={() => save(true)} editing={!!edit} sil={sil}
        etiket={edit ? "Değişikliği kaydet" : gelir ? "Düzenli geliri kaydet" : "Düzenli gideri kaydet"} />
    </form>
  );
}

/** Kredi/taksit → kalan taksitler nakit projeksiyonuna girer */
export function LoanForm({ reload, onClose, edit, sil }: FormProps & DuzenleProps & { edit?: Loan }) {
  const [f, setF] = useState(() => edit
    ? { name: edit.name, amount: String(edit.amount), first_date: edit.first_date, total: String(edit.total) }
    : { name: "", amount: "", first_date: todayStr(), total: "" });
  const nameRef = useRef<HTMLInputElement>(null);
  const ok = !!f.name && num(f.amount) > 0 && !!f.first_date && +f.total >= 1;
  const reason = !f.name ? "Krediye bir ad ver." : !(num(f.amount) > 0) ? "Aylık taksiti gir." : !(+f.total >= 1) ? "Toplam taksit sayısını gir." : null;
  const save = async (andNew: boolean) => {
    if (!ok) return;
    const body = { name: f.name, amount: num(f.amount), first_date: f.first_date, total: +f.total };
    if (edit) { await api.put(`loans/${edit.id}`, body); reload(); onClose(); return; }
    await api.post("loans", body);
    reload();
    if (andNew) { setF({ name: "", amount: "", first_date: f.first_date, total: "" }); nameRef.current?.focus(); } else onClose();
  };
  /* Son taksit = ilk taksit + (toplam − 1) ay — loanRemaining'in tarihten saydığı aynı takvim */
  const son = ok ? (() => { const d = parseD(f.first_date); return new Date(d.getFullYear(), d.getMonth() + +f.total - 1, 1); })() : null;
  const sonuc = <>
    {son && <>Son taksit {fmtD(son, { month: "long", year: "numeric" })} · toplam <Vurgu v={num(f.amount) * +f.total} /> geri ödenir.</>}
    {/* kalan taksit sayısı ilk taksit tarihi + toplamdan hesaplanır (elle tutulmaz) */}
    {edit && " Kalan taksit tarihten hesaplanır; kalan borç ve projeksiyon anında düzelir."}
  </>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <Bolum>
        <Etiketli etiket="Ne?">
          <input ref={nameRef} autoFocus style={girdi} value={f.name} placeholder="örn. İhtiyaç kredisi" onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Etiketli>
        <TutarGirdisi etiket="Aylık taksit" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
        <Satirlar>
          <SatirTarih etiket="İlk taksit" value={f.first_date} onChange={(v) => setF({ ...f, first_date: v })} />
          <SatirMetin etiket="Toplam taksit" sayi placeholder="12" value={f.total} onChange={(v) => setF({ ...f, total: v.replace(/\D/g, "") })} />
        </Satirlar>
      </Bolum>
      <FormAlt sonuc={sonuc} ok={ok} reason={reason} onSaveNew={() => save(true)} editing={!!edit} sil={sil}
        etiket={edit ? "Değişikliği kaydet" : "Krediyi kaydet"} />
    </form>
  );
}

/** Vadeli mevduat → net varlığa "kilitli varlık" olarak faiz işleyerek girer; opsiyonel hesaptan anapara düşer */
export function DepositForm({ data, reload, onClose, edit, sil }: FormProps & DuzenleProps & { edit?: Deposit }) {
  const [f, setF] = useState(() => edit
    ? {
      name: edit.name, principal: String(edit.principal), rate: String(edit.rate),
      term_days: String(edit.term_days), withholding: edit.withholding ? String(edit.withholding) : "",
      open_date: edit.open_date, account_id: edit.account_id != null ? String(edit.account_id) : "",
    }
    : { name: "", principal: "", rate: "", term_days: "", withholding: "", open_date: todayStr(), account_id: "" });
  const nameRef = useRef<HTMLInputElement>(null);
  const ok = !!f.name && num(f.principal) > 0 && num(f.rate) >= 0 && +f.term_days >= 1 && !!f.open_date;
  const reason = !f.name ? "Mevduata bir ad ver." : !(num(f.principal) > 0) ? "Anaparayı gir."
    : !(+f.term_days >= 1) ? "Vadeyi gün olarak gir." : !(num(f.rate) >= 0) ? "Faiz oranı geçersiz." : null;
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
      // defter hareketi: anapara hesaptan ÇIKAR (E2EE aşama 1b — sunucu artık türetmiyor)
      entry_amount: -num(f.principal),
    };
    if (edit) { await api.put(`deposits/${edit.id}`, body); reload(); onClose(); return; }
    await api.post("deposits", body);
    reload();
    if (andNew) { setF({ ...f, name: "", principal: "", rate: "", term_days: "" }); nameRef.current?.focus(); } else onClose();
  };
  const acc = f.account_id ? data.accounts.find((a) => a.id === +f.account_id) : null;
  const sonuc = preview && <>
    {fmtD(depositMaturity(preview), { day: "numeric", month: "long", year: "numeric" })} vadesinde <Vurgu v={depositMaturityValue(preview)} isaret="+" />
    {" "}({num(f.withholding) > 0 ? <>net faiz <Vurgu v={depositNetInterest(preview)} />, brüt {fmtMoney(depositGrossInterest(preview), "TRY", true)}</> : <>faiz <Vurgu v={depositGrossInterest(preview)} /></>}).
    {acc && <> <b>{acc.name}</b> bakiyesinden <Vurgu v={num(f.principal)} isaret="−" /> düşer (silinirse geri döner).</>}
    {edit && " Hesaba olan anapara etkisi otomatik düzeltilir (eskisi geri alınır, yenisi işlenir)."}
  </>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <Bolum>
        <Etiketli etiket="Ne?">
          <input ref={nameRef} autoFocus style={girdi} value={f.name} placeholder="örn. Vakıfbank 32 gün" onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Etiketli>
        <TutarGirdisi etiket="Anapara" value={f.principal} onChange={(v) => setF({ ...f, principal: v })} />
        <Satirlar>
          <SatirMetin etiket="Yıllık faiz" sayi placeholder="örn. 45" sonEk="%" value={f.rate} onChange={(v) => setF({ ...f, rate: v })} />
          <SatirMetin etiket="Vade" sayi placeholder="örn. 32" sonEk="gün" value={f.term_days} onChange={(v) => setF({ ...f, term_days: v.replace(/\D/g, "") })} />
          <SatirMetin etiket="Stopaj (isteğe bağlı)" sayi placeholder="0" sonEk="%" value={f.withholding} onChange={(v) => setF({ ...f, withholding: v })} />
          <SatirTarih etiket="Açılış" value={f.open_date} onChange={(v) => setF({ ...f, open_date: v })} />
          <SatirSec etiket="Hesap" goruntu={acc ? acc.name : "Bakiyeye işleme"} soluk={!acc} value={f.account_id} onChange={(v) => setF({ ...f, account_id: v })}>
            <option value="">— Bakiyeye işleme</option>
            {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </SatirSec>
        </Satirlar>
      </Bolum>
      <FormAlt sonuc={sonuc} ok={ok} reason={reason} onSaveNew={() => save(true)} editing={!!edit} sil={sil}
        etiket={edit ? "Değişikliği kaydet" : "Mevduatı kaydet"} />
    </form>
  );
}

/* ————— BEDELLİ SERMAYE ARTIŞI (Faz 36) —————
   KAYIT OLARAK YENİ BİR ŞEY DEĞİL: rüçhan hakkını kullanıp hisse başına bedel ödemek
   matematiksel olarak normal bir ALIŞ'tır (Faz 21 kararı, bilerek korundu) — bu form bir
   HESAP MAKİNESİDİR, sonunda `trades`'e düz bir ALIŞ yazar.

   Ayrı bir form olmasının sebebi, duyurunun ifadesiyle formun istediğinin AYNI OLMAMASI:
   şirket "%150 bedelli, 1 TL nominal" der; TradeForm ise "adet" ve "birim fiyat" ister.
   Kullanıcı bu çeviriyi elle yapıyordu ve iki hatanın ikisi de sessizdi —
   (1) oranı sermayeye uygulayıp yanlış lot yazmak,
   (2) birim fiyata NOMINAL yerine PİYASA fiyatını yazmak, ki bu ortalama maliyeti şişirir
       ve pozisyonu olduğundan kârsız gösterir.
   Adet hesabı engine'de (`bedelliPlan`), testli. */
export function BedelliForm({ data, reload, onClose }: FormProps) {
  /* Yalnız ELDE TUTULAN hisseler: rüçhan hakkı zaten yalnız mevcut ortağa doğar. Tutmadığın
     bir sembolü listelemek "bedelli ile yeni hisse alınır" yanılsaması yaratırdı. */
  const tutulan = useMemo(
    () => openPositions(positions(data.trades, data.prices)).filter((p) => p.type === "BIST"),
    [data.trades, data.prices],
  );
  const [f, setF] = useState({
    key: tutulan[0] ? `${tutulan[0].type}:${tutulan[0].sym}` : "",
    oran: "", bedel: "1", date: todayStr(), account_id: "", portfolio_id: "",
  });
  const pos = tutulan.find((p) => `${p.type}:${p.sym}` === f.key) ?? null;
  /* Oran YÜZDE girilir (duyuru öyle yazar), engine ORAN bekler: %150 → 1,5 */
  const plan = pos ? bedelliPlan(pos.qty, num(f.oran) / 100, num(f.bedel)) : null;

  const ok = !!pos && !!plan && !!f.date;
  const reason = !pos ? "Önce bir hisse seç."
    : !(num(f.oran) > 0) ? "Bedelli oranını gir (örn. 150)."
      : !(num(f.bedel) > 0) ? "Hisse başına bedeli gir (genelde 1 TL nominal)."
        : !plan ? "Bu oranda tam lot çıkmıyor." : null;

  const save = async () => {
    if (!ok || !pos || !plan) return;
    await api.post("trades", {
      date: f.date, asset_type: pos.type, symbol: pos.sym, side: "ALIŞ",
      qty: plan.qty, price: num(f.bedel), fee: 0, currency: pos.currency,
      account_id: f.account_id ? +f.account_id : null,
      portfolio_id: f.portfolio_id ? +f.portfolio_id : null,
      entry_amount: cashDelta({ side: "ALIŞ", qty: plan.qty, price: num(f.bedel), fee: 0 }),
    });
    reload();
    onClose();
  };

  if (!tutulan.length) {
    return <Empty>Bedelli için önce elinde bir BIST hissesi olmalı — rüçhan hakkı yalnız mevcut ortağa doğar.</Empty>;
  }
  const acc = f.account_id ? data.accounts.find((a) => a.id === +f.account_id) : null;
  const pf = f.portfolio_id ? data.portfolios.find((p) => p.id === +f.portfolio_id) : null;
  const sonuc = plan && pos && <>
    <b style={{ fontFamily: T.mono }}>{plan.qty}</b> yeni adet <span style={{ color: T.mut }}>({pos.qty} adedin %{num(f.oran)}'i, küsurat kırpıldı)</span>,
    ödenecek <Vurgu v={plan.cost} ccy={pos.currency} isaret="−" />. Sonra <span style={{ fontFamily: T.mono }}>{plan.qtyAfter}</span> adet,
    ort. maliyet <span style={{ fontFamily: T.mono }}>{fmtMoney(pos.avg, pos.currency, true)} → {fmtMoney((pos.qty * pos.avg + plan.cost) / plan.qtyAfter, pos.currency, true)}</span>.
    {" "}Defterine normal bir <b>ALIŞ</b> olarak yazılır.
  </>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }}>
      <Bolum>
        <Etiketli etiket="Hisse">
          {tutulan.length <= 4
            ? <Cipler ad="Hisse" deger={f.key} sec={(v) => setF({ ...f, key: v })}
              secenek={tutulan.map((p) => ({ v: `${p.type}:${p.sym}`, l: <>{p.sym} · <span style={{ fontFamily: T.mono }}>{p.qty}</span> adet</> }))} />
            : (
              <select autoFocus style={girdi} value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })}>
                {tutulan.map((p) => <option key={`${p.type}:${p.sym}`} value={`${p.type}:${p.sym}`}>{p.sym} — {p.qty} adet</option>)}
              </select>
            )}
        </Etiketli>
        <div style={{ display: "flex", gap: 10 }}>
          <Etiketli etiket="Bedelli oranı (%)">
            <input style={girdiMono} inputMode="decimal" placeholder="örn. 150" value={f.oran} onChange={(e) => setF({ ...f, oran: e.target.value })} />
          </Etiketli>
          <Etiketli etiket="Hisse başına bedel">
            <input style={girdiMono} inputMode="decimal" placeholder="1" value={f.bedel} onChange={(e) => setF({ ...f, bedel: e.target.value })} />
          </Etiketli>
        </div>
        <div style={{ fontSize: 12.5, color: T.mut, lineHeight: 1.45, marginTop: -6 }}>
          Duyuruda yazan oranı aynen gir. Bedel neredeyse her zaman <b style={{ color: T.text }}>nominal 1 TL</b>'dir — piyasa fiyatı değil.
        </div>
        <Satirlar>
          <SatirTarih value={f.date} onChange={(v) => setF({ ...f, date: v })} />
          <SatirSec etiket="Ödeyen hesap" goruntu={acc ? acc.name : "Bakiyeye işleme"} soluk={!acc} value={f.account_id} onChange={(v) => setF({ ...f, account_id: v })}>
            <option value="">— Bakiyeye işleme</option>
            {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </SatirSec>
          {data.portfolios.length > 0 && (
            <SatirSec etiket="Portföy" goruntu={pf ? pf.name : "Gruplanmamış"} soluk={!pf} value={f.portfolio_id} onChange={(v) => setF({ ...f, portfolio_id: v })}>
              <option value="">— Gruplanmamış</option>
              {data.portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </SatirSec>
          )}
        </Satirlar>
      </Bolum>
      <FormAlt sonuc={sonuc} ok={ok} reason={reason} editing etiket="Bedelliyi kaydet" />
    </form>
  );
}

/** Virman (Faz 16) — kendi hesapların arası para hareketi. TEK kayıt iki bacağı birden yazar:
    kaynaktan düşer, hedefe ekler. gelir/gider defterine girmez, net varlığı değiştirmez.
    Bu form olmadan kullanıcı iki sahte gelir/gider kaydı girmek zorundaydı — biri unutulunca
    bakiye kayar, defterde olmayan bir gelir/gider görünürdü. */
export function TransferForm({ data, reload, onClose, edit, sil }: FormProps & DuzenleProps & { edit?: Transfer }) {
  const [f, setF] = useState(() => edit
    ? {
      date: edit.date, from_account_id: String(edit.from_account_id),
      to_account_id: String(edit.to_account_id), amount: String(edit.amount), note: edit.note ?? "",
    }
    : { date: todayStr(), from_account_id: "", to_account_id: "", amount: "", note: "" });
  const amountRef = useRef<HTMLInputElement>(null);
  // bakiye kolonu yok, defterden türetilir (E2EE aşama 1a)
  const bakiyeler = balancesByAccount(data.account_entries);
  const bakiye = (id: number) => bakiyeler.get(id) ?? 0;
  const from = f.from_account_id ? data.accounts.find((a) => a.id === +f.from_account_id) : null;
  const to = f.to_account_id ? data.accounts.find((a) => a.id === +f.to_account_id) : null;
  const amount = num(f.amount);
  const same = !!from && !!to && from.id === to.id;
  const ok = !!from && !!to && !same && amount > 0 && !!f.date;
  const reason = !(amount > 0) ? "Tutarı gir." : !from ? "Paranın çıktığı hesabı seç." : !to ? "Paranın gittiği hesabı seç."
    : same ? "İki hesap aynı olamaz." : null;
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
  /* Hesap seçici = bakiye önizlemesi: eskiden seçicinin altında ayrı bir kutuda yazan "önce → sonra"
     artık seçicinin kendisinde */
  const HesapSec = ({ yon, deger, sec, isaret }: { yon: string; deger: string; sec: (v: string) => void; isaret: 1 | -1 }) => {
    const a = deger ? data.accounts.find((x) => x.id === +deger) : null;
    const sonra = a ? bakiye(a.id) + isaret * amount : 0;
    return (
      <label style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", border: `1px solid ${T.line}`, borderRadius: 14, cursor: "pointer" }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 12.5, color: T.mut }}>{yon}</span>
          <span style={{ display: "block", fontSize: 15.5, fontWeight: 600, color: a ? T.text : T.mut, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a ? a.name : "Hesap seç"}</span>
        </span>
        {a && (
          <span style={{ textAlign: "right", fontFamily: T.mono, flexShrink: 0 }}>
            <span style={{ display: "block", fontSize: 12.5, color: T.mut }}>{fmtMoney(bakiye(a.id), "TRY", true)}</span>
            {amount > 0 && <span style={{ display: "block", fontSize: 14, color: sonra < 0 ? T.neg : isaret < 0 ? T.text : T.pos }}>→ {fmtMoney(sonra, "TRY", true)}</span>}
          </span>
        )}
        <select aria-label={yon} value={deger} onChange={(e) => sec(e.target.value)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", minHeight: 0 }}>
          <option value="">— seç —</option>
          {data.accounts.map((x) => <option key={x.id} value={x.id}>{x.name} · {fmtMoney(bakiye(x.id), "TRY", true)}</option>)}
        </select>
      </label>
    );
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <Bolum>
        <TutarGirdisi value={f.amount} onChange={(v) => setF({ ...f, amount: v })} inputRef={amountRef} autoFocus />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 6 }}>
          {HesapSec({ yon: "Nereden", deger: f.from_account_id, sec: (v) => setF({ ...f, from_account_id: v }), isaret: -1 })}
          <button type="button" onClick={swap} title="Yönü değiştir" aria-label="Yönü değiştir" style={{
            position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", zIndex: 1,
            width: 34, height: 34, minHeight: 0, borderRadius: 999, background: T.panel, border: `1px solid ${T.line}`, color: T.acc,
            display: "grid", placeItems: "center", cursor: "pointer",
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4.5 2v10M2 9.5l2.5 2.5L7 9.5M9.5 12V2M7 4.5L9.5 2 12 4.5" /></svg>
          </button>
          {HesapSec({ yon: "Nereye", deger: f.to_account_id, sec: (v) => setF({ ...f, to_account_id: v }), isaret: 1 })}
        </div>
        <Satirlar>
          <SatirTarih value={f.date} onChange={(v) => setF({ ...f, date: v })} />
          <SatirMetin etiket="Not" placeholder="isteğe bağlı" value={f.note} onChange={(v) => setF({ ...f, note: v })} />
        </Satirlar>
      </Bolum>
      <FormAlt ok={ok} reason={reason} onSaveNew={() => save(true)} editing={!!edit} sil={sil}
        etiket={edit ? "Değişikliği kaydet" : "Virmanı kaydet"}
        sonuc={<>Net varlığın değişmez; gelir ya da gider sayılmaz.
          {from && bakiye(from.id) - amount < 0 && <span style={{ color: T.neg }}> {from.name} bakiyesi eksiye düşüyor.</span>}</>} />
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

/** Önden doldurma: Özet'teki "fon boz" önerisi (Faz 17) ve kurumsal olay önerileri (Faz 36).
    `amount` TUTAR modunu, `qty` ADET modunu açar — ikisi de verilmezse form boş gelir.
    Faz 36'te `qty`/`price` eklendi çünkü bedelsiz ve temettü önerilerinin bilinen değeri
    tutar değil ADETTİR (bedelsizde para hareketi zaten yok, temettüde hisse başına tutar
    ayrı bir alan). Tek alanlı `amount` ile ifade edilemezlerdi. */
export type TradePrefill = {
  asset_type: AssetType; symbol: string; side: Trade["side"];
  amount?: number; qty?: number; price?: number;
  date?: string; account_id?: number | null;
};

/** Portföy işlemi (alış/satış) → pozisyonlara ve net varlığa yansır */
export function TradeForm({ data, reload, onClose, edit, prefill, sil }: FormProps & DuzenleProps & { edit?: Trade; prefill?: TradePrefill }) {
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
      qty: prefill?.qty != null ? String(prefill.qty) : "",
      amount: prefill?.amount != null ? String(prefill.amount) : "",
      /* Öneriden gelen fiyat KAZANIR: temettüde bu "hisse başına tutar"dır, sembolün güncel
         piyasa fiyatı değil — priceOf'a düşseydi ₺0,23 yerine ₺312 yazardı. */
      /* Güncel fiyat yalnız bugün ya da ileri tarihli öneride dolar ("fon boz": en geç şu
         gün sat → bugünkü NAV en iyi tahmin). GEÇMİŞ tarihte dolmaz: fiyatı bilinmeyen DRIP
         geri yatırımı (Faz 36) bugünkü fiyatla adet türetip motorun bilerek kaçındığı
         "geçmişi bugünün fiyatıyla yazma" hatasını formda sessizce yapıyordu. */
      price: prefill?.price != null ? String(prefill.price)
        : prefill && (prefill.date ?? todayStr()) >= todayStr()
          ? String(priceOf(data, prefill.symbol, prefill.asset_type) ?? "") : "",
      fee: "", currency: defaultCcy(prefill?.asset_type ?? "BIST") as Currency,
      account_id: prefill?.account_id != null ? String(prefill.account_id) : "",
      // portföy grubu: son kullanılan grup varsayılan gelir (art arda giriş)
      portfolio_id: (() => { const p = lastUsedPortfolio(data); return p != null ? String(p) : ""; })(),
    });
  /* Düzenlemede kayıt adet taşır → adet modu; yenisinde varlık türünün doğal modu (öneriden gelen tutarlı) */
  const [mode, setMode] = useState<TradeMode>(() =>
    edit ? "adet"
      : prefill?.qty != null ? "adet"   // bedelsiz/temettü önerisi: bilinen değer ADET
        : prefill ? "tutar"             // "fon boz" önerisi: bilinen değer TUTAR
          : defaultMode(f.asset_type));
  const symbolRef = useRef<HTMLInputElement>(null);
  const sugs = useMemo(() => symbolSuggestions(data), [data]);
  /** Sembolün güncel fiyatı — para birimi eşleşiyorsa doldurulabilir (USD fiyatı TL alanına yazılmasın) */
  const livePrice = f.symbol && priceCcyOf(data, f.symbol, f.asset_type) === f.currency
    ? priceOf(data, f.symbol, f.asset_type) : null;
  /** Elde tutulan miktar — SATIŞ'ta "tümünü sat" için */
  const held = f.symbol ? heldQty(data.trades, f.symbol, f.asset_type) : 0;
  /** Temettü geri yatırımı bu sembolde açık mı (Faz 36) */
  const dripAcik = !!f.symbol && dripAcikMi(data.settings, f.asset_type, f.symbol);
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
    /* tutar modunda adet fiyattan türer: fiyat boşken "tutar 0'dan büyük olmalı" demek, dolu
       tutar alanını suçlayıp asıl eksiği saklıyordu */
    : (!isBonus && !isDividend && mode === "tutar" && !(num(f.price) > 0)) ? "Birim fiyat gerekli"
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
      /* Hesaba giren/çıkan para (E2EE aşama 1b). `cashDelta` ZATEN bu dosyada kullanılıyor
         (tutar↔adet çevirimi için), yani sunucudaki `tradeBalanceDelta` onun kopyasıydı —
         kaldırılan şey ikinci kopya, eklenen bir hesap değil. */
      entry_amount: cashDelta({ side: f.side, qty, price, fee }),
    };
    if (edit) { await api.put(`trades/${edit.id}`, body); reload(); onClose(); return; }
    await api.post("trades", body);
    reload();
    if (andNew) { setF({ ...f, symbol: "", qty: "", amount: "", price: "", fee: "" }); symbolRef.current?.focus(); } else onClose();
  };
  const ccySym = f.currency === "USD" ? "$" : "TL";
  const acc = f.currency === "TRY" && f.account_id ? data.accounts.find((a) => a.id === +f.account_id) : null;
  const pf = f.portfolio_id ? data.portfolios.find((p) => p.id === +f.portfolio_id) : null;
  const SIDE_AD: Record<Trade["side"], string> = { "ALIŞ": "Alış", "SATIŞ": "Satış", "TEMETTÜ": "Temettü", "BEDELSİZ": "Bedelsiz" };
  /* Sonuç cümlesi: eski formun alt kısmındaki önizlemeler (işlem tutarı, temettü neti, bedelsiz
     sonrası adet/maliyet, hesap etkisi) tek yerde. */
  const sonuc = ok && (isBonus ? (() => {
    /* Bedelsizde asıl merak edilen: adet ne olur, ortalama maliyet kaça düşer. Toplam maliyet sabit
       kaldığından pozisyonun DEĞERİ değişmez — bunu açıkça söylüyoruz, çünkü "ortalamam düştü,
       kâra geçtim" en yaygın yanlış okumadır. */
    const p = positions(data.trades.filter((t) => t.symbol.toUpperCase() === f.symbol.trim().toUpperCase() && t.asset_type === f.asset_type), []);
    const cur = p[0];
    if (!cur || cur.qty <= 0) return <>Bedelsiz kaydedilecek: <b style={{ fontFamily: T.mono }}>{qty.toLocaleString("tr-TR")} adet</b>.</>;
    const newQty = cur.qty + qty, newAvg = (cur.avg * cur.qty) / newQty;
    return <>Adet <span style={{ fontFamily: T.mono }}>{cur.qty.toLocaleString("tr-TR")} → {newQty.toLocaleString("tr-TR")}</span>, ort. maliyet <span style={{ fontFamily: T.mono }}>{fmtMoney(cur.avg, f.currency, true)} → {fmtMoney(newAvg, f.currency, true)}</span>. Toplam maliyet ve pozisyon değeri değişmez.</>;
  })() : (() => {
    const delta = cashDelta({ side: f.side, qty, price, fee });
    return <>
      {isDividend ? "Brüt temettü " : "İşlem tutarı "}<Vurgu v={qty * price} ccy={f.currency} />
      {isDividend && fee > 0 && <>, stopaj sonrası net <Vurgu v={delta} ccy={f.currency} /></>}
      {acc && <> · <b>{acc.name}</b> {delta >= 0 ? "bakiyesine" : "bakiyesinden"} <Vurgu v={Math.abs(delta)} isaret={delta >= 0 ? "+" : "−"} /> {delta >= 0 ? "işlenir" : "düşer"}</>}.
      {isDividend && " Adedin ve ortalama maliyetin değişmez; tutar gerçekleşen getiriye yazılır."}
    </>;
  })());
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <Bolum>
        {/* Dört pozisyon olayı (Faz 21). Temettü/bedelsiz de bu deftere yazılır: ikisi de
            pozisyonun geçmişinin parçasıdır, ayrı bir yerde tutmak hikâyeyi bölerdi. */}
        <div>
          <Segment ad="İşlem" deger={f.side} sec={(s) => { setF({ ...f, side: s }); if (s === "BEDELSİZ") setMode("adet"); }}
            secenek={(["ALIŞ", "SATIŞ", "TEMETTÜ", "BEDELSİZ"] as const).map((s) => ({ v: s, l: SIDE_AD[s], renk: SIDE_COLOR[s], title: SIDE_HINT[s] }))} />
          <div style={{ fontSize: 12.5, color: T.mut, marginTop: 6 }}>{SIDE_HINT[f.side]}</div>
        </div>
        <Etiketli etiket="Sembol">
          <SuggestInput autoFocus inputRef={symbolRef} style={{ ...girdi, textTransform: "uppercase", fontWeight: 600 }} placeholder={TYPE_HINT[f.asset_type]}
            value={f.symbol} onChange={(v) => setF({ ...f, symbol: v.toUpperCase() })}
            onPick={pickSymbol} options={sugs} labelOf={(s) => s.symbol}
            subOf={(s) => s.price != null ? `${s.asset_type} · ${fmtMoney(s.price, s.currency, true)}` : s.asset_type} />
        </Etiketli>
        {/* Giriş modu: fonda tutar ("50 bin lira attım"), hissede adet ("50 lot aldım").
            Bedelsizde para hareketi olmadığından mod seçimi anlamsız — gizlenir. */}
        {!isBonus && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, color: T.mut, flex: 1 }}>Ne kadar?</span>
            <Segment kucuk ad="Giriş" deger={mode} sec={switchMode}
              secenek={[{ v: "adet", l: isDividend ? "Hisse başına" : "Adet" }, { v: "tutar", l: isDividend ? "Toplam" : "Tutar" }]} />
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: isBonus ? 0 : -6 }}>
          {/* Temettü ve bedelsizde adet HER ZAMAN elle girilir (elindeki hisse sayısı) */}
          {(isDividend || isBonus || mode === "adet") && (
            <Etiketli etiket={isDividend ? "Temettü ödenen adet" : isBonus ? "Gelen bedelsiz adet" : "Adet / miktar"}>
              <input style={girdiMono} inputMode="decimal" placeholder="0" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
            </Etiketli>
          )}
          {mode === "tutar" && !isBonus && (
            <Etiketli etiket={isDividend ? `Hesaba giren toplam (${ccySym})` : f.side === "SATIŞ" ? `Hesaba girecek (${ccySym})` : `Hesaptan çıkacak (${ccySym})`}>
              <input style={girdiMono} inputMode="decimal" placeholder="0" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            </Etiketli>
          )}
          {!isBonus && !(isDividend && mode === "tutar") && (
            /* Temettüde bu alan BRÜTTÜR: nakit = adet × bu − stopaj (`cashDelta`). Etiket eskiden
               "net" diyordu — ona güvenip net tutarı yazan ve stopajı da giren kullanıcının
               stopajı iki kez düşülürdü; kurumsal öneri de buraya brüt tutarı dolduruyor. */
            <Etiketli etiket={isDividend ? `Hisse başına brüt (${ccySym})` : `Birim fiyat (${ccySym})`}>
              <input style={girdiMono} inputMode="decimal" placeholder="0" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
            </Etiketli>
          )}
        </div>
        {/* Türetilen değer görünür olmalı: kaydedilen sayı bu */}
        {mode === "tutar" && !isBonus && qty > 0 && price > 0 && (
          <div style={{ fontSize: 12.5, color: T.mut, marginTop: -6 }}>
            {isDividend
              ? <>Hisse başına: <span style={{ fontFamily: T.mono, color: T.text }}>{fmtMoney(price, f.currency, true)}</span> ({fmtMoney(num(f.amount) + fee, f.currency, true)} ÷ {qty.toLocaleString("tr-TR")} adet)</>
              : <>Kaydedilecek adet: <span style={{ fontFamily: T.mono, color: T.text }}>{qty.toLocaleString("tr-TR", { maximumFractionDigits: 6 })}</span> ({fmtMoney(num(f.amount), f.currency, true)} ÷ {fmtMoney(price, f.currency, true)})</>}
          </div>
        )}
        {/* tek tık doldurmalar: güncel piyasa fiyatı, elde tutulan miktar (satış/temettü/bedelsizde) */}
        {((livePrice != null && !isBonus && !isDividend && String(livePrice) !== f.price) || (held > 0 && (f.side === "SATIŞ" || isDividend || isBonus))) && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: -4 }}>
            {livePrice != null && !isBonus && !isDividend && String(livePrice) !== f.price && (
              <Doldur onClick={() => setF({ ...f, price: String(livePrice) })}>Güncel fiyat: {fmtMoney(livePrice, f.currency, true)}</Doldur>
            )}
            {f.side === "SATIŞ" && held > 0 && (
              <Doldur onClick={() => mode === "tutar"
                ? setF({ ...f, amount: String(+amountFromQty("SATIŞ", held, price, fee).toFixed(2)) })
                : setF({ ...f, qty: String(held) })}>
                Tümünü sat: {mode === "tutar" && price > 0 ? fmtMoney(amountFromQty("SATIŞ", held, price, fee), f.currency, true) : held}
              </Doldur>
            )}
            {/* Temettü neredeyse her zaman elindeki TÜM hisselere ödenir; bedelsizde oran hesabı için lazım */}
            {(isDividend || isBonus) && held > 0 && String(held) !== f.qty && (
              <Doldur onClick={() => setF({ ...f, qty: String(held) })}>Elimdeki adet: {held.toLocaleString("tr-TR")}</Doldur>
            )}
            {isBonus && held > 0 && [50, 100, 200].map((pct) => (
              <Doldur key={pct} onClick={() => setF({ ...f, qty: String(+(held * pct / 100).toFixed(6)) })}>%{pct} bedelsiz</Doldur>
            ))}
          </div>
        )}
        <Satirlar>
          <SatirTarih value={f.date} onChange={(v) => setF({ ...f, date: v })} />
          <SatirSec etiket="Varlık türü" goruntu={f.asset_type} value={f.asset_type}
            onChange={(v) => {
              const at = v as AssetType;
              setF({ ...f, asset_type: at, symbol: "", currency: defaultCcy(at) });
              if (!edit) setMode(defaultMode(at)); // tür değişince o türün doğal giriş modu
            }}>
            {(["BIST", "FON", "ALTIN", "DOVIZ", "KRIPTO", "ETF"] as AssetType[]).map((t) => <option key={t}>{t}</option>)}
          </SatirSec>
          <SatirSec etiket="Para birimi" goruntu={f.currency === "USD" ? "$ USD" : "₺ TRY"} value={f.currency} onChange={(v) => setF({ ...f, currency: v as Currency })}>
            <option value="TRY">₺ TRY</option><option value="USD">$ USD</option>
          </SatirSec>
          {/* Bedelsizde para hareketi yok → hesap alanı gizlenir; USD işlem TL hesaba bağlanmaz */}
          {f.currency === "TRY" && !isBonus && (
            <SatirSec etiket="Hesap" goruntu={acc ? acc.name : "Bakiyeye işleme"} soluk={!acc} value={f.account_id} onChange={(v) => setF({ ...f, account_id: v })}>
              <option value="">— Bakiyeye işleme</option>
              {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </SatirSec>
          )}
          {/* Portföy grubu: yalnız raporlama/gruplama — pozisyon matematiğini veya net varlığı değiştirmez */}
          <SatirSec etiket="Portföy" goruntu={pf ? pf.name : "Gruplanmamış"} soluk={!pf} value={f.portfolio_id} onChange={(v) => setF({ ...f, portfolio_id: v })}>
            <option value="">Gruplanmamış</option>
            {data.portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </SatirSec>
          {!isBonus && (
            <SatirMetin etiket={isDividend ? "Stopaj / kesinti" : "Komisyon"} sayi placeholder="0" sonEk={f.currency === "USD" ? "$" : "₺"}
              value={f.fee} onChange={(v) => setF({ ...f, fee: v })} />
          )}
        </Satirlar>
        {/* Faz 36 — temettü geri yatırımı (DRIP). ALIŞ anında sorulur çünkü karar tam da orada
            verilir; ama işaret İŞLEME değil POZİSYONA aittir (`user_settings.drip_symbols`) ve
            pozisyon ayrıntısındaki aynı düğmeyle de dönebilir. ANINDA kaydedilir: bir tercih, bir işlem değil. */}
        {f.side === "ALIŞ" && !!f.symbol && (f.asset_type === "BIST" || f.asset_type === "ETF") && (
          <Anahtar etiket="Temettüyü geri yatır" acik={dripAcik}
            alt={dripAcik ? `${f.symbol} temettüsü geldiğinde alım da önerilir` : "Temettü geldiğinde yalnız gelir olarak yazılır"}
            onChange={async () => { await api.put("settings", { drip_symbols: dripToggle(data.settings, f.asset_type, f.symbol) }); reload(); }} />
        )}
        {edit && (
          <div style={{ fontSize: 13, color: T.mut, lineHeight: 1.5 }}>
            İşlem düzenleniyor: pozisyon ve ortalama maliyet baştan hesaplanır; hesaba bağlıysa bakiye etkisi de düzeltilir (eskisi geri alınır, yenisi işlenir).
          </div>
        )}
      </Bolum>
      <FormAlt sonuc={sonuc} ok={ok} reason={reason} onSaveNew={() => save(true)} editing={!!edit} sil={sil}
        etiket={edit ? "Değişikliği kaydet" : `${SIDE_AD[f.side]} kaydet`.replace("Alış kaydet", "Alışı kaydet").replace("Satış kaydet", "Satışı kaydet").replace("Temettü kaydet", "Temettüyü kaydet").replace("Bedelsiz kaydet", "Bedelsizi kaydet")} />
    </form>
  );
}
