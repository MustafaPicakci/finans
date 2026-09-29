import React, { useMemo, useState } from "react";
import { parseStatement, type AllData, type ParsedRow } from "@finans/engine";
import { api } from "../../api";
import { T, css, fmtMoney } from "../../theme";
import { Field, Hint } from "../../ui";
import { kalemSuggestions, normName } from "./recall";
import { pdfSatirlari, PdfParolaGerekli } from "./pdfOku";

/* ————— TOPLU İÇE AKTARMA (EKSTRE YAPIŞTIRMA / PDF) —————
   Banka/aracı kurum ekstresini ya da Excel tablosunu olduğu gibi yapıştır — ya da e-ekstre
   PDF'ini seç (Faz 45: tarayıcıda okunur, metni bu kutuya yazılır; bkz. pdfOku.ts) → satırlar
   `parseStatement` (engine, testli) ile ayrıştırılır → önizleme tablosunda düzeltilir →
   tek istekte (`POST /api/transactions/bulk`, atomik) deftere yazılır.
   Kategori tahmini geçmiş kayıtlardan yapılır; olası kopyalar önden işaretsiz gelir. */

type Draft = ParsedRow & { include: boolean; category_id: string; dup: boolean };

export function ImportForm({ data, reload, onClose }: { data: AllData; reload: () => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [defaultSign, setDefaultSign] = useState<"gider" | "gelir">("gider");
  /* Hedef (Faz 45): "a:<hesap>" gerçekleşen işlem (+bakiye), "c:<kart>" kart harcaması, "" yalnız defter.
     Kart ekstresinin doğru yeri kart harcamalarıdır: hesaba yazılsa harcamalar karttan değil
     hesaptan çıkmış gibi olur ve ekstre ödemesiyle birlikte iki kez sayılırdı. */
  const [hedef, setHedef] = useState(data.accounts[0] ? `a:${data.accounts[0].id}` : "");
  const accountId = hedef.startsWith("a:") ? hedef.slice(2) : "";
  const cardId = hedef.startsWith("c:") ? +hedef.slice(2) : null;
  const kart = cardId != null ? data.cards.find((c) => c.id === cardId) : undefined;
  /** Kart hedefinde karta para GİREN satır (ekstre ödemesi, iade) aktarılmaz: ödeme Kart sekmesinde
      "Ödedim" ile kaydedilir (burada da yazılsa iki kez sayılırdı) ve kart harcaması modelinde iade yok. */
  const kartaGiren = (r: ParsedRow) => cardId != null && r.amount > 0;
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /* PDF: dosya parolalıysa elde tutulur, parola sorulur. Parola yalnız bu cihazda PDF'i açmak için. */
  const [pdf, setPdf] = useState<{ dosya: File; parolaIste: boolean; yanlis: boolean; okunuyor: boolean } | null>(null);
  const [parola, setParola] = useState("");

  const sugs = useMemo(() => kalemSuggestions(data), [data]);
  /** geçmişte aynı/benzer adla girilmiş kaydın kategorisi (en sık kullanılan eşleşme) */
  const guessCategory = (name: string): number | null => {
    const n = normName(name);
    if (!n) return null;
    const hit = sugs.find((s) => normName(s.name) === n)
      ?? sugs.find((s) => s.category_id != null && (n.includes(normName(s.name)) || normName(s.name).includes(n)));
    return hit?.category_id ?? null;
  };
  /** aynı gün + aynı tutar + aynı ad zaten defterde varsa büyük olasılıkla ikinci kez aktarılıyor */
  const isDup = (r: ParsedRow) => cardId != null
    ? data.card_txs.some((t) => t.card_id === cardId && t.date === r.date && Math.abs(t.amount + r.amount) < 0.005 && normName(t.name) === normName(r.name))
    : data.transactions.some((t) => t.date === r.date && Math.abs(t.amount - r.amount) < 0.005 && normName(t.name) === normName(r.name));

  const analyze = (metin = text) => {
    /* Kart ekstresi TERS işaret dilindedir: harcama işaretsiz/artı (borç artar), ödeme eksi.
       Ayrıştırıcı belgenin kendi dilinde okur (işaretsiz = artı), sonra önizlemenin diline
       (− = harcama) çevrilir. Banka bunun tersini yazıyorsa "işaretleri çevir" tek dokunuş. */
    const kartMi = cardId != null;
    const cozum = parseStatement(metin, kartMi ? "gelir" : defaultSign);
    const rows = kartMi ? cozum.rows.map((r) => ({ ...r, amount: -r.amount })) : cozum.rows;
    const { skipped } = cozum;
    setSkipped(skipped);
    setDrafts(rows.map((r) => {
      const dup = isDup(r);
      const cat = guessCategory(r.name);
      return { ...r, include: !dup && !kartaGiren(r), dup, category_id: cat != null ? String(cat) : "" };
    }));
    setErr(null);
  };

  const pdfOku = async (dosya: File, sifre?: string) => {
    // yeni PDF kutudakinin yerini alır: önceki metin kalsa parola sorulurken eski belge çözülebilirdi
    setPdf({ dosya, parolaIste: false, yanlis: false, okunuyor: true }); setErr(null); setText("");
    try {
      const metin = (await pdfSatirlari(dosya, sifre)).join("\n");
      setPdf(null); setParola("");
      if (!metin.trim()) { setErr("Bu PDF'te okunabilir metin yok (taranmış bir kâğıt olabilir)."); return; }
      setText(metin);
      analyze(metin);
    } catch (e) {
      if (e instanceof PdfParolaGerekli) { setPdf({ dosya, parolaIste: true, yanlis: e.yanlis, okunuyor: false }); return; }
      setPdf(null);
      setErr(e instanceof Error ? e.message : "PDF okunamadı");
    }
  };

  const upd = (i: number, patch: Partial<Draft>) =>
    setDrafts((d) => d!.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  /* Belgenin işaret dili bizimkinin tersi olabilir: kart ekstresinde harcama ARTI, ödeme eksi
     yazılır. Tek dokunuşla hepsi çevrilir; türü artık tutmayan kategori boşaltılır (gelir
     kategorisi gidere yazılmasın). */
  const isaretCevir = () => setDrafts((d) => d!.map((r) => {
    const amount = -r.amount;
    const kat = data.categories.find((c) => String(c.id) === r.category_id);
    const tutar = !kat || kat.kind === (amount < 0 ? "expense" : "income");
    const yeni = { ...r, amount, category_id: tutar ? r.category_id : "" };
    // kart hedefinde aktarılamaz hâle gelen satır seçimden düşer, aktarılabilir olan (kopya değilse) seçilir
    return { ...yeni, include: kartaGiren(yeni) ? false : kartaGiren(r) ? !r.dup : r.include };
  }));

  const chosen = drafts?.filter((d) => d.include) ?? [];
  const sum = chosen.reduce((s, d) => s + d.amount, 0);

  const save = async () => {
    if (chosen.length === 0) return;
    setBusy(true); setErr(null);
    try {
      if (cardId != null) {
        // önizleme hesap diliyle (− = harcama) konuşur; kart harcaması tutarı artıdır
        await api.bulkCardTxs(chosen.map((d) => ({
          card_id: cardId, date: d.date, name: d.name, amount: -d.amount, installments: 1,
          category_id: d.category_id ? +d.category_id : null,
        })));
      } else {
        await api.bulkTransactions(chosen.map((d) => ({
          date: d.date, name: d.name, amount: d.amount,
          category_id: d.category_id ? +d.category_id : null,
          account_id: accountId ? +accountId : null,
        })));
      }
      reload();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Kaydedilemedi");
    } finally {
      setBusy(false);
    }
  };

  /* ——— 1. adım: metni yapıştır ——— */
  if (drafts === null) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <label style={{ ...css.ghost, display: "inline-flex", alignItems: "center", cursor: pdf?.okunuyor ? "wait" : "pointer" }}>
            {pdf?.okunuyor ? "PDF okunuyor…" : "E-ekstre PDF'i seç"}
            <input type="file" accept="application/pdf,.pdf" hidden disabled={pdf?.okunuyor}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pdfOku(f); }} />
          </label>
          <span style={{ fontSize: 12, color: T.mut }}>Dosya bu cihazda okunur, hiçbir yere gönderilmez.</span>
        </div>
        {pdf?.parolaIste && (
          <form onSubmit={(e) => { e.preventDefault(); if (parola) pdfOku(pdf.dosya, parola); }}
            style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 10 }}>
            <Field label={pdf.yanlis ? "Parola yanlış, tekrar dene" : "Bu PDF parolalı"} flex={2}>
              <input type="password" autoFocus style={css.input} value={parola} onChange={(e) => setParola(e.target.value)}
                placeholder="Bankanın bildirdiği parola" autoComplete="off" />
            </Field>
            <button type="submit" style={{ ...css.btn, opacity: parola ? 1 : 0.4 }} disabled={!parola}>Aç</button>
          </form>
        )}
        <div style={{ ...css.label, marginBottom: 6 }}>ya da ekstreyi / tabloyu yapıştır</div>
        <textarea
          autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={9}
          placeholder={"12.03.2026\tMIGROS ATASEHIR\t-450,25\n13.03.2026\tBENZIN\t-1.200,00"}
          style={{ ...css.input, resize: "vertical", lineHeight: 1.5, fontSize: 12.5 }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          {cardId == null && <Field label="İşaretsiz tutarlar">
            <select style={css.input} value={defaultSign} onChange={(e) => setDefaultSign(e.target.value as "gider" | "gelir")}>
              <option value="gider">Gider (−) sayılsın</option>
              <option value="gelir">Gelir (+) sayılsın</option>
            </select>
          </Field>}
          <Field label="Nereye" flex={2}>
            <select style={css.input} value={hedef} onChange={(e) => setHedef(e.target.value)}>
              {data.accounts.length > 0 && (
                <optgroup label="Hesap dökümü → hesap">
                  {data.accounts.map((a) => <option key={a.id} value={`a:${a.id}`}>{a.name}</option>)}
                </optgroup>
              )}
              {data.cards.length > 0 && (
                <optgroup label="Kart ekstresi → kart harcaması">
                  {data.cards.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}
                </optgroup>
              )}
              <option value="">Yalnız gelir/gider defteri (bakiyeye işleme)</option>
            </select>
          </Field>
        </div>
        <div style={{ fontSize: 12, color: T.mut, marginTop: 10, background: T.panel2, borderRadius: 8, padding: "8px 12px" }}>
          Sekmeli (Excel kopyası), noktalı virgüllü/virgüllü CSV ve boşlukla hizalanmış metin tanınır.
          Tarih <b>gg.aa.yyyy</b> veya <b>yyyy-aa-gg</b>, tutar <b>1.234,56</b> biçiminde olabilir.
          Eksi işareti olan satırlar gider, bakiye sütunu varsa yön bakiyeden çıkarılır. Belgede
          yalnız bazı satırlar eksi işaretliyse işaretsiz olanlar gelir sayılır. Kart ekstresinde işaretsiz
          tutar harcamadır.
        </div>
        {err && <div style={{ color: T.neg, fontSize: 12.5, marginTop: 8 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="button" style={{ ...css.btn, opacity: text.trim() ? 1 : 0.4 }} disabled={!text.trim()} onClick={() => analyze()}>Satırları çöz</button>
          <button type="button" style={css.ghost} onClick={onClose}>Vazgeç</button>
        </div>
      </div>
    );
  }

  /* ——— 2. adım: önizleme + düzeltme ——— */
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ fontSize: 13, color: T.mut }}>
          <b style={{ color: T.text }}>{drafts.length}</b> satır çözüldü · <b style={{ color: T.text }}>{chosen.length}</b> seçili
          {drafts.some((d) => d.dup) && <> · <span style={{ color: T.neg }}>{drafts.filter((d) => d.dup).length} olası kopya</span></>}
        </div>
        <div style={{ fontSize: 13, color: T.mut, display: "flex", alignItems: "center", gap: 10 }}>
          <button type="button" onClick={isaretCevir} title="Gider ↔ gelir: belgede harcama artı yazılıyorsa"
            style={{ background: "none", border: "none", padding: 0, color: T.acc, fontSize: 12.5, cursor: "pointer", minHeight: 0 }}>
            işaretleri çevir
          </button>
          <span>net: <span style={{ ...css.mono, color: sum < 0 ? T.neg : T.pos }}>{fmtMoney(sum, "TRY", true)}</span></span>
        </div>
      </div>

      <div style={{ maxHeight: "42vh", overflowY: "auto", border: `1px solid ${T.line}`, borderRadius: 10 }}>
        {drafts.map((d, i) => (
          <div key={i} style={{
            /* sarılır: 390px'te beş kontrol tek satıra sığmıyor, kategori seçici ekrandan taşıyordu */
            display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", flexWrap: "wrap",
            borderTop: i === 0 ? "none" : `1px solid ${T.line}`, opacity: d.include ? 1 : 0.45,
            background: d.dup ? "color-mix(in srgb, var(--neg) 7%, transparent)" : "transparent",
          }}>
            <input type="checkbox" checked={d.include} disabled={kartaGiren(d)} onChange={(e) => upd(i, { include: e.target.checked })} />
            <span style={{ ...css.mono, fontSize: 11.5, color: T.mut3, flexShrink: 0 }}>{d.date.slice(5)}</span>
            <input style={{ ...css.input, padding: "5px 8px", fontSize: 12.5, flex: "1 1 120px", minWidth: 0 }}
              value={d.name} onChange={(e) => upd(i, { name: e.target.value })} />
            <input style={{ ...css.input, padding: "5px 8px", fontSize: 12.5, width: 92, flexShrink: 0, color: d.amount < 0 ? T.neg : T.pos }}
              value={String(d.amount)} onChange={(e) => upd(i, { amount: Number(e.target.value.replace(",", ".")) || 0 })} />
            <select style={{ ...css.input, padding: "5px 8px", fontSize: 12, flex: "0 1 130px", minWidth: 0 }}
              value={d.category_id} onChange={(e) => upd(i, { category_id: e.target.value })}>
              <option value="">Kategorisiz</option>
              {data.categories.filter((c) => c.kind === (d.amount < 0 ? "expense" : "income")).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        ))}
        {drafts.length === 0 && <div style={{ padding: 16, textAlign: "center", color: T.mut, fontSize: 13 }}>Hiçbir satır çözülemedi</div>}
      </div>

      {skipped.length > 0 && (
        <Hint>{skipped.length} satır atlandı (tarih veya tutar bulunamadı): <span style={css.mono}>{skipped.slice(0, 2).join(" / ").slice(0, 90)}…</span></Hint>
      )}
      {drafts.some(kartaGiren) && (
        <Hint>Karta para giren {drafts.filter(kartaGiren).length} satır (ekstre ödemesi ya da iade) aktarılmaz: ekstre ödemesi Kart sekmesinde "Ödedim" ile kaydedilir.</Hint>
      )}
      <div style={{ fontSize: 12, color: T.mut, marginTop: 10, background: T.panel2, borderRadius: 8, padding: "8px 12px" }}>
        {kart
          ? <>Seçili satırlar <b>{kart.name}</b> kartına harcama olarak yazılır ve tarihlerine göre ilgili ekstreye düşer. Taksitli satırlar tek seferlik harcama olarak aktarılır.</>
          : accountId
          ? <>Seçili satırlar gerçekleşen kayıt olarak yazılır ve <b>{data.accounts.find((a) => a.id === +accountId)?.name}</b> bakiyesine toplam <span style={{ ...css.mono, color: sum < 0 ? T.neg : T.pos }}>{fmtMoney(sum, "TRY", true)}</span> işler.</>
          : "Hesap seçilmedi — kayıtlar yalnız gelir/gider defterine girer, bakiyeye dokunmaz."}
      </div>
      {err && <div style={{ color: T.neg, fontSize: 12.5, marginTop: 8 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="button" style={{ ...css.btn, opacity: chosen.length && !busy ? 1 : 0.4 }} disabled={!chosen.length || busy} onClick={save}>
          {busy ? "Kaydediliyor…" : `${chosen.length} kaydı içe aktar`}
        </button>
        <button type="button" style={css.ghost} onClick={() => setDrafts(null)}>Geri</button>
      </div>
    </div>
  );
}
