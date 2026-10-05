import React, { useMemo, useState } from "react";
import {
  tumKayitlar, kayitSuz, kayitlariAyaGoreGrupla, parseD, fmtD,
  type AllData, type Kayit, type KayitTuru,
} from "@finans/engine";
import { T, css, fmtMoney } from "../../theme";
import { Empty, useSayfalama, DahaFazla } from "../../ui";
import { Segment } from "../forms/parcalar";
import { EditSheet, type EditTarget } from "../../EditSheet";
import { HarcamaOzetiKarti } from "./Ozet";

/* ————— KAYITLAR —————
   Eski "Rapor" sekmesinin yerine geçti (Faz 26). Rapor dört jenerik parça gösteriyordu
   (trend çubukları, kategori pastası, tek ayın işlem listesi, kategori yönetimi) ve kullanıcı
   "bana anlamlı hiçbir bilgi vermiyor, hiç kullanmıyorum" dedi. İki sebebi vardı: harcamanın
   çoğu kartta olduğundan grafikler neredeyse boş kalıyordu, ve ekran bir SORUYA cevap
   vermiyordu — "elimizdeki veriyle ne çizebiliriz"in cevabıydı.

   Bu ekran tek bir soruya cevap verir: **"şu kaydı nerede/ne zaman girmiştim?"** Bugüne dek
   bunun için üç sekme dolaşmak gerekiyordu. Grafik yok, yalnız arama + süzme + düzeltme.

   **Faz 40 — ALTTAKİ LİSTE hâlâ toplam üretmez**, o yasak yerinde: türler arası ham toplam
   yanıltıcıdır (kart harcaması + onun ekstre ödemesi aynı parayı iki kez sayar, virman hiç para
   hareketi değildir — bkz. engine/kayitlar.ts). Üstteki "Harcama Özeti" kartı ayrı bir bölümdür
   ve tam da o tuzağı çözen `harcamaOzeti`'ni çağırır: bir TEMEL seçtirir ve hangisini kullandığını
   yazar. Aynı süzgeçleri (dönem + arama) paylaşırlar, yani iki rakam hiçbir zaman farklı satır
   kümesini anlatmaz. Panel `finans-kayitlar-ozet` ile kapatılabilir.

   **Yeniden tasarım (Ekim 2026, grup 5)**: ekranın sorusu arama olduğundan büyük arama kutusu en
   üstte, tür ve dönem altında segment. Özet kapalıyken TEK satır (gider · gelir), açılınca kırılım
   (tercih `finans-kayitlar-ozet`; eskiden "0" paneli tamamen gizliyordu, şimdi tek satıra indirir).
   Satırın tamamı düzenlemeyi açar — ✎ ✕ yok, silme düzenleme sayfasında (Faz 24 kural 1).
   Masaüstünde liste solda, özet sağda (`.kayit-izgara` alanları).

   Kategori yönetimi burada DEĞİL: nadiren dokunulan bir tanım, sık kullanılan bir arama
   ekranının dibinde durunca tam da Rapor'un hatasını tekrarlıyordu. Tanımlar ekranına taşındı;
   günlük akışta kategori zaten formun içinde oluşturuluyor (bkz. forms/KategoriAlani.tsx). */

const TUR_ETIKET: Record<KayitTuru | "hepsi", string> = {
  hepsi: "Hepsi", "gelir-gider": "Gelir/Gider", kart: "Kart", virman: "Virman", portfoy: "Portföy",
};
const TUR_RENK: Record<KayitTuru, string> = {
  "gelir-gider": "var(--type-nakit)", kart: "var(--cat-8)", virman: "var(--cat-3)", portfoy: "var(--brand)",
};
const DONEMLER: { v: number; label: string }[] = [
  { v: 3, label: "3 ay" }, { v: 12, label: "1 yıl" }, { v: 0, label: "Tümü" },
];

/** N ay öncesinin ISO tarihi (0 → sınır yok) */
const sinceOf = (months: number): string => {
  if (!months) return "";
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
};

const fmtYm = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
};

