import React, { useMemo, useState } from "react";
import { metinEsler, type AllData, type Category } from "@finans/engine";
import { api } from "../../api";
import { T, css, fmtMoney } from "../../theme";
import { Modal, useSayfalama, DahaFazla } from "../../ui";
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

export type Grup = { anahtar: string; ad: string; yon: "gider" | "gelir"; toplam: number; kayitlar: Kayit[]; oneri: number | null };

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
     kayıtları ortak havuz — "Migros"u hesaptan kategorilediysen kart harcaması da onu önerir. */
  const oneriler = new Map<string, { date: string; cat: number }>();
  const gor = (name: string, date: string, cat: number | null | undefined) => {
    if (cat == null) return;
    const k = normName(name);
    const v = oneriler.get(k);
    if (!v || date > v.date) oneriler.set(k, { date, cat });
  };
  data.card_txs.forEach((c) => gor(c.name, c.date, c.category_id));
  data.transactions.forEach((t) => gor(t.name, t.date, t.category_id));

  const m = new Map<string, Grup>();
  for (const k of ham) {
    const yon: "gider" | "gelir" = k.tur === "kart" || k.amount < 0 ? "gider" : "gelir";
    const anahtar = `${yon}|${normName(k.name)}`;
    const g = m.get(anahtar) ?? {
      anahtar, ad: k.name, yon, toplam: 0, kayitlar: [],
      oneri: oneriler.get(normName(k.name))?.cat ?? null,
    };
    g.toplam += Math.abs(k.amount);
    g.kayitlar.push(k);
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
  const [secim, setSecim] = useState<Record<string, string>>({});
  const [kaydedilen, setKaydedilen] = useState<Record<string, "calisiyor" | "bitti">>({});
  const [hata, setHata] = useState<string | null>(null);

  const gruplar = useMemo(
    () => kategorisizGruplar(data, { baslangic, sorgu, ekstreTxIds }),
    [data, baslangic, sorgu, ekstreTxIds],
  );

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
      reload();
    } catch (e) {
      setKaydedilen((x) => { const y = { ...x }; delete y[g.anahtar]; return y; });
      setHata(`"${g.ad}" kaydedilemedi: ${e instanceof Error ? e.message : "bilinmeyen hata"}`);
    }
  };

  return (
    <Modal title="Kategorisiz kayıtlar" onClose={onClose}>
      <div style={{ fontSize: 12.5, color: T.mut, marginBottom: 10, lineHeight: 1.5 }}>
        Aynı adlı kayıtlar tek satırda toplandı — seçtiğin kategori o adın <b>tüm</b> kayıtlarına
        yazılır ve satır listeden düşer. Yanlış seçersen kaydı aşağıdaki listeden düzenleyebilirsin.
        Ekstre ödemeleri burada yok (onlar harcama değil, kart borcunun kapanışı).
      </div>

      {gruplar.length === 0
        ? <div style={{ fontSize: 13, color: T.mut }}>Bu dönemde kategorisiz kayıt yok.</div>
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
                  {g.kayitlar.length} kayıt · {g.yon === "gelir" ? "gelir" : "gider"}
                  {g.oneri != null && durum == null && !secim[g.anahtar] ? " · önerildi" : ""}
                </div>
              </div>
              <span style={{ ...css.mono, fontSize: 13, flexShrink: 0 }}>{fmtMoney(g.toplam, "TRY", true)}</span>
              {durum === "bitti"
                ? <span style={{ fontSize: 12, color: T.pos, flexShrink: 0, minWidth: 96, textAlign: "right" }}>✓ yazıldı</span>
                : (
                  <select
                    style={{ ...css.input, width: "auto", flex: "0 1 150px", padding: "6px 8px", fontSize: 12.5 }}
                    disabled={durum === "calisiyor"}
                    value={secim[g.anahtar] ?? (g.oneri != null ? String(g.oneri) : "")}
                    onChange={(e) => uygula(g, e.target.value)}
                  >
                    <option value="">Kategori seç…</option>
                    {data.categories
                      .filter((c: Category) => c.kind === (g.yon === "gelir" ? "income" : "expense"))
                      .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
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
