import React, { useMemo, useState } from "react";
import { harcamaOzeti, type AllData, type HarcamaGrup, type HarcamaTemeli } from "@finans/engine";
import { T, css, fmtMoney } from "../../theme";
import { useSayfalama, DahaFazla } from "../../ui";
import { Segment } from "../forms/parcalar";
import { KategorileModal, kategorisizGruplar } from "./Kategorile";

/* ————— HARCAMA ÖZETİ (Faz 40) —————
   `harcamaOzeti` Faz 35'te yazıldı ama YALNIZ asistan çağırıyordu: "bu ay ne harcadım"ın cevabı
   vardı, ekranı yoktu. Konuşmayan kullanıcı için rakam hiç yoktu.

   Faz 26'da Kayıtlar ekranı bilerek TOPLAMSIZ yazılmıştı ve o karar doğruydu — ama gerekçesi
   "toplam yanlıştır" değil, **"türler arası ham toplam yanıltıcıdır"**dı (kart harcaması + onun
   ekstre ödemesi aynı parayı iki kez sayar, virman hiç para hareketi değildir). `harcamaOzeti`
   tam olarak bunu çözüyor: bir TEMEL seçtiriyor ve hangisini kullandığını yazıyor. Yani burada
   çelişki yok; yasak olan şey hâlâ yasak — aşağıdaki liste toplam üretmez, özet ayrı bir
   bölümdür ve neyi saydığını söyler.

   İkinci ön koşul Faz 39'du: kart harcamasının kategorisi yokken kategori kırılımı kullanıcının
   parasının küçük bir kısmını anlatıyordu (Faz 4'ün Rapor sekmesinin kaldırılma sebebi). Kolon
   gelince kırılım anlamlı hâle geldi — ekranı o yüzden şimdi yapılabildi.

   SÜZGEÇ PAYLAŞIMI: dönem ve arama YUKARIDAKİ şeritten gelir, yani özet ile liste **aynı
   satırları** anlatır (ayrı bir tarih seçici koymak, aynı ekranda birbirini tutmayan iki rakam
   demekti). Özetin kendi iki kontrolü var: temel ve kırılım. Tür süzgeci (virman/portföy) özete
   UYGULANMAZ ve bu sessiz bırakılmaz — kapsam dışı bir tür seçiliyse panel bunu yazar. */

const TEMEL_ETIKET: Record<HarcamaTemeli, string> = { tuketim: "Tüketim", nakit: "Nakit" };
const GRUP_ETIKET: Record<Exclude<HarcamaGrup, "yok">, string> = {
  kategori: "Kategoriye göre", ay: "Aya göre", kart: "Karta göre",
};

const bugun = () => new Date().toISOString().slice(0, 10);
/* Engine "2026-09" döndürür (makine anahtarı, sıralanabilir olması bilinçli). Ekranda ham
   basmak alttaki listenin ay başlığıyla ("EYLÜL 2026") çelişiyordu — aynı ekranda aynı ay
   iki biçimde yazılmamalı. */
const fmtKalemAdi = (ad: string, grup: HarcamaGrup): string => {
  if (grup !== "ay") return ad;
  const [y, m] = ad.split("-").map(Number);
  if (!y || !m) return ad;
  return new Date(y, m - 1, 1).toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
};

