import type { AllData } from "./types.js";
import { metinEsler } from "./kayitlar.js";

/* ————— HARCAMA / GELİR ÖZETİ (Faz 35) —————
   "Bu ay ne kadar harcadım?" sorusunun cevap yeri. Faz 26'da Kayıtlar ekranı bilerek TOPLAM
   ÜRETMEDEN yazıldı (bkz. kayitlar.ts): türler arası toplam yanıltıcıdır, çünkü kart harcaması
   ile onun ekstre ödemesi AYNI parayı iki kez sayar ve virman hiç para hareketi değildir.

   O karar ekran için doğruydu ama soruyu ortadan kaldırmadı — yalnız cevabı olmayan bir soru
   bıraktı. Asistan da cevaplayamıyordu: elindeki tek okuma aracı (`kayit_ara`) tek seferde en
   çok 50 satır ve TEK tür döndürüyor, yani model iki kaynağı birleştiremiyor ve 50'yi aşan bir
   ayda topladığı rakam SESSİZCE eksik çıkıyordu (card_txs uygulamanın en hızlı büyüyen tablosu).
   Yanlış rakam vermek, rakam vermemekten kötüdür.

   Bu modül toplamı üretir ama yanıltıcı olmasını ENGELLEYEREK: iki "temel" arasında seçim
   yapmaya zorlar ve hangisini kullandığını çıktıya yazar. İkisini toplamak mümkün değildir.

     • "tuketim" → PARA NEREYE GİTTİ. Kart harcamaları harcandığı gün, tam tutarıyla (12 taksitli
       bir alışveriş Mart'ta harcanmıştır, Mart'a yazılır) + hesaptan geçen gelir/giderler.
       Ekstre ödemeleri HARİÇ: o para zaten kart harcaması olarak sayıldı, ikinci kez sayılırsa
       kart kullanan biri harcamasını iki katı görür.
     • "nakit" → HESAPTAN NE ÇIKTI. Yalnız `transactions`; ekstre ödemesi DAHİL (nakit o gün
       çıkar), kart harcaması HARİÇ (o gün hiçbir hesabı oynatmaz).

   Kapsam dışı iki tür bilinçlidir: `transfers` (virman) kendi hesapların arası, para sistemden
   çıkmaz; `trades` (portföy) harcama değil varlık dönüşümüdür (para kaybolmaz, biçim değiştirir).

   KART HARCAMASININ KATEGORİSİ (Faz 39). Bu satırlar eskiden kategorisizdi — `card_txs`'te
   kolon yoktu — ve kategori kırılımı yalnız hesap/nakit işlemlerini anlatıyordu. Harcamanın çoğu
   kartta olduğu için ekran YAPISAL olarak yarım cevap veriyordu: Faz 4'ün Rapor sekmesinin
   "neredeyse boş" görünmesinin ve Faz 26'da kaldırılmasının sebebi tam olarak budur.
   Artık kolon var ve kategorisi girilmiş kart harcaması hesap işlemleriyle **AYNI kovaya** girer:
   sorulan şey "para hangi işe gitti"dir, hangi ödeme aracıyla ödendiği değil — market alışverişi
   kartla da yapılsa markettir.
   Kalan kısıt yapısal değil, VERİ GİRİŞİ kısıtıdır: kategorisi girilmemiş kart harcaması
   "Kart harcaması (kategorisiz)" kovasında durur, uyarı YALNIZ o kova doluysa çıkar ve kategori
   girilince kendiliğinden susar. Hesap işlemlerinin "(kategorisiz)" kovasıyla birleştirilmez,
   çünkü ikisinin düzeltme yolu farklıdır (biri işlem, diğeri kart harcaması düzenlenerek) ve ayrı
   durunca eksiğin hangi kaynakta olduğu görünür. */

export type HarcamaTemeli = "tuketim" | "nakit";
export type HarcamaGrup = "yok" | "ay" | "kategori" | "kart";

/** Özetin ihtiyaç duyduğu veri. `AllData`'nın tamamı gerekmez; `Pick` ile daraltmak hem çağıranın
    ne yüklemesi gerektiğini söyler hem de "bu fonksiyon başka neye bakıyor olabilir"i kapatır. */
