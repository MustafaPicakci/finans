import React, { useMemo, useState } from "react";
import { metinEsler, type AllData, type Category } from "@finans/engine";
import { api } from "../../api";
import { T, css, fmtMoney } from "../../theme";
import { Modal, FiltreSeridi, Aciklama, useSayfalama, DahaFazla } from "../../ui";
import { normName } from "../forms/recall";

/* ————— TOPLU KATEGORİLEME (Faz 41) —————
   Faz 39 kart harcamasına kategori kolonu ekledi, Faz 40 kırılımı ekrana getirdi — ama geçmiş
   kayıtların hepsi kategorisiz kaldı (kolon yokken girilememişti ve geriye dönük tahmin bilerek
   YAPILMADI, addan kategori türetmek sessiz bir hata kaynağıdır). Yani iki faz gerçek veride
   "N TL kategorisiz kovada" uyarısından ibaret kalıyordu ve tek düzeltme yolu kayıtları TEK TEK
   açmaktı — dokuz aylık kart harcaması için bu pratikte hiç yapılmayacak bir iş.

   ASIL FİKİR: birim kayıt değil **AD**. Aynı yere yapılan 14 "Migros" harcaması tek bir karardır;
   14 kez sorulursa iş bitmez. Satırlar `normName` ile gruplanır (recall.ts'in aynı anahtarı —
   Türkçe küçültme + boşluk sadeleştirme, iki kopya olmasın) ve seçim grubun TAMAMINA uygulanır.

   ÖNERİ, KAYIT DEĞİL: aynı adla daha önce kategorilenmiş bir kayıt varsa seçici onunla önden
   dolu gelir (recall'un form davranışının aynısı) ama **hiçbir şey kendiliğinden yazılmaz** —
   kullanıcı onaylamadan tek bir satır bile değişmez. Faz 36'nın "öneri kayıt yazmaz" kuralı.

   YÖN AYRI GRUPLANIR (`normName + yön`): aynı ad hem gelir hem gider olabilir ("Kira" ödenir ve
   tahsil edilir) ve kategori listesi türe göre süzülüyor — tek grupta toplasaydık gider
   kategorisi bir gelir kaydına yazılabilirdi.

   EKSTRE ÖDEMELERİ LİSTEYE GİRMEZ: onlar kart borcunun kapanışıdır, harcama değil (tüketim
   temelinde zaten eleniyorlar — bkz. harcama.ts). Kategori vermek onları "nakit" temelinde bir
   harcama kategorisine sokar ve aynı parayı ikinci kez anlamlandırırdı. */

type Kayit =
  | { tur: "kart"; id: number; date: string; name: string; amount: number; ek: string }
  | { tur: "islem"; id: number; date: string; name: string; amount: number; ek: string; account_id: number | null };

export type GrupKaynak = "kart" | "hesap" | "karisik";
export type Grup = {
  anahtar: string; ad: string; yon: "gider" | "gelir"; toplam: number; kayitlar: Kayit[];
  oneri: number | null;
  /** hangi kart/hesap (tek kaynaktan geliyorsa adı, karışıksa "kart + hesap") — satırda YAZILIR:
      kaynağı göstermeyen satır kafa karıştırıyordu ("Maaş" neden burada?). */
  kaynak: GrupKaynak; kaynakAdi: string;
};

export type Kapsam = { baslangic: string; sorgu: string; ekstreTxIds: number[] };

/** Kategorisiz kayıtları ada göre gruplar. **Panelin sayacı ve modalın listesi bunu paylaşır** —
    iki kopya olsaydı düğme "3 ad" deyip modal 5 satır açabilirdi. */
