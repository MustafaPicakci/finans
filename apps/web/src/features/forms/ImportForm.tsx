import React, { useMemo, useState } from "react";
import { parseStatement, type AllData, type ParsedRow } from "@finans/engine";
import { api } from "../../api";
import { T, css, fmtMoney } from "../../theme";
import { Field, Hint } from "../../ui";
import { kalemSuggestions, normName } from "./recall";

/* ————— TOPLU İÇE AKTARMA (EKSTRE YAPIŞTIRMA) —————
   Banka/aracı kurum ekstresini ya da Excel tablosunu olduğu gibi yapıştır → satırlar
   `parseStatement` (engine, testli) ile ayrıştırılır → önizleme tablosunda düzeltilir →
   tek istekte (`POST /api/transactions/bulk`, atomik) deftere yazılır.
   Kategori tahmini geçmiş kayıtlardan yapılır; olası kopyalar önden işaretsiz gelir. */

type Draft = ParsedRow & { include: boolean; category_id: string; dup: boolean };

export function ImportForm({ data, reload, onClose }: { data: AllData; reload: () => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [defaultSign, setDefaultSign] = useState<"gider" | "gelir">("gider");
  const [accountId, setAccountId] = useState(data.accounts[0] ? String(data.accounts[0].id) : "");
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
  const isDup = (r: ParsedRow) =>
    data.transactions.some((t) => t.date === r.date && Math.abs(t.amount - r.amount) < 0.005 && normName(t.name) === normName(r.name));

  const analyze = () => {
    const { rows, skipped } = parseStatement(text, defaultSign);
    setSkipped(skipped);
    setDrafts(rows.map((r) => {
      const dup = isDup(r);
      const cat = guessCategory(r.name);
      return { ...r, include: !dup, dup, category_id: cat != null ? String(cat) : "" };
    }));
    setErr(null);
  };

  const upd = (i: number, patch: Partial<Draft>) =>
    setDrafts((d) => d!.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const chosen = drafts?.filter((d) => d.include) ?? [];
  const sum = chosen.reduce((s, d) => s + d.amount, 0);

  const save = async () => {
    if (chosen.length === 0) return;
    setBusy(true); setErr(null);
    try {
      await api.bulkTransactions(chosen.map((d) => ({
        date: d.date, name: d.name, amount: d.amount,
        category_id: d.category_id ? +d.category_id : null,
        account_id: accountId ? +accountId : null,
      })));
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
        <div style={{ ...css.label, marginBottom: 6 }}>Ekstreyi / tabloyu yapıştır</div>
        <textarea
          autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={9}
          placeholder={"12.03.2026\tMIGROS ATASEHIR\t-450,25\n13.03.2026\tBENZIN\t-1.200,00"}
          style={{ ...css.input, resize: "vertical", lineHeight: 1.5, fontSize: 12.5 }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <Field label="İşaretsiz tutarlar">
            <select style={css.input} value={defaultSign} onChange={(e) => setDefaultSign(e.target.value as "gider" | "gelir")}>
              <option value="gider">Gider (−) sayılsın</option>
              <option value="gelir">Gelir (+) sayılsın</option>
            </select>
          </Field>
          <Field label="Hesap" flex={2}>
            <select style={css.input} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">— (bakiyeye işleme)</option>
              {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ fontSize: 12, color: T.mut, marginTop: 10, background: T.panel2, borderRadius: 8, padding: "8px 12px" }}>
          Sekmeli (Excel kopyası), noktalı virgüllü/virgüllü CSV ve boşlukla hizalanmış metin tanınır.
          Tarih <b>gg.aa.yyyy</b> veya <b>yyyy-aa-gg</b>, tutar <b>1.234,56</b> biçiminde olabilir.
          Eksi işareti olan satırlar gider, bakiye sütunu varsa yön bakiyeden çıkarılır.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="button" style={{ ...css.btn, opacity: text.trim() ? 1 : 0.4 }} disabled={!text.trim()} onClick={analyze}>Satırları çöz</button>
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
        <div style={{ fontSize: 13, color: T.mut }}>
          net: <span style={{ ...css.mono, color: sum < 0 ? T.neg : T.pos }}>{fmtMoney(sum, "TRY", true)}</span>
        </div>
      </div>

      <div style={{ maxHeight: "42vh", overflowY: "auto", border: `1px solid ${T.line}`, borderRadius: 10 }}>
        {drafts.map((d, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
            borderTop: i === 0 ? "none" : `1px solid ${T.line}`, opacity: d.include ? 1 : 0.45,
            background: d.dup ? "color-mix(in srgb, var(--neg) 7%, transparent)" : "transparent",
          }}>
            <input type="checkbox" checked={d.include} onChange={(e) => upd(i, { include: e.target.checked })} />
            <span style={{ ...css.mono, fontSize: 11.5, color: T.mut3, flexShrink: 0 }}>{d.date.slice(5)}</span>
            <input style={{ ...css.input, padding: "5px 8px", fontSize: 12.5, flex: 2, minWidth: 90 }}
              value={d.name} onChange={(e) => upd(i, { name: e.target.value })} />
            <input style={{ ...css.input, padding: "5px 8px", fontSize: 12.5, width: 92, flexShrink: 0, color: d.amount < 0 ? T.neg : T.pos }}
              value={String(d.amount)} onChange={(e) => upd(i, { amount: Number(e.target.value.replace(",", ".")) || 0 })} />
            <select style={{ ...css.input, padding: "5px 8px", fontSize: 12, width: 110, flexShrink: 0 }}
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
      <div style={{ fontSize: 12, color: T.mut, marginTop: 10, background: T.panel2, borderRadius: 8, padding: "8px 12px" }}>
        {accountId
          ? <>Seçili satırlar gerçekleşen kayıt olarak yazılır ve <b>{data.accounts.find((a) => a.id === +accountId)?.name}</b> bakiyesine toplam <span style={{ ...css.mono, color: sum < 0 ? T.neg : T.pos }}>{fmtMoney(sum, "TRY", true)}</span> işler.</>
          : "Hesap seçilmedi — kayıtlar yalnız Rapor'a girer, bakiyeye dokunmaz."}
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