export type HarcamaVeri = Pick<AllData, "transactions" | "card_txs" | "categories" | "cards"> & {
  /** Ekstre ödemesi olarak yazılmış `transactions` id'leri (`statement_payments.tx_id`).
      DIŞARIDAN gelir çünkü `AllData.statement_payments` yalnız (card_id, due) taşır — engine
      bir ekstre ödemesini adından ayırt edemez ("Akbank ekstresi" elle de yazılabilir). */
  ekstreTxIds?: number[];
};

export type HarcamaSecenek = {
  /** YYYY-MM-DD, ikisi de DAHİL */
  baslangic: string;
  bitis: string;
  temel?: HarcamaTemeli;
  grup?: HarcamaGrup;
  /** ad/kategori/kart metninde ara — Türkçe'ye toleranslı (bkz. metinEsler) */
  metin?: string;
};

export type HarcamaKalem = { ad: string; gider: number; gelir: number; adet: number };

export type HarcamaOzeti = {
  temel: HarcamaTemeli;
  baslangic: string;
  bitis: string;
  gider: number;
  gelir: number;
  /** gelir − gider */
  net: number;
  /** özete giren kayıt sayısı */
  adet: number;
  /** `grup: "yok"` ise boş; "ay" kronolojik, diğerleri gidere göre azalan */
  kalemler: HarcamaKalem[];
  /** rakamın neyi içerdiği — modelin cümlesini bu belirler, tahmine bırakılmaz */
  kapsam: {
    kart_harcamasi: boolean;
    ekstre_odemesi: boolean;
    /** "tuketim" temelinde çifte saymayı önlemek için dışarıda bırakılan ekstre ödemesi toplamı */
    haric_ekstre_odemesi: number;
    /** kategorisi GİRİLMEMİŞ kart harcaması toplamı (girilmişse kendi kategorisine yazılır) */
    kategorisiz_kart_gideri: number;
  };
  /** kullanıcıya AYNEN aktarılması gereken kısıtlar */
  uyari: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
/* Uyarı metinleri İNSANA gösterilir (panelde aynen basılır, asistan aynen aktarır) — ham
   "12480 TL" ekranda biçimlenmemiş görünüyordu. Sayısal alanlar (`kapsam`) ham kalır: onlar
   makine tarafıdır. */
const tutarTr = (n: number) =>
  `${r2(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
const KATEGORISIZ = "(kategorisiz)";
const KART_KOVA = "Kart harcaması (kategorisiz)";
const KART_DISI = "Kart dışı (hesap/nakit)";

/** Tarih aralığı + metin süzgeciyle gelir/gider özeti. Saf: `veri` değişmez. */
export function harcamaOzeti(veri: HarcamaVeri, s: HarcamaSecenek): HarcamaOzeti {
  const temel: HarcamaTemeli = s.temel ?? "tuketim";
  const grup: HarcamaGrup = s.grup ?? "yok";
  const metin = s.metin ?? "";
  const { baslangic, bitis } = s;
  const araliktaMi = (d: string) => d >= baslangic && d <= bitis;

  const katAdi = new Map(veri.categories.map((c) => [c.id, c.name]));
  const kartAdi = new Map(veri.cards.map((c) => [c.id, c.name]));
  const ekstre = new Set(veri.ekstreTxIds ?? []);

  let gider = 0, gelir = 0, adet = 0;
  let haricEkstre = 0, kategorisizKart = 0;
  const kovalar = new Map<string, HarcamaKalem>();
  const koy = (ad: string, g: { gider?: number; gelir?: number }) => {
    if (grup === "yok") return;
    const k = kovalar.get(ad) ?? { ad, gider: 0, gelir: 0, adet: 0 };
    k.gider += g.gider ?? 0;
    k.gelir += g.gelir ?? 0;
    k.adet += 1;
    kovalar.set(ad, k);
  };

  for (const t of veri.transactions) {
    if (!araliktaMi(t.date)) continue;
    const kategori = t.category_id != null ? katAdi.get(t.category_id) ?? KATEGORISIZ : KATEGORISIZ;
    /* Ekstre ödemesi "tuketim" temelinde ELENİR — ama sessizce değil: toplamı çıktıya yazılır,
       çünkü "kart borcuna 12.000 ödedim" kullanıcının gerçekten yaptığı bir ödemedir ve
       listede görünmemesinin sebebini bilmesi gerekir. */
    if (temel === "tuketim" && ekstre.has(t.id)) {
      haricEkstre += Math.abs(t.amount);
      continue;
    }
    if (metin && !metinEsler(`${t.name} ${kategori}`, metin)) continue;
    adet++;
    if (t.amount < 0) {
      gider += -t.amount;
      koy(grup === "ay" ? t.date.slice(0, 7) : grup === "kategori" ? kategori : KART_DISI, { gider: -t.amount });
    } else {
      gelir += t.amount;
      koy(grup === "ay" ? t.date.slice(0, 7) : grup === "kategori" ? kategori : KART_DISI, { gelir: t.amount });
    }
  }

  if (temel === "tuketim") {
    for (const c of veri.card_txs) {
      if (!araliktaMi(c.date)) continue;
      const kart = kartAdi.get(c.card_id) ?? "kart";
      /* Bilinmeyen id (silinmiş ya da başka kiracının kategorisi) kategorisiz sayılır —
         `katAdi` yalnız BU kullanıcının kategorilerini taşır, uydurulacak bir ad yok. */
      const kategori = c.category_id != null ? katAdi.get(c.category_id) ?? null : null;
      if (metin && !metinEsler(`${c.name} ${kart}${kategori ? ` ${kategori}` : ""}`, metin)) continue;
      const tutar = Math.abs(c.amount);
      adet++;
      gider += tutar;
      if (kategori == null) kategorisizKart += tutar;
      koy(grup === "ay" ? c.date.slice(0, 7) : grup === "kategori" ? kategori ?? KART_KOVA : kart, { gider: tutar });
    }
  }

  const uyari: string[] = [];
  if (temel === "tuketim") {
    uyari.push(
      "Temel: tüketim — kart harcamaları harcandığı gün tam tutarıyla sayıldı, ekstre ödemeleri " +
      "sayılmadı (aynı para iki kez sayılmasın).",
    );
    if (haricEkstre > 0) {
      uyari.push(`Bu aralıkta ${tutarTr(haricEkstre)} ekstre ödemesi vardı ve toplamın DIŞINDA.`);
    }
    if (grup === "kategori" && kategorisizKart > 0) {
      uyari.push(
        `${tutarTr(kategorisizKart)} kart harcamasının kategorisi girilmemiş — "${KART_KOVA}" ` +
        "kovasında duruyor. Harcamayı düzenleyip kategori seçilirse kendi kategorisine geçer.",
      );
    }
  } else {
    uyari.push(
      "Temel: nakit — yalnız hesaptan geçen işlemler sayıldı (ekstre ödemeleri dahil, " +
      "kart harcamaları hariç: kart parası ekstre ödendiği gün çıkar).",
    );
  }
  if (bitis < baslangic) uyari.push("Bitiş tarihi başlangıçtan önce — aralık boş.");

  /* "ay" kronolojik (zaman serisi geriye doğru okunmaz), diğerleri gidere göre azalan
     (soru "en çok nereye gitti"dir; alfabetik sıra o soruyu cevaplamaz). */
  const kalemler = [...kovalar.values()]
    .map((k) => ({ ad: k.ad, gider: r2(k.gider), gelir: r2(k.gelir), adet: k.adet }))
    .sort((a, b) => (grup === "ay" ? a.ad.localeCompare(b.ad) : b.gider - a.gider || b.gelir - a.gelir));

  return {
    temel, baslangic, bitis,
    gider: r2(gider), gelir: r2(gelir), net: r2(gelir - gider), adet,
    kalemler,
    kapsam: {
      kart_harcamasi: temel === "tuketim",
      ekstre_odemesi: temel === "nakit",
      haric_ekstre_odemesi: r2(haricEkstre),
      kategorisiz_kart_gideri: r2(kategorisizKart),
    },
    uyari,
  };
}
