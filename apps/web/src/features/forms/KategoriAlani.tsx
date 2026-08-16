import React, { useRef, useState } from "react";
import type { AllData, Category } from "@finans/engine";
import { api } from "../../api";
import { T, css } from "../../theme";
import { Field } from "../../ui";

/* ————— KATEGORİ ALANI (Faz 26 — "C") —————
   Kategori seçerken YERİNDE oluşturmayı sağlar. Öncesinde kategori yalnız yönetim ekranından
   açılabiliyordu: harcamayı girerken uygun kategori yoksa ya formu terk edip kategori eklemen
   ya da "Kategorisiz" bırakman gerekiyordu — ikincisi hep kazanır, çünkü akışı bölmek pahalıdır.
   Sonuç: kategoriler eksik kalıyor, kategoriye dayanan her şey anlamsızlaşıyordu.

   Yeni kategorinin türü (gelir/gider) FORMDAN gelir, kullanıcıya ayrıca sorulmaz — bir gider
   kaydı girerken oluşturulan kategori gider kategorisidir; başka bir şey olması anlamsız.

   Yönetim (ad değiştirme, silme) burada YOK, bilinçli: nadir işlerdir ve Tanımlar ekranındadır.
   Form, sık olanı ucuz yapar; nadir olanı başka yere bırakır. */
export function KategoriAlani({ data, value, onChange, kind, reload, label = "Kategori", flex = 2 }: {
  data: AllData;
  /** seçili kategori id'si, string ("" = Kategorisiz) — form state'i böyle tutuyor */
  value: string;
  onChange: (v: string) => void;
  /** yeni oluşturulacak kategorinin türü — formun gelir/gider seçimi */
  kind: Category["kind"];
  reload: () => void;
  label?: string;
  flex?: number;
}) {
  const [yeni, setYeni] = useState<string | null>(null); // null = seçici, string = yeni ad girişi
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const olustur = async () => {
    const ad = (yeni ?? "").trim();
    if (!ad || busy) return;
    /* Aynı adda kategori varsa yenisini AÇMA, mevcudu seç — yoksa "Market" iki kez oluşur ve
       dağılım ikiye bölünür. Karşılaştırma Türkçe duyarlı küçültme ile. */
    const mevcut = data.categories.find(
      (c) => c.name.toLocaleLowerCase("tr") === ad.toLocaleLowerCase("tr"),
    );
    if (mevcut) { onChange(String(mevcut.id)); setYeni(null); return; }
    setBusy(true);
    try {
      const { id } = await api.post("categories", { name: ad, kind }) as { id: number };
      onChange(String(id)); // reload'ı beklemeden seç: liste tazelendiğinde zaten orada olacak
      setYeni(null);
      reload();
    } finally { setBusy(false); }
  };

  if (yeni !== null) {
    /* Yazma modunda alan TAM SATIR alır: metin kutusu + Ekle + Vazgeç üçlüsü, yanındaki
       "Hesap" seçicisiyle satırı paylaşınca kutu ~60px'e düşüyor ve kategori adı okunmuyordu. */
    return (
      <div style={{ flex: "1 1 100%", minWidth: 0 }}>
        <div style={css.label}>{label} — yeni</div>
        <div style={{ display: "flex", gap: 6 }}>
          <input ref={ref} autoFocus style={{ ...css.input, flex: 1, minWidth: 0 }} value={yeni}
            placeholder={kind === "income" ? "örn. Kira geliri" : "örn. Market"}
            onChange={(e) => setYeni(e.target.value)}
            /* Enter formu GÖNDERMEZ, kategoriyi oluşturur — aksi halde kategori adını yazıp
               Enter'a basmak kaydı yarım kategoriyle kaydederdi. */
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); olustur(); }
              else if (e.key === "Escape") { e.preventDefault(); setYeni(null); }
            }} />
          <button type="button" style={{ ...css.btn, padding: "0 12px", fontSize: 12.5, opacity: yeni.trim() && !busy ? 1 : 0.5 }}
            disabled={!yeni.trim() || busy} onClick={olustur}>{busy ? "…" : "Ekle"}</button>
          <button type="button" style={{ ...css.ghost, padding: "0 10px", fontSize: 12.5 }}
            onClick={() => setYeni(null)}>✕</button>
        </div>
      </div>
    );
  }

  return (
    <Field label={label} flex={flex}>
      <select style={css.input} value={value}
        onChange={(e) => (e.target.value === "__yeni" ? setYeni("") : onChange(e.target.value))}>
        <option value="">Kategorisiz</option>
        {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        <option value="__yeni">+ Yeni kategori…</option>
      </select>
    </Field>
  );
}
