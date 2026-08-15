import React, { useState, useMemo, useRef } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ReferenceLine,
  PieChart, Pie, Cell,
} from "recharts";
import { monthsBack, monthlyTotals, categoryTotals, transactionsInMonth, parseD, fmtD, ymOf, type AllData, type Category } from "@finans/engine";
import { api } from "../../api";
import { T, css, tl, CATEGORY_PALETTE } from "../../theme";
import { Field, Empty, Money, Row, SilDugmesi, FiltreSeridi, Aciklama } from "../../ui";
import { EditSheet, type EditTarget } from "../../EditSheet";

const fmtYm = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("tr-TR", { month: "short", year: "2-digit" });
};

/* ————— RAPOR (gerçekleşen defterin tamamı) ————— */
/* Aylık trend + kategori dağılımı + işlem listesi + kategori yönetimi.
   Girişler global "+ Ekle"dendir; işlem silme buradadır (hesaba bağlı işlemin
   silinmesi bakiyeyi sunucu tarafında geri alır). */
export function Rapor({ data, reload }: { data: AllData; reload: () => void }) {
  const [range, setRange] = useState(6);
  const curYm = ymOf(new Date());
  const [ym, setYm] = useState(curYm);
  const [editing, setEditing] = useState<EditTarget | null>(null);

  const trend = useMemo(() => {
    const months = monthsBack(range);
    return monthlyTotals(data.transactions, months).map((m) => ({
      x: fmtYm(m.ym), gelir: Math.round(m.income), gider: Math.round(m.expense), net: Math.round(m.net),
    }));
  }, [data.transactions, range]);
  const hasAnyTx = data.transactions.length > 0;

  // kategoriye sabit renk: id sırasına göre atanır, ay filtresi değişince renkler kaymaz
  const catColor = useMemo(() => {
    const sorted = [...data.categories].sort((a, b) => a.id - b.id);
    const idx = new Map(sorted.map((c, i) => [c.id, i]));
    return (id: number | null) => (id != null && idx.has(id) ? CATEGORY_PALETTE[idx.get(id)! % CATEGORY_PALETTE.length] : T.mut);
  }, [data.categories]);

  const totals = categoryTotals(data.transactions, data.categories, ym);
  const incomeCats = totals.filter((t) => t.total > 0);
  const expenseCats = totals.filter((t) => t.total < 0);
  const totalIncome = incomeCats.reduce((s, t) => s + t.total, 0);
  const totalExpense = expenseCats.reduce((s, t) => s + t.total, 0);
  const pieData = expenseCats.map((t) => ({ ...t, value: Math.abs(t.total) }));

  const monthTxs = transactionsInMonth(data.transactions, ym);
  const catById = new Map(data.categories.map((c) => [c.id, c]));
  const accById = new Map(data.accounts.map((a) => [a.id, a]));
  const [cat, setCat] = useState({ name: "", kind: "expense" as Category["kind"] });
  const catNameRef = useRef<HTMLInputElement>(null);
  const catOk = cat.name.trim().length > 0;

  return (<>
    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Aylık Gelir & Gider Trendi</div>
      {/* "Bu grafik neyi gösteriyor?" sorusu kullanıcıdan geldi — kapsamı yazılı değildi.
          Kaynak yalnız `transactions`; plan, kart harcaması ve virman burada YOK. */}
      <Aciklama k="trend-kapsam" label="bu grafik neyi gösteriyor?">
        Ay ay <b>gerçekleşen defterin</b> toplamı: yeşil gelir, kırmızı gider, çizgi ikisinin farkı (net).
        Kapsamı dar tutuluyor — <b>plan buraya girmez</b> (düzenli kalem ancak “Gerçekleşti” ile deftere geçince sayılır),
        <b> kendi hesapların arası transferler</b> girmez (para sistemden çıkmıyor), <b>portföy alım/satımı</b> girmez
        (yatırım harcama değildir). <b>Kart harcaması da girmez</b>: ekstreyi “Ödedim” ile kapattığın ay, tek kalem
        gider olarak görünür — yani kart alışverişinin ayı değil, ödemenin ayı sayılır.
      </Aciklama>
      {/* aralık seçici bir filtredir (veriyi değil pencereyi değiştirir) → filtre şeridine */}
      <FiltreSeridi>
        <select style={{ ...css.input, width: "auto", padding: "5px 8px", fontSize: 12 }} value={range} onChange={(e) => setRange(Number(e.target.value))}>
          {[3, 6, 12, 24].map((m) => <option key={m} value={m}>son {m} ay</option>)}
        </select>
      </FiltreSeridi>
      {!hasAnyTx ? (
        <Empty>"+ Ekle" ile gerçekleşen harcama/gelir kaydettikçe burada bir trend grafiği görünecek.</Empty>
      ) : (
        <div style={{ height: 240, marginTop: 8 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={trend} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid stroke={T.line} strokeDasharray="2 6" vertical={false} />
              <XAxis dataKey="x" tick={{ fill: T.mut, fontSize: 10, fontFamily: T.mono }} tickLine={false} axisLine={{ stroke: T.line }} minTickGap={20} />
              <YAxis tick={{ fill: T.mut, fontSize: 10, fontFamily: T.mono }} tickLine={false} axisLine={false} width={52}
                tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
              <Tooltip contentStyle={{ background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 8, fontFamily: T.mono, fontSize: 12 }}
                labelStyle={{ color: T.mut }} formatter={(v: number) => tl.format(v)} />
              <Legend wrapperStyle={{ fontSize: 12, fontFamily: T.disp }} />
              <ReferenceLine y={0} stroke={T.line} />
              <Bar dataKey="gelir" name="Gelir" fill={T.pos} radius={[4, 4, 0, 0]} />
              <Bar dataKey="gider" name="Gider" fill={T.neg} radius={[4, 4, 0, 0]} />
              <Line dataKey="net" name="Net" stroke={T.acc} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>

    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Kategori Dağılımı</div>
      <FiltreSeridi>
        <input type="month" style={{ ...css.input, width: "auto", padding: "5px 8px", fontSize: 12 }} value={ym} onChange={(e) => setYm(e.target.value || curYm)} />
      </FiltreSeridi>
      {totals.length === 0 ? <Empty>Bu ayda kayıtlı işlem yok.</Empty> : (<>
        <div style={{ display: "flex", gap: 16, fontSize: 13, marginTop: 10, marginBottom: 4 }}>
          <span>Gelir <Money v={Math.round(totalIncome)} sign /></span>
          <span>Gider <Money v={Math.round(totalExpense)} sign /></span>
          <span>Net <Money v={Math.round(totalIncome + totalExpense)} sign /></span>
        </div>

        {pieData.length === 0 ? <Empty>Bu ay gider kategorisi yok.</Empty> : (
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
            <div style={{ width: 140, height: 140, flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" innerRadius={40} outerRadius={65} strokeWidth={0}>
                    {pieData.map((t) => <Cell key={t.category_id ?? "none"} fill={catColor(t.category_id)} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ flex: 1, minWidth: 180, display: "grid", gap: 6 }}>
              {pieData.map((t) => (
                <div key={t.category_id ?? "none"} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span><span style={{ color: catColor(t.category_id) }}>●</span> {t.name} <span style={{ fontSize: 11, color: T.mut }}>× {t.count}</span></span>
                  <span style={css.mono}>{tl.format(Math.round(t.total))}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {incomeCats.length > 0 && (
          <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${T.line}` }}>
            <div style={{ fontSize: 12, color: T.mut, marginBottom: 6 }}>Gelir Kaynakları</div>
            <div style={{ display: "grid", gap: 6 }}>
              {incomeCats.map((t) => (
                <div key={t.category_id ?? "none"} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span><span style={{ color: catColor(t.category_id) }}>●</span> {t.name} <span style={{ fontSize: 11, color: T.mut }}>× {t.count}</span></span>
                  <span style={css.mono}>{tl.format(Math.round(t.total))}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {monthTxs.length > 0 && (
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${T.line}` }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>İşlemler</div>
            {monthTxs.map((t, i) => (
              <Row key={t.id} last={i === monthTxs.length - 1}>
                <span className="row-lead" style={{ ...css.mono, fontSize: 12, color: T.mut, width: 74 }}>{fmtD(parseD(t.date), { day: "2-digit", month: "short", year: "2-digit" })}</span>
                <div className="row-title" style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13 }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: T.mut }}>
                    {t.category_id != null && catById.get(t.category_id) ? catById.get(t.category_id)!.name : "Kategorisiz"}
                    {t.account_id != null && accById.get(t.account_id) && <> · {accById.get(t.account_id)!.name}</>}
                  </div>
                </div>
                <span className="row-amount"><Money v={t.amount} sign /></span>
                <button className="row-end" style={css.edit} title="Düzenle" onClick={() => setEditing({ kind: "transaction", row: t })}>✎</button>
                <SilDugmesi ad={t.name} onSil={async () => { await api.del("transactions", t.id); reload(); }}
                  sonuc={t.account_id != null && accById.get(t.account_id)
                    ? <>Tutar <b>{accById.get(t.account_id)!.name}</b> hesabına geri işlenecek.</>
                    : "Bu işlem bir hesaba bağlı değil; yalnız Rapor'dan düşer."} />
              </Row>
            ))}
          </div>
        )}
      </>)}
    </div>

    <div style={css.card}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Kategoriler</div>
      {data.categories.length === 0 && <Empty>Henüz kategori yok. Market, Ulaşım, Fatura gibi ekleyebilirsin.</Empty>}
      {data.categories.map((c, i) => (
        <Row key={c.id} last={i === data.categories.length - 1}>
          <span className="row-lead" style={{ color: catColor(c.id), fontSize: 12 }}>●</span>
          {/* Faz 18: ad ve tür satır içinde düzenlenir. Sil+yeniden ekle, kategoriye bağlı tüm
              işlemlerin category_id'sini NULL'a düşürürdü (ON DELETE SET NULL) — yani bir yazım
              hatasını düzeltmek geçmiş raporlamayı silmek olurdu. */}
          <input className="row-title" style={{ ...css.input, flex: 1, fontSize: 13, padding: "3px 6px", border: "1px solid transparent", background: "transparent" }}
            defaultValue={c.name} key={c.name} title="Kategori adı (düzenlemek için tıkla)"
            onFocus={(e) => { e.target.style.borderColor = T.line; e.target.style.background = T.panel2; }}
            onBlur={async (e) => {
              e.target.style.borderColor = "transparent"; e.target.style.background = "transparent";
              const v = e.target.value.trim();
              if (v && v !== c.name) { await api.put(`categories/${c.id}`, { name: v }); reload(); }
              else e.target.value = c.name;
            }} />
          {/* row-end: dar bir seçici, alt satıra atılıp her kategoriyi iki satır yapmasın */}
          <select className="row-end" style={{ ...css.input, width: "auto", padding: "3px 6px", fontSize: 11 }} value={c.kind}
            title="Kategori türü"
            onChange={async (e) => { await api.put(`categories/${c.id}`, { kind: e.target.value }); reload(); }}>
            <option value="expense">gider</option><option value="income">gelir</option>
          </select>
          {/* ON DELETE SET NULL: işlemler silinmez, kategorisiz kalır — kullanıcı bunu bilmeli */}
          <SilDugmesi ad={c.name} onSil={async () => { await api.del("categories", c.id); reload(); }}
            sonuc={<>Bu kategorideki işlemler <b>silinmez</b>, "Kategorisiz"e düşer. Geçmiş raporlarda dağılım değişir.</>} />
        </Row>
      ))}
      <form onSubmit={async (e) => {
        e.preventDefault();
        if (!catOk) return;
        await api.post("categories", { name: cat.name.trim(), kind: cat.kind, color: null });
        setCat({ name: "", kind: cat.kind }); catNameRef.current?.focus(); reload();
      }}>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Kategori adı" flex={2}><input ref={catNameRef} style={css.input} value={cat.name} placeholder="örn. Market" onChange={(e) => setCat({ ...cat, name: e.target.value })} /></Field>
          <Field label="Tür">
            <select style={css.input} value={cat.kind} onChange={(e) => setCat({ ...cat, kind: e.target.value as Category["kind"] })}>
              <option value="expense">Gider</option><option value="income">Gelir</option>
            </select>
          </Field>
          <button type="submit" style={{ ...css.btn, opacity: catOk ? 1 : 0.4 }} disabled={!catOk}>Kategori Ekle</button>
        </div>
      </form>
    </div>

    {editing && <EditSheet data={data} target={editing} reload={reload} onClose={() => setEditing(null)} />}
  </>);
}