/** "ALIŞ" → "Alış": portföy etiketi büyük harf geliyor (enum değeri), diğerleri baş harfi büyük */
const basHarf = (s: string) => s.charAt(0) + s.slice(1).toLocaleLowerCase("tr");

export function Kayitlar({ data, reload }: { data: AllData; reload: () => void }) {
  const [sorgu, setSorgu] = useState("");
  const [tur, setTur] = useState<KayitTuru | "hepsi">("hepsi");
  const [donem, setDonem] = useState(3);
  /* Tercih kalıcı. Varsayılan AÇIK: panelin var olma sebebi rakamın görünmesi; kapalıyken de
     toplam tek satırda kalır, yalnız kırılım katlanır. */
  const [ozet, setOzet] = useState(() => {
    try { return localStorage.getItem("finans-kayitlar-ozet") !== "0"; } catch { return true; }
  });
  const ozetCevir = () => setOzet((v) => {
    try { localStorage.setItem("finans-kayitlar-ozet", v ? "0" : "1"); } catch { /* özel pencere */ }
    return !v;
  });

  const [editing, setEditing] = useState<EditTarget | null>(null);

  const hepsi = useMemo(() => tumKayitlar(data), [data]);
  const suzulmus = useMemo(
    () => kayitSuz(hepsi, { tur, from: sinceOf(donem), sorgu }),
    [hepsi, tur, donem, sorgu],
  );
  /* Uzun listede tarayıcıyı boğmamak için parça parça gösterilir; süzgeç değişince
     baştan başlar (`anahtar`). Satır tek katmanlı olduğundan dilim geniş. */
  const s2 = useSayfalama(suzulmus, 60, `${tur}|${donem}|${sorgu}`);
  const gosterilen = s2.gorunen;
  const gruplar = useMemo(() => kayitlariAyaGoreGrupla(gosterilen), [gosterilen]);

  /** Kaydı kendi düzenleme formunda açar — silme de orada (EditSheet, türün yan etkisiyle). */
  const duzenle = (k: Kayit) => {
    if (k.tur === "gelir-gider") { const r = data.transactions.find((x) => x.id === k.id); if (r) setEditing({ kind: "transaction", row: r }); }
    else if (k.tur === "kart") { const r = data.card_txs.find((x) => x.id === k.id); if (r) setEditing({ kind: "cardtx", row: r }); }
    else if (k.tur === "virman") { const r = data.transfers.find((x) => x.id === k.id); if (r) setEditing({ kind: "transfer", row: r }); }
    else { const r = data.trades.find((x) => x.id === k.id); if (r) setEditing({ kind: "trade", row: r }); }
  };

  return (<>
    <div className="kayit-izgara">
      <div style={{ gridArea: "ara", display: "grid", gap: 10, minWidth: 0 }}>
        {/* Arama Türkçe'ye toleranslıdır (bkz. engine/kayitlar.ts): büyük I/ı tuzağı ve
            Türkçe karakter yazmadan arama engine tarafında çözülür. */}
        <label style={{
          display: "flex", alignItems: "center", gap: 10, height: 48, padding: "0 14px", boxSizing: "border-box",
          background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14,
        }}>
          <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke={T.mut} strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
          <input value={sorgu} onChange={(e) => setSorgu(e.target.value)} placeholder="Ara: migros, kira, garanti…" aria-label="Kayıtlarda ara"
            style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 16, fontFamily: T.disp, color: T.text, padding: 0, minHeight: 0 }} />
          {sorgu && (
            <button type="button" aria-label="Aramayı temizle" onClick={() => setSorgu("")} style={{ background: "none", border: "none", color: T.mut, cursor: "pointer", padding: 4, minHeight: 0 }}>
              <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
            </button>
          )}
        </label>
        {/* Görünüm süzgeçleri: çukur segment (Faz 24 kural 2 — seçili beyaz yüzey + mor metin).
            Tür şeridi 390px'e sığmıyor → yatay kayar. */}
        <div style={{ overflowX: "auto", scrollbarWidth: "none" }}>
          <div style={{ display: "inline-flex", minWidth: "100%" }}>
            <Segment kucuk ad="Kayıt türü" deger={tur} sec={setTur}
              secenek={(Object.keys(TUR_ETIKET) as (KayitTuru | "hepsi")[]).map((k) => ({ v: k, l: TUR_ETIKET[k] }))} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Segment kucuk ad="Dönem" deger={String(donem)} sec={(v) => setDonem(+v)}
            secenek={DONEMLER.map((d) => ({ v: String(d.v), l: d.label }))} />
          {/* Sayaç süzgecin ne kadarını gösterdiğini söyler — "kayıt yok" ile "süzgeç dar" farkı */}
          <span style={{ marginLeft: "auto", fontSize: 13, color: T.mut, whiteSpace: "nowrap" }}>
            {suzulmus.length === hepsi.length ? `${hepsi.length} kayıt` : `${suzulmus.length} / ${hepsi.length} kayıt`}
          </span>
        </div>
      </div>

      <div style={{ gridArea: "ozet", minWidth: 0 }}>
        <HarcamaOzetiKarti data={data} reload={reload} baslangic={sinceOf(donem)} sorgu={sorgu}
          turSuzgeciAcik={tur !== "hepsi"} acik={ozet} onCevir={ozetCevir} donemAdi={DONEMLER.find((d) => d.v === donem)?.label ?? ""} />
      </div>

      <div style={{ ...css.card, gridArea: "liste", padding: "4px 16px 10px", minWidth: 0 }}>
        {suzulmus.length === 0 && (
          <Empty>{sorgu ? `“${sorgu}” için kayıt yok. Dönemi genişletmeyi dene.` : "Bu süzgeçle kayıt yok."}</Empty>
        )}
        {gruplar.map((g) => (
          <div key={g.ym}>
            <div style={{ fontSize: 13, fontWeight: 650, color: T.mut, padding: "14px 0 4px" }}>{fmtYm(g.ym)}</div>
            {g.kayitlar.map((k, i) => {
              const renk = k.yon === "giris" ? T.pos : k.yon === "cikis" ? T.neg : T.text;
              const isaret = k.yon === "giris" ? "+" : k.yon === "cikis" ? "−" : "";
              const turRenk = k.tur === "gelir-gider" ? (k.yon === "giris" ? T.pos : T.neg) : TUR_RENK[k.tur];
              const d = parseD(k.date);
              return (
                <button key={k.key} type="button" className="liste-satir" onClick={() => duzenle(k)} title="Düzenle"
                  style={{
                    display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
                    padding: "10px 6px", margin: "0 -6px", boxSizing: "content-box", cursor: "pointer",
                    background: "transparent", border: "none", borderTop: i === 0 ? "none" : `1px solid ${T.line2}`, borderRadius: 8,
                    color: T.text, fontFamily: T.disp,
                  }}>
                  <span style={{ width: 32, textAlign: "center", lineHeight: 1.1, flexShrink: 0 }}>
                    <span style={{ ...css.mono, display: "block", fontSize: 15, fontWeight: 600 }}>{fmtD(d, { day: "2-digit" })}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: T.mut }}>{fmtD(d, { month: "short" })}</span>
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.ad}</span>
                    <span style={{ display: "block", fontSize: 12.5, color: T.mut, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <span style={{ color: turRenk, fontWeight: 600 }}>{basHarf(k.etiket)}</span>{k.detay ? ` · ${k.detay}` : ""}
                    </span>
                  </span>
                  <span style={{ ...css.mono, fontSize: 15, color: renk, flexShrink: 0, whiteSpace: "nowrap" }}>
                    {k.yon === "notr" && k.tutar === 0 ? "—" : `${isaret}${fmtMoney(k.tutar, k.currency)}`}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        <DahaFazla s={s2} ad="kayıt" />
      </div>
    </div>

    {editing && <EditSheet data={data} target={editing} reload={reload} onClose={() => setEditing(null)} />}
  </>);
}