export function kategorisizGruplar(data: AllData, { baslangic, sorgu, ekstreTxIds }: Kapsam): Grup[] {
  const kartAdi = new Map(data.cards.map((c) => [c.id, c.name]));
  const hesapAdi = new Map(data.accounts.map((a) => [a.id, a.name]));
  const ekstre = new Set(ekstreTxIds);
  const bitis = new Date().toISOString().slice(0, 10);
  const arada = (d: string) => d >= (baslangic || "0000-01-01") && d <= bitis;

  const ham: Kayit[] = [];
  for (const c of data.card_txs) {
    if (c.category_id != null || !arada(c.date)) continue;
    const kart = kartAdi.get(c.card_id) ?? "kart";
    if (sorgu && !metinEsler(`${c.name} ${kart}`, sorgu)) continue;
    ham.push({ tur: "kart", id: c.id, date: c.date, name: c.name, amount: Math.abs(c.amount), ek: kart });
  }
  for (const t of data.transactions) {
    if (t.category_id != null || !arada(t.date) || ekstre.has(t.id)) continue;
    if (sorgu && !metinEsler(t.name, sorgu)) continue;
    ham.push({
      tur: "islem", id: t.id, date: t.date, name: t.name, amount: t.amount,
      ek: t.account_id != null ? hesapAdi.get(t.account_id) ?? "hesap" : "hesapsız", account_id: t.account_id,
    });
  }

  /* Öneri havuzu: aynı adla daha önce KATEGORİLENMİŞ kayıtların en yenisi. Kart ve hesap
     kayıtları ortak havuz — "Migros"u hesaptan kategorilediysen kart harcaması da onu önerir.
     Anahtar GRUPLARLA AYNI olmalı (`yön|ad`): yalnız ada göre anahtarlanınca bir gelir grubuna
     gider kategorisi önerilebiliyordu; satır "· önerildi" yazarken seçici BOŞ kalıyordu, çünkü
     o kategori gelir listesinde yok. */
  const oneriler = new Map<string, { date: string; cat: number }>();
  const gor = (name: string, date: string, amount: number, kart: boolean, cat: number | null | undefined) => {
    if (cat == null) return;
    const k = `${kart || amount < 0 ? "gider" : "gelir"}|${normName(name)}`;
    const v = oneriler.get(k);
    if (!v || date > v.date) oneriler.set(k, { date, cat });
  };
  data.card_txs.forEach((c) => gor(c.name, c.date, -Math.abs(c.amount), true, c.category_id));
  data.transactions.forEach((t) => gor(t.name, t.date, t.amount, false, t.category_id));

  const m = new Map<string, Grup>();
  for (const k of ham) {
    const yon: "gider" | "gelir" = k.tur === "kart" || k.amount < 0 ? "gider" : "gelir";
    const anahtar = `${yon}|${normName(k.name)}`;
    /* İkinci öneri kaynağı: AYNI ADLI KATEGORİ. Geçmişte kategorilenmiş bir kayıt yoksa öneri de
       çıkmıyordu — oysa "Maaş" adlı kayıt için "Maaş" adlı bir kategori duruyorsa eşleşme
       apaçık. Ad karşılaştırması `normName` ile, yani "AIDAT" ile "Aidat" da eşleşir. */
    const adEsi = data.categories.find(
      (c) => c.kind === (yon === "gelir" ? "income" : "expense") && normName(c.name) === normName(k.name),
    );
    const g = m.get(anahtar) ?? {
      anahtar, ad: k.name, yon, toplam: 0, kayitlar: [],
      oneri: oneriler.get(anahtar)?.cat ?? adEsi?.id ?? null,
      kaynak: k.tur === "kart" ? "kart" as GrupKaynak : "hesap" as GrupKaynak, kaynakAdi: k.ek,
    };
    g.toplam += Math.abs(k.amount);
    g.kayitlar.push(k);
    const bu: GrupKaynak = k.tur === "kart" ? "kart" : "hesap";
    if (g.kaynak !== bu) { g.kaynak = "karisik"; g.kaynakAdi = "kart + hesap"; }
    else if (g.kaynakAdi !== k.ek) g.kaynakAdi = `${g.kaynak === "kart" ? "kart" : "hesap"} (${new Set(g.kayitlar.map((x) => x.ek)).size})`;
    m.set(anahtar, g);
  }
  /* Büyükten küçüğe: kategorisiz kalan paranın en büyük parçası en tepede — birkaç satır
     doldurup çıkan kullanıcı bile uyarıdaki rakamın çoğunu kapatır. */
  return [...m.values()].sort((a, b) => b.toplam - a.toplam);
}

