import React, { useMemo, useState } from "react";
import { harcamaOzeti, type AllData, type HarcamaGrup, type HarcamaTemeli } from "@finans/engine";
import { T, css, fmtMoney } from "../../theme";
import { FiltreSeridi, useSayfalama, DahaFazla } from "../../ui";
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
  { data, reload, baslangic, sorgu, turSuzgeciAcik }:
  { data: AllData; reload: () => void; baslangic: string; sorgu: string; turSuzgeciAcik: boolean },
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
    { transactions: data.transactions, card_txs: data.card_txs, categories: data.categories, cards: data.cards, ekstreTxIds },
    { baslangic: baslangic || "0000-01-01", bitis: bugun(), temel, grup, metin: sorgu },
  ), [data.transactions, data.card_txs, data.categories, data.cards, ekstreTxIds, baslangic, sorgu, temel, grup]);

  /* Kırılım listesi kategori/kart sayısıyla sınırlı (monoton büyümez) ama "aya göre" + "Tümü"
     dönemi uzun bir liste üretebilir; dilim o yüzden var. Süzgeç değişince başa sarar. */
  /* Düğmenin sayısı modalın listesiyle aynı fonksiyondan gelir (bkz. kategorisizGruplar). */
  const kategorisiz = useMemo(
    () => kategorisizGruplar(data, { baslangic, sorgu, ekstreTxIds }),
    [data, baslangic, sorgu, ekstreTxIds],
  );

  const s = useSayfalama(o.kalemler, 8, `${temel}|${grup}|${baslangic}|${sorgu}`);
  const enBuyuk = o.kalemler.reduce((m, k) => Math.max(m, k.gider), 0);

  return (
    <div style={css.card}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Harcama Özeti</div>
        <div style={{ fontSize: 12, color: T.mut }}>{o.adet} kayıt</div>
      </div>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", margin: "10px 0 2px" }}>
        <Rakam etiket="Gider" deger={o.gider} renk={T.neg} />
        <Rakam etiket="Gelir" deger={o.gelir} renk={T.pos} />
        <Rakam etiket="Net" deger={o.net} renk={o.net >= 0 ? T.pos : T.neg} isaretli />
      </div>

      <FiltreSeridi>
        <select style={{ ...css.input, width: "auto", padding: "6px 8px", fontSize: 12.5 }}
          value={temel} onChange={(e) => setTemel(e.target.value as HarcamaTemeli)}>
          {(Object.keys(TEMEL_ETIKET) as HarcamaTemeli[]).map((k) => (
            <option key={k} value={k}>{TEMEL_ETIKET[k]} temeli</option>
          ))}
        </select>
        <select style={{ ...css.input, width: "auto", padding: "6px 8px", fontSize: 12.5 }}
          value={grup} onChange={(e) => setGrup(e.target.value as Exclude<HarcamaGrup, "yok">)}>
          {(Object.keys(GRUP_ETIKET) as Exclude<HarcamaGrup, "yok">[]).map((k) => (
            <option key={k} value={k}>{GRUP_ETIKET[k]}</option>
          ))}
        </select>
      </FiltreSeridi>

      {o.kalemler.length === 0
        ? <div style={{ fontSize: 13, color: T.mut, padding: "10px 0" }}>Bu süzgeçle harcama yok.</div>
        : s.gorunen.map((k) => (
          <div key={k.ad} style={{ padding: "7px 0", borderBottom: `1px solid ${T.line}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fmtKalemAdi(k.ad, grup)}</span>
              {/* Gelir de yazılır, yoksa gideri olmayan bir kova (maaş kategorisi, gelirli bir ay)
                  "₺0,00" diye görünürdü — rakam doğru ama satır yanlış bir şey söylüyordu. */}
              <span style={{ ...css.mono, flexShrink: 0, display: "flex", gap: 8 }}>
                {k.gider > 0 && <span>{fmtMoney(k.gider, "TRY", true)}</span>}
                {k.gelir > 0 && <span style={{ color: T.pos }}>+{fmtMoney(k.gelir, "TRY", true)}</span>}
              </span>
            </div>
            {/* Çubuk yalnız ORAN gösterir (en büyük GİDERE göre); rakam zaten yanında yazıyor.
                Gideri olmayan kalemde (gelir kovası) çubuk HİÇ çizilmez — "en az %2" tabanı orada
                sıfırı küçük bir gider gibi gösteriyordu. */}
            <div style={{ height: 4, background: T.line, borderRadius: 3, marginTop: 5 }}>
              {k.gider > 0 && (
                <div style={{
                  height: "100%", borderRadius: 3, background: T.acc,
                  width: `${enBuyuk > 0 ? Math.max(2, (k.gider / enBuyuk) * 100) : 0}%`,
                }} />
              )}
            </div>
          </div>
        ))}
      <DahaFazla s={s} ad="kalem" />

      {/* `uyari` rakamın ANLAMINI değiştirir (hangi temel, ne elendi, ne eksik) — katlanmaz,
          asistanın cevabında da aynen aktarılıyor (Faz 35 kuralı). */}
      <div style={{ fontSize: 11.5, color: T.mut, marginTop: 10, lineHeight: 1.55 }}>
        {o.uyari.map((u, i) => <div key={i}>{u}</div>)}
        {turSuzgeciAcik && <div>Tür süzgeci özete uygulanmaz: özet hesap işlemlerini ve kart harcamalarını kapsar (virman ve portföy kapsam dışı).</div>}
        {ekstreIdYok && <div>Ekstre ödemelerinin kaydı bu yanıtta yok (eski sürüm) — ödemeler toplamdan elenemedi.</div>}
      </div>

      {/* Uyarı bir EYLEM istiyorsa eylemi de sunmalı: "kategorisiz kovada N TL var" deyip
          düzeltmeyi kayıtları tek tek açmaya bırakmak, pratikte hiç yapılmayacak bir iş
          bırakmaktı (Faz 41). Düğme yalnız kategorisiz kayıt varken çıkar. */}
      {kategorisiz.length > 0 && (
        <button style={{ ...css.btn, marginTop: 10 }} onClick={() => setKategorile(true)}>
          Kategorile ({kategorisiz.length} ad)
        </button>
      )}
      {kategorile && (
        <KategorileModal data={data} reload={reload} onClose={() => setKategorile(false)}
          baslangic={baslangic} sorgu={sorgu} ekstreTxIds={ekstreTxIds} />
      )}
    </div>
  );
}

function Rakam({ etiket, deger, renk, isaretli }: { etiket: string; deger: number; renk: string; isaretli?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: T.mut3, letterSpacing: "0.06em", textTransform: "uppercase" }}>{etiket}</div>
      <div style={{ ...css.mono, fontSize: 19, fontWeight: 700, color: renk }}>
        {isaretli && deger > 0 ? "+" : ""}{fmtMoney(deger, "TRY", true)}
      </div>
    </div>
  );
}