export function HarcamaOzetiKarti(
  { data, reload, baslangic, sorgu, turSuzgeciAcik, acik, onCevir, donemAdi }:
  { data: AllData; reload: () => void; baslangic: string; sorgu: string; turSuzgeciAcik: boolean;
    /** kapalıyken yalnız toplam satırı (yeniden tasarım, grup 5) */
    acik: boolean; onCevir: () => void; donemAdi: string },
) {
  const [kategorile, setKategorile] = useState(false);
  const [temel, setTemel] = useState<HarcamaTemeli>("tuketim");
  const [grup, setGrup] = useState<Exclude<HarcamaGrup, "yok">>("kategori");

  /* Ekstre ödemesi ADINDAN değil bu id listesinden tanınır (Faz 40'ta /api/all'a açıldı).
     Alan yoksa (eski sunucu / PWA önbelleği) liste boş kalır: eleme yapılamaz, uydurulmaz —
     panel bunu aşağıda ayrıca söyler. */
  const ekstreTxIds = useMemo(
    () => (data.statement_payments ?? []).map((p) => p.tx_id).filter((x): x is number => x != null),
    [data.statement_payments],
  );
  const ekstreIdYok = temel === "tuketim" && ekstreTxIds.length === 0
    && data.statement_payments.length > 0;

  const o = useMemo(() => harcamaOzeti(
    {
      transactions: data.transactions, card_txs: data.card_txs, categories: data.categories,
      /* accounts YALNIZ metin süzgeci için: alttaki liste hesap adını da tarıyor, bu fonksiyon
         taramıyordu — paylaşılan arama kutusu iki yarıyı farklı satır kümesine süzüyordu. */
      cards: data.cards, accounts: data.accounts, ekstreTxIds,
    },
    { baslangic: baslangic || "0000-01-01", bitis: bugun(), temel, grup, metin: sorgu },
  ), [data.transactions, data.card_txs, data.categories, data.cards, data.accounts, ekstreTxIds, baslangic, sorgu, temel, grup]);

  /* Düğmenin sayısı modalın listesiyle aynı fonksiyondan gelir (bkz. kategorisizGruplar). */
  const kategorisiz = useMemo(
    () => kategorisizGruplar(data, { baslangic, sorgu, ekstreTxIds }),
    [data, baslangic, sorgu, ekstreTxIds],
  );

  /* Kırılım listesi kategori/kart sayısıyla sınırlı (monoton büyümez) ama "aya göre" + "Tümü"
     uzun bir liste üretebilir; dilim o yüzden var, süzgeç değişince başa sarar.
     "ay" TERS ÇEVRİLİR: engine kronolojik döndürür (sıralanabilir olması bilinçli) ama dilim
     baştan alındığı için "1 yıl"/"Tümü" seçilince kart EN ESKİ 8 ayı gösteriyor, içinde
     bulunulan ayı "daha fazla"nın arkasına saklıyordu — üstelik etiket "daha eski" diyorken
     açılan aylar daha YENİydi. Alttaki kayıt listesi de yeniden eskiye akıyor. */
  const kalemler = useMemo(() => (grup === "ay" ? [...o.kalemler].reverse() : o.kalemler), [o.kalemler, grup]);
  const s = useSayfalama(kalemler, 8, `${temel}|${grup}|${baslangic}|${sorgu}`);
  const enBuyuk = kalemler.reduce((m, k) => Math.max(m, k.gider), 0);

  const kategorisizToplam = kategorisiz.reduce((t, g) => t + g.toplam, 0);
  const baglanti: React.CSSProperties = { background: "none", border: "none", padding: "4px 0", minHeight: 0, cursor: "pointer", fontFamily: T.disp, fontSize: 14, fontWeight: 600, color: T.acc, whiteSpace: "nowrap" };
  const donemEtiket = donemAdi === "Tümü" ? "Tüm kayıtlar" : `Son ${donemAdi}`;

  /* KAPALI: tek satır — rakam yine görünür, yalnız kırılım ve kontroller katlı. */
  if (!acik) {
    return (
      <div style={{ ...css.card, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, color: T.mut }}>{donemEtiket}{temel === "nakit" ? " · nakit temeli" : ""}</div>
          <div style={{ fontSize: 14 }}>
            gider <b style={{ ...css.mono, fontWeight: 600, color: T.neg, whiteSpace: "nowrap" }}>{fmtMoney(o.gider, "TRY")}</b>
            {" · "}gelir <b style={{ ...css.mono, fontWeight: 600, color: T.pos, whiteSpace: "nowrap" }}>{fmtMoney(o.gelir, "TRY")}</b>
          </div>
        </div>
        <button type="button" onClick={onCevir} style={baglanti} aria-expanded={false}>Kırılım ⌄</button>
      </div>
    );
  }

  return (
    <div style={{ ...css.card, padding: 16, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 16, flex: 1 }}>Harcama özeti</div>
        <div style={{ fontSize: 13, color: T.mut }}>{donemEtiket.toLocaleLowerCase("tr")} · {o.adet} kayıt</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        <Rakam etiket="Gider" deger={o.gider} renk={T.neg} />
        <Rakam etiket="Gelir" deger={o.gelir} renk={T.pos} />
        <Rakam etiket="Net" deger={o.net} renk={o.net >= 0 ? T.pos : T.neg} isaretli />
      </div>

      {/* Temel ve kırılım: görünümü değiştirir → çukur segment */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Segment kucuk ad="Temel" deger={temel} sec={setTemel}
          secenek={(Object.keys(TEMEL_ETIKET) as HarcamaTemeli[]).map((k) => ({ v: k, l: TEMEL_ETIKET[k] }))} />
        <div style={{ flex: "1 1 200px", display: "flex" }}>
          <div style={{ flex: 1, display: "flex" }}>
            <Segment kucuk ad="Kırılım" deger={grup} sec={setGrup}
              secenek={(Object.keys(GRUP_ETIKET) as Exclude<HarcamaGrup, "yok">[]).map((k) => ({ v: k, l: GRUP_ETIKET[k] }))} />
          </div>
        </div>
      </div>

      {/* `uyari` rakamın ANLAMINI değiştirir (hangi temel, ne elendi, ne eksik) — katlanmaz,
          asistanın cevabında da aynen aktarılıyor (Faz 35 kuralı). */}
      <div style={{ fontSize: 12.5, color: T.mut, lineHeight: 1.5 }}>
        {o.uyari.map((u, i) => <div key={i}>{u}</div>)}
        {turSuzgeciAcik && <div>Tür süzgeci özete uygulanmaz: özet hesap işlemlerini ve kart harcamalarını kapsar (virman ve portföy kapsam dışı).</div>}
        {ekstreIdYok && <div>Ekstre ödemelerinin kaydı bu yanıtta yok (eski sürüm) — ödemeler toplamdan elenemedi.</div>}
      </div>

      <div>
        {kalemler.length === 0
          ? <div style={{ fontSize: 13.5, color: T.mut, padding: "6px 0" }}>Bu süzgeçle harcama yok.</div>
          : s.gorunen.map((k) => (
            <div key={k.ad} style={{ padding: "7px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 14 }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fmtKalemAdi(k.ad, grup)}</span>
                {/* Gelir de yazılır, yoksa gideri olmayan bir kova (maaş kategorisi) "₺0,00" görünürdü */}
                <span style={{ ...css.mono, flexShrink: 0, display: "flex", gap: 8 }}>
                  {k.gider > 0 && <span>{fmtMoney(k.gider, "TRY", true)}</span>}
                  {k.gelir > 0 && <span style={{ color: T.pos }}>+{fmtMoney(k.gelir, "TRY", true)}</span>}
                </span>
              </div>
              {/* Çubuk yalnız ORAN (en büyük GİDERE göre); gideri olmayan kalemde hiç çizilmez */}
              {k.gider > 0 && (
                <div style={{ height: 4, background: T.line2, borderRadius: 2, marginTop: 5 }}>
                  <div style={{ height: "100%", borderRadius: 2, background: T.acc, width: `${enBuyuk > 0 ? Math.max(2, (k.gider / enBuyuk) * 100) : 0}%` }} />
                </div>
              )}
            </div>
          ))}
        {/* "ay" zamansal (yeniden eskiye) → "daha eski"; kategori/kart tutara göre → "daha fazla" */}
        <DahaFazla s={s} ad="kalem" yon={grup === "ay" ? "eski" : "fazla"} />
      </div>

      {/* Uyarı bir EYLEM istiyorsa eylemi de sunmalı (Faz 41): kategorisiz tutar + düzeltme yan yana. */}
      {kategorisiz.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 11, background: "var(--warn-soft)" }}>
          <span style={{ flex: 1, fontSize: 13.5, lineHeight: 1.4 }}>
            <b style={{ ...css.mono, fontWeight: 600 }}>{fmtMoney(kategorisizToplam, "TRY")}</b> kategorisiz — {kategorisiz.length} farklı ad
          </span>
          <button type="button" onClick={() => setKategorile(true)} style={baglanti}>Kategorile ›</button>
        </div>
      )}
      <button type="button" onClick={onCevir} aria-expanded style={{ ...baglanti, color: T.mut, fontWeight: 500, justifySelf: "start" }}>Özeti daralt ⌃</button>
      {kategorile && (
        <KategorileModal data={data} reload={reload} onClose={() => setKategorile(false)}
          baslangic={baslangic} sorgu={sorgu} ekstreTxIds={ekstreTxIds} />
      )}
    </div>
  );
}

function Rakam({ etiket, deger, renk, isaretli }: { etiket: string; deger: number; renk: string; isaretli?: boolean }) {
  return (
    <div style={{ background: T.panel2, borderRadius: 10, padding: "8px 10px", minWidth: 0 }}>
      <div style={{ fontSize: 12, color: T.mut }}>{etiket}</div>
      <div style={{ ...css.mono, fontSize: 15, fontWeight: 600, color: renk, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {isaretli && deger > 0 ? "+" : ""}{fmtMoney(deger, "TRY")}
      </div>
    </div>
  );
}
