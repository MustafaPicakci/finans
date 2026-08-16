import React, { useMemo, useState } from "react";
import {
  tumKayitlar, kayitSuz, kayitlariAyaGoreGrupla, parseD, fmtD,
  type AllData, type Kayit, type KayitTuru,
} from "@finans/engine";
import { api } from "../../api";
import { T, css, fmtMoney } from "../../theme";
import { Empty, Row, SilDugmesi, FiltreSeridi } from "../../ui";
import { EditSheet, type EditTarget } from "../../EditSheet";

/* ————— KAYITLAR —————
   Eski "Rapor" sekmesinin yerine geçti (Faz 26). Rapor dört jenerik parça gösteriyordu
   (trend çubukları, kategori pastası, tek ayın işlem listesi, kategori yönetimi) ve kullanıcı
   "bana anlamlı hiçbir bilgi vermiyor, hiç kullanmıyorum" dedi. İki sebebi vardı: harcamanın
   çoğu kartta olduğundan grafikler neredeyse boş kalıyordu, ve ekran bir SORUYA cevap
   vermiyordu — "elimizdeki veriyle ne çizebiliriz"in cevabıydı.

   Bu ekran tek bir soruya cevap verir: **"şu kaydı nerede/ne zaman girmiştim?"** Bugüne dek
   bunun için üç sekme dolaşmak gerekiyordu. Grafik yok, toplam yok (türler arası toplam
   yanıltıcı olurdu — bkz. engine/kayitlar.ts), yalnız arama + süzme + düzeltme.

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

export function Kayitlar({ data, reload }: { data: AllData; reload: () => void }) {
  const [sorgu, setSorgu] = useState("");
  const [tur, setTur] = useState<KayitTuru | "hepsi">("hepsi");
  const [donem, setDonem] = useState(3);
  const [limit, setLimit] = useState(60);
  const [editing, setEditing] = useState<EditTarget | null>(null);

  const hepsi = useMemo(() => tumKayitlar(data), [data]);
  const suzulmus = useMemo(
    () => kayitSuz(hepsi, { tur, from: sinceOf(donem), sorgu }),
    [hepsi, tur, donem, sorgu],
  );
  /* Uzun listede tarayıcıyı boğmamak için parça parça gösterilir. Süzgeç değişince
     baştan başlar — aksi halde arama sonucu 60'ta kalır ve "daha fazla" düğmesi
     alakasız görünürdü. */
  React.useEffect(() => { setLimit(60); }, [tur, donem, sorgu]);
  const gosterilen = suzulmus.slice(0, limit);
  const gruplar = useMemo(() => kayitlariAyaGoreGrupla(gosterilen), [gosterilen]);

  /** Kaydı kendi düzenleme formunda açar — kayıt türü ne olursa olsun aynı sayfada kalınır. */
  const duzenle = (k: Kayit) => {
    if (k.tur === "gelir-gider") { const r = data.transactions.find((x) => x.id === k.id); if (r) setEditing({ kind: "transaction", row: r }); }
    else if (k.tur === "kart") { const r = data.card_txs.find((x) => x.id === k.id); if (r) setEditing({ kind: "cardtx", row: r }); }
    else if (k.tur === "virman") { const r = data.transfers.find((x) => x.id === k.id); if (r) setEditing({ kind: "transfer", row: r }); }
    else { const r = data.trades.find((x) => x.id === k.id); if (r) setEditing({ kind: "trade", row: r }); }
  };

  /** Silme yolu ve sonucu türe göre değişir — onay kutusu bunu yazar (bkz. SilDugmesi). */
  const silBilgi = (k: Kayit): { yol: string; sonuc: React.ReactNode } => {
    switch (k.tur) {
      case "gelir-gider": return { yol: "transactions", sonuc: "Kayıt silinir; bir hesaba bağlıysa tutar o hesaba geri işlenir." };
      case "kart": return { yol: "cardtxs", sonuc: "Harcama ilgili ekstreden düşer; taksitliyse tüm taksitler kalkar." };
      case "virman": return { yol: "transfers", sonuc: <>Virmanın <b>iki bacağı birden</b> geri alınır.</> };
      default: return { yol: "trades", sonuc: "Pozisyon ve ortalama maliyet yeniden hesaplanır; hesaba bağlıysa tutar geri işlenir." };
    }
  };

  return (<>
    <div style={css.card}>
      {/* Kart başlığı yok: üst çubuk zaten "Kayıtlar" diyor, ikinci kez yazmak yer israfı.
          Sayaç süzgecin ne kadarını gösterdiğini söyler — "kayıt yok" ile "süzgeç dar" farkı. */}
      <div style={{ fontSize: 12, color: T.mut, textAlign: "right", marginBottom: 4 }}>
        {suzulmus.length === hepsi.length
          ? `${hepsi.length} kayıt`
          : `${hepsi.length} kayıttan ${suzulmus.length} tanesi`}
      </div>

      <FiltreSeridi>
        <input
          style={{ ...css.input, width: "auto", flex: "1 1 180px", minWidth: 140, padding: "6px 10px", fontSize: 13 }}
          placeholder="ara: migros, kira, garanti…" value={sorgu} onChange={(e) => setSorgu(e.target.value)}
          /* Arama Türkçe'ye toleranslıdır (bkz. engine/kayitlar.ts): büyük I/ı tuzağı ve
             Türkçe karakter yazmadan arama engine tarafında çözülür. */
        />
        <select style={{ ...css.input, width: "auto", padding: "6px 8px", fontSize: 12.5 }}
          value={tur} onChange={(e) => setTur(e.target.value as KayitTuru | "hepsi")}>
          {(Object.keys(TUR_ETIKET) as (KayitTuru | "hepsi")[]).map((k) => (
            <option key={k} value={k}>{TUR_ETIKET[k]}</option>
          ))}
        </select>
        <span style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: `1px solid ${T.line}` }}>
          {DONEMLER.map((d) => (
            <button key={d.v} type="button" onClick={() => setDonem(d.v)} style={{
              padding: "6px 10px", border: "none", cursor: "pointer", fontSize: 12, fontFamily: T.disp,
              fontWeight: donem === d.v ? 700 : 500,
              background: donem === d.v ? T.panel : "transparent", color: donem === d.v ? T.acc : T.mut,
            }}>{d.label}</button>
          ))}
        </span>
      </FiltreSeridi>

      {suzulmus.length === 0 && (
        <Empty>{sorgu ? `“${sorgu}” için kayıt yok. Dönemi genişletmeyi dene.` : "Bu süzgeçle kayıt yok."}</Empty>
      )}

      {gruplar.map((g) => (
        <div key={g.ym}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: T.mut3, margin: "14px 0 2px" }}>
            {fmtYm(g.ym)}
          </div>
          {g.kayitlar.map((k, i) => {
            const { yol, sonuc } = silBilgi(k);
            const renk = k.yon === "giris" ? T.pos : k.yon === "cikis" ? T.neg : T.mut;
            const isaret = k.yon === "giris" ? "+" : k.yon === "cikis" ? "−" : "";
            return (
              <Row key={k.key} last={i === g.kayitlar.length - 1}>
                <span className="row-lead" style={{ ...css.mono, fontSize: 11.5, color: T.mut3, width: 46 }}>
                  {fmtD(parseD(k.date), { day: "2-digit", month: "short" })}
                </span>
                <div className="row-title" style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: TUR_RENK[k.tur], flexShrink: 0 }}>{k.etiket.toUpperCase()}</span>
                    <span>{k.ad}</span>
                  </div>
                  {k.detay && <div style={{ fontSize: 11, color: T.mut3, marginTop: 1 }}>{k.detay}</div>}
                </div>
                <span className="row-amount" style={{ ...css.mono, fontSize: 13.5, marginLeft: "auto", color: renk }}>
                  {k.yon === "notr" && k.tutar === 0 ? "—" : `${isaret}${fmtMoney(k.tutar, k.currency)}`}
                </span>
                <button className="row-end" style={css.edit} title="Düzenle" onClick={() => duzenle(k)}>✎</button>
                <SilDugmesi ad={k.ad} sonuc={sonuc}
                  onSil={async () => { await api.del(yol, k.id); reload(); }} />
              </Row>
            );
          })}
        </div>
      ))}

      {suzulmus.length > gosterilen.length && (
        <button style={{ ...css.ghost, marginTop: 12, padding: "7px 12px", fontSize: 12.5 }}
          onClick={() => setLimit((l) => l + 120)}>
          Daha eski kayıtlar ({suzulmus.length - gosterilen.length})
        </button>
      )}
    </div>

    {editing && <EditSheet data={data} target={editing} reload={reload} onClose={() => setEditing(null)} />}
  </>);
}