export function KategorileModal(
  { data, reload, onClose, baslangic, sorgu, ekstreTxIds }:
  { data: AllData; reload: () => void; onClose: () => void } & Kapsam,
) {
  /* Kaynak süzgeci: modal, kategorisiz HESAP işlemlerini de topluyor (onlar da kırılımda
     "(kategorisiz)" kovasına düşüyor, yani listede olmaları doğru) — ama panelin uyarısı kart
     harcamasından söz ettiği için "Maaş" satırını görmek şaşırtıyordu. Çözüm satırı gizlemek
     değil KAYNAĞINI YAZMAK + tek dokunuşla daraltabilmek. */
  const [kaynak, setKaynak] = useState<"hepsi" | "kart" | "hesap">("hepsi");
  const [secim, setSecim] = useState<Record<string, string>>({});
  const [kaydedilen, setKaydedilen] = useState<Record<string, "calisiyor" | "bitti">>({});
  const [hata, setHata] = useState<string | null>(null);

  const tumGruplar = useMemo(
    () => kategorisizGruplar(data, { baslangic, sorgu, ekstreTxIds }),
    [data, baslangic, sorgu, ekstreTxIds],
  );
  const gruplar = useMemo(
    () => (kaynak === "hepsi" ? tumGruplar : tumGruplar.filter((g) => g.kaynak === kaynak || g.kaynak === "karisik")),
    [tumGruplar, kaynak],
  );
  const sayi = (k: "hepsi" | "kart" | "hesap") =>
    k === "hepsi" ? tumGruplar.length : tumGruplar.filter((g) => g.kaynak === k || g.kaynak === "karisik").length;

  const s = useSayfalama(gruplar, 12, `${baslangic}|${sorgu}`);
  const kalan = gruplar.filter((g) => kaydedilen[g.anahtar] !== "bitti").length;

  const uygula = async (g: Grup, catId: string) => {
    if (!catId) return;
    setSecim((x) => ({ ...x, [g.anahtar]: catId }));
    setKaydedilen((x) => ({ ...x, [g.anahtar]: "calisiyor" }));
    setHata(null);
    try {
      for (const k of g.kayitlar) {
        if (k.tur === "kart") {
          await api.put(`cardtxs/${k.id}`, { category_id: +catId });
        } else {
          /* transactions PUT kısmi gövde kabul etmez (tarih/ad/tutar zorunlu) ve bakiye etkisini
             geri alıp yeniden uygular — aynı değerlerle çağrıldığı için bakiye değişmez. */
          await api.put(`transactions/${k.id}`, {
            date: k.date, name: k.name, amount: k.amount,
            category_id: +catId, account_id: k.account_id,
          });
        }
      }
      setKaydedilen((x) => ({ ...x, [g.anahtar]: "bitti" }));
    } catch (e) {
      setKaydedilen((x) => { const y = { ...x }; delete y[g.anahtar]; return y; });
      setHata(`"${g.ad}" kaydedilemedi: ${e instanceof Error ? e.message : "bilinmeyen hata"}`
        + " — yazılabilenler kaydedildi, liste tazelendi.");
    } finally {
      /* reload HER durumda: döngü ortasında hata alınırsa (ör. 40 kayıtlık bir grupta dakikalık
         istek sınırına takılmak) bir kısmı YAZILMIŞ olur; tazelemeden dönersek hem modal hem
         panel sayacı o grubu hâlâ tamamen kategorisiz gösterir ve kullanıcı yazılmış kayıtları
         ikinci kez yazmaya çalışır. */
      reload();
    }
  };

  return (
    <Modal title="Kategorisiz kayıtlar" onClose={onClose}>
      {/* Faz 24 kural 3: bir kez okunan uzun metin katlanır. Görünür kalan TEK cümle, eylemin
          ne yaptığını söyleyen cümledir (seçim tüm gruba yazılır) — gerisi kapsam açıklaması
          ve ⓘ arkasında duruyor; yedi satırlık paragraf listeyi ekranın yarısına itiyordu. */}
      <div style={{ fontSize: 12.5, color: T.mut, lineHeight: 1.5 }}>
        Aynı adlı kayıtlar tek satırda toplandı — seçtiğin kategori o adın <b>tüm</b> kayıtlarına
        yazılır.
      </div>
      <Aciklama k="toplu-kategori" label="listede ne var, ne yok?">
        Liste <b>seçili dönemi</b> kapsar (üstteki şerit) — daha eskileri de düzeltmek için dönemi
        "Tümü" yap. Kart harcamalarının yanında <b>kategorisiz hesap işlemleri</b> de burada
        (maaş, kira…): onlar da kırılımda "(kategorisiz)" kovasına düşüyor — yalnız kartı görmek
        için üstteki süzgeci kullan. Ekstre ödemeleri listede yok (harcama değil, kart borcunun
        kapanışı). Yanlış seçersen kaydı Kayıtlar listesinden düzenleyebilirsin.
      </Aciklama>

      <FiltreSeridi>
        {([["hepsi", "Hepsi"], ["kart", "Kart harcaması"], ["hesap", "Hesap işlemi"]] as const).map(([k, etiket]) => (
          <button key={k} type="button" onClick={() => setKaynak(k)} style={{
            padding: "6px 10px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: T.disp,
            fontWeight: kaynak === k ? 700 : 500,
            background: kaynak === k ? T.panel : "transparent",
            border: `1px solid ${kaynak === k ? T.line : "transparent"}`,
            color: kaynak === k ? T.acc : T.mut,
          }}>{etiket} ({sayi(k)})</button>
        ))}
      </FiltreSeridi>

      {gruplar.length === 0
        ? <div style={{ fontSize: 13, color: T.mut }}>Bu süzgeçle kategorisiz kayıt yok.</div>
        : s.gorunen.map((g) => {
          const durum = kaydedilen[g.anahtar];
          return (
            <div key={g.anahtar} style={{
              display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
              padding: "8px 0", borderBottom: `1px solid ${T.line}`, opacity: durum === "bitti" ? 0.45 : 1,
            }}>
              <div style={{ flex: "1 1 150px", minWidth: 0 }}>
                <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.ad}</div>
                <div style={{ fontSize: 11, color: T.mut }}>
                  {g.kaynakAdi} · {g.kayitlar.length} kayıt · {g.yon === "gelir" ? "gelir" : "gider"}
                </div>
              </div>
              <span style={{ ...css.mono, fontSize: 13, flexShrink: 0 }}>{fmtMoney(g.toplam, "TRY", true)}</span>
              {/* Kontroller tek kapta: öneri düğmesi ile seçici birlikte sarmalı, yoksa dar
                  ekranda kısa adlı satırda düğme başlığın yanına, uzun adlıda alta düşüyor ve
                  liste dişli görünüyordu. */}
              <div style={{ display: "flex", gap: 8, flex: "1 1 200px", justifyContent: "flex-end" }}>
              {durum === "bitti"
                ? <span style={{ fontSize: 12, color: T.pos, flexShrink: 0, minWidth: 96, textAlign: "right" }}>✓ yazıldı</span>
                : (<>
                  {/* Öneri ÖNDEN SEÇİLİ GÖSTERİLMEZ: dolu bir seçici kayıtlı kategoriden ayırt
                      edilemiyordu ("kategorisi dolu görünüyor ama kategorisiz listesinde" —
                      kullanıcı geri bildirimi). Öneri artık açık bir EYLEM: tek dokunuşla yazar,
                      dokunulmadıkça hiçbir şey değişmez (Faz 36'nın "öneri kayıt yazmaz" kuralı
                      ekranda da böyle görünmeli). */}
                  {g.oneri != null && !secim[g.anahtar] && (
                    <button type="button" disabled={durum === "calisiyor"}
                      onClick={() => uygula(g, String(g.oneri))}
                      title="önerilen kategoriyi bu adın tüm kayıtlarına yaz"
                      style={{
                        flexShrink: 0, padding: "6px 10px", borderRadius: 8, cursor: "pointer",
                        background: "transparent", border: `1px solid ${T.acc}`, color: T.acc,
                        fontSize: 12, fontFamily: T.disp, fontWeight: 700,
                      }}>
                      {data.categories.find((c) => c.id === g.oneri)?.name ?? "öneri"} ✓
                    </button>
                  )}
                  <select
                    style={{ ...css.input, width: "auto", flex: "0 1 150px", padding: "6px 8px", fontSize: 12.5 }}
                    disabled={durum === "calisiyor"}
                    value={secim[g.anahtar] ?? ""}
                    onChange={(e) => uygula(g, e.target.value)}
                  >
                    <option value="">Kategori seç…</option>
                    {data.categories
                      .filter((c: Category) => c.kind === (g.yon === "gelir" ? "income" : "expense"))
                      .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </>)}
              </div>
            </div>
          );
        })}
      <DahaFazla s={s} ad="ad" />

      {hata && <div style={{ fontSize: 12.5, color: T.neg, marginTop: 10 }}>{hata}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 14 }}>
        <span style={{ fontSize: 12, color: T.mut }}>{kalan > 0 ? `${kalan} ad kategorisiz` : "hepsi kategorilendi"}</span>
        <button style={css.btn} onClick={onClose}>Bitti</button>
      </div>
    </Modal>
  );
}
