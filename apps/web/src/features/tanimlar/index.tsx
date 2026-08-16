import React, { useState, useRef } from "react";
import type { AllData, Category } from "@finans/engine";
import { api } from "../../api";
import { T, css } from "../../theme";
import { Field, Empty, Row, SilDugmesi } from "../../ui";

/* ————— TANIMLAR —————
   Nadiren dokunulan tanım kayıtlarının evi. Ana menüde DEĞİL (menü zaten sekiz sekme ve orası
   günlük iş için); Hesabım gibi kenar çubuğundan / mobil ⋯ menüsünden açılır.

   Şimdilik yalnız kategoriler var. Kategorinin "kendi sekmesi" yoktu — hesap Hesaplar'da, kart
   Kartlar'da, portföy grubu Portföy'de düzenlenirken kategori tek istisnaydı ve eski Rapor
   sekmesinin dibinde asılı kalmıştı. Buraya yeni bir tanım türü eklenirse (etiket, bütçe limiti)
   evi hazır. */
export function Tanimlar({ data, reload }: { data: AllData; reload: () => void }) {
  return (<>
    <div style={{ ...css.card, padding: 16 }}>
      <div style={{ fontSize: 12.5, color: T.mut, lineHeight: 1.55 }}>
        Burası nadiren gelinen bir yer. Günlük kullanımda kategoriyi <b>kaydı girerken</b>
        {" "}oluşturabilirsin — gelir/gider formundaki kategori alanında “+ Yeni kategori…”.
        Buraya ad değiştirmek, tür düzeltmek veya silmek için gelirsin.
      </div>
    </div>
    <Kategoriler data={data} reload={reload} />
  </>);
}

/* ————— KATEGORİ YÖNETİMİ ————— */
/* Eski Rapor sekmesinden taşındı. Kategoriler gelir/gider kayıtlarını, düzenli kalemleri ve
   ekstre ödemelerini sınıflandırır; silinince bağlı işlemler SİLİNMEZ, "Kategorisiz"e düşer
   (ON DELETE SET NULL) — onay kutusu bunu yazar. */
export function Kategoriler({ data, reload }: { data: AllData; reload: () => void }) {
  const [cat, setCat] = useState({ name: "", kind: "expense" as Category["kind"] });
  const nameRef = useRef<HTMLInputElement>(null);
  const ok = cat.name.trim().length > 0;
  const ekle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    await api.post("categories", { name: cat.name.trim(), kind: cat.kind });
    setCat({ name: "", kind: cat.kind });
    reload();
    nameRef.current?.focus();
  };
  return (
    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Kategoriler</div>
      {data.categories.length === 0 && <Empty>Henüz kategori yok. Market, Ulaşım, Fatura gibi ekleyebilirsin.</Empty>}
      {data.categories.map((c, i) => (
        <Row key={c.id} last={i === data.categories.length - 1}>
          <span className="row-lead" style={{ color: c.kind === "income" ? T.pos : T.neg, fontSize: 12 }}>●</span>
          {/* Ad satır içinde düzenlenir: sil+yeniden ekle, bağlı tüm işlemlerin kategorisini
              düşürürdü — yazım hatası düzeltmek geçmiş sınıflandırmayı silmek olamaz. */}
          <input className="row-title" style={{ ...css.input, flex: 1, fontSize: 13, padding: "3px 6px", border: "1px solid transparent", background: "transparent" }}
            defaultValue={c.name} key={c.name} title="Kategori adı (düzenlemek için tıkla)"
            onFocus={(e) => { e.target.style.borderColor = T.line; e.target.style.background = T.panel2; }}
            onBlur={async (e) => {
              e.target.style.borderColor = "transparent"; e.target.style.background = "transparent";
              const v = e.target.value.trim();
              if (v && v !== c.name) { await api.put(`categories/${c.id}`, { name: v }); reload(); }
              else e.target.value = c.name;
            }} />
          <select className="row-end" style={{ ...css.input, width: "auto", padding: "3px 6px", fontSize: 11 }} value={c.kind}
            title="Kategori türü"
            onChange={async (e) => { await api.put(`categories/${c.id}`, { kind: e.target.value }); reload(); }}>
            <option value="expense">gider</option><option value="income">gelir</option>
          </select>
          <SilDugmesi ad={c.name} onSil={async () => { await api.del("categories", c.id); reload(); }}
            sonuc={<>Bu kategorideki işlemler <b>silinmez</b>, "Kategorisiz"e düşer.</>} />
        </Row>
      ))}
      <form onSubmit={ekle} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <Field label="Kategori adı" flex={2}>
          <input ref={nameRef} style={css.input} placeholder="örn. Market" value={cat.name}
            onChange={(e) => setCat({ ...cat, name: e.target.value })} />
        </Field>
        <Field label="Tür">
          <select style={css.input} value={cat.kind} onChange={(e) => setCat({ ...cat, kind: e.target.value as Category["kind"] })}>
            <option value="expense">Gider</option><option value="income">Gelir</option>
          </select>
        </Field>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button style={{ ...css.btn, opacity: ok ? 1 : 0.5 }} disabled={!ok}>Kategori Ekle</button>
        </div>
      </form>
    </div>
  );
}
