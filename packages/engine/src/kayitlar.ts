import type { AllData, Currency } from "./types.js";

/* ————— BİRLEŞİK KAYIT LİSTESİ (Faz 26) —————
   "Şu ödemeyi ne zaman yapmıştım?" sorusunun tek cevap yeri. Bugüne dek bu soruyu sormak için
   üç ayrı sekme dolaşmak gerekiyordu: gelir/gider kendi listesinde, kart harcaması Kart'ta, portföy
   işlemi Portföy'de, virman Hesaplar'da. Kayıtların FARKLI YERLERDE DÜZENLENMESİ doğru bir
   kuraldır (bkz. CLAUDE.md "nerede eklendiyse orada düzenlenir"), ama farklı yerlerde
   ARANMASI değildir — bulmak ile değiştirmek aynı şey değil.

   Bu modül yalnız BİRLEŞTİRİR ve SÜZER; hiçbir şeyi değiştirmez, hiçbir toplam üretmez.
   Toplam üretmemesi bilinçli: türler arası tutar toplamak yanıltıcı olurdu (kart harcaması
   ile onun ekstre ödemesi aynı parayı iki kez sayar, virman ise hiç para hareketi değildir). */

export type KayitTuru = "gelir-gider" | "kart" | "virman" | "portfoy";

/** Paranın yönü. Tek bir işaretli "tutar" alanı YETMEZ çünkü her tür aynı anlamda değil:
    virman net sıfırdır, hesaba bağlı olmayan portföy işlemi hiçbir bakiyeyi oynatmaz. */
export type KayitYon = "giris" | "cikis" | "notr";

export type Kayit = {
  /** React anahtarı ve tekilleştirme için: tür + id (id'ler tablolar arasında çakışır) */
  key: string;
  tur: KayitTuru;
  /** kaynak tablodaki id — düzenleme için ilgili sekmeye götürürken kullanılır */
  id: number;
  date: string;               // YYYY-MM-DD
  ad: string;                 // aramada eşleşen ana metin
  /** ikincil bağlam (kategori, hesap, kart, sembol…) — aramada bu da taranır */
  detay: string;
  /** tutarın MUTLAK büyüklüğü; işaret `yon`dan okunur */
  tutar: number;
  yon: KayitYon;
  currency: Currency;
  /** satırda gösterilecek kısa tür etiketi */
  etiket: string;
};

const ISIM_YOK = "(adsız)";

/** Tüm hareket kayıtlarını tek listede birleştirir — en yeni önce. Saf: `data` değişmez. */
export function tumKayitlar(data: AllData): Kayit[] {
  const hesapAdi = new Map(data.accounts.map((a) => [a.id, a.name]));
  const kartAdi = new Map(data.cards.map((c) => [c.id, c.name]));
  const katAdi = new Map(data.categories.map((c) => [c.id, c.name]));
  const out: Kayit[] = [];

  for (const t of data.transactions) {
    const parcalar = [
      t.category_id != null ? katAdi.get(t.category_id) : null,
      t.account_id != null ? hesapAdi.get(t.account_id) : null,
    ].filter(Boolean);
    out.push({
      key: `gelir-gider:${t.id}`, tur: "gelir-gider", id: t.id, date: t.date,
      ad: t.name || ISIM_YOK, detay: parcalar.join(" · "),
      tutar: Math.abs(t.amount), yon: t.amount >= 0 ? "giris" : "cikis",
      currency: "TRY", etiket: t.amount >= 0 ? "Gelir" : "Gider",
    });
  }

  for (const c of data.card_txs) {
    const taksit = c.installments > 1 ? ` · ${c.installments} taksit` : "";
    out.push({
      key: `kart:${c.id}`, tur: "kart", id: c.id, date: c.date,
      ad: c.name || ISIM_YOK, detay: `${kartAdi.get(c.card_id) ?? "kart"}${taksit}`,
      /* Kart harcaması nakdi O GÜN oynatmaz (ekstre gününde oynar), ama harcamadır —
         yön "çıkış"tır. Ekstre ödemesi ayrı bir gelir-gider kaydı olarak da listede görünür;
         bu yüzden bu liste TOPLAM ÜRETMEZ (ikisini toplamak aynı parayı iki kez sayardı). */
      tutar: Math.abs(c.amount), yon: "cikis",
      currency: "TRY", etiket: "Kart",
    });
  }

  for (const v of data.transfers) {
    out.push({
      key: `virman:${v.id}`, tur: "virman", id: v.id, date: v.date,
      ad: `${hesapAdi.get(v.from_account_id) ?? "?"} → ${hesapAdi.get(v.to_account_id) ?? "?"}`,
      detay: v.note ?? "",
      tutar: Math.abs(v.amount), yon: "notr", // kendi hesapların arası: para sistemden çıkmaz
      currency: "TRY", etiket: "Virman",
    });
  }

  for (const t of data.trades) {
    const giris = t.side === "SATIŞ" || t.side === "TEMETTÜ";
    out.push({
      key: `portfoy:${t.id}`, tur: "portfoy", id: t.id, date: t.date,
      ad: `${t.side} ${t.symbol.toUpperCase()}`,
      detay: [t.asset_type, t.account_id != null ? hesapAdi.get(t.account_id) : null].filter(Boolean).join(" · "),
      /* İşlem büyüklüğü = adet × fiyat (komisyon hariç; komisyon satırın ayrıntısı değil kimliği
         değiştirmez). BEDELSİZ'de para hareketi yoktur → 0 ve "nötr". */
      tutar: t.side === "BEDELSİZ" ? 0 : Math.abs(t.qty * t.price),
      yon: t.side === "BEDELSİZ" ? "notr" : giris ? "giris" : "cikis",
      currency: t.currency ?? "TRY", etiket: t.side,
    });
  }

  /* En yeni önce; aynı gün içinde tür+id ile kararlı sıra (aksi halde her render'da satırlar
     yer değiştirir gibi görünürdü). */
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.key.localeCompare(a.key));
}

/** Arama için sadeleştirme: küçült + Türkçe harfleri ASCII karşılıklarına katla.
 *
 *  İki ayrı sebepten şart:
 *  1) Türkçe'de büyük **I** küçülünce **ı** olur — yani "MIGROS" → "mıgros", kayıttaki
 *     "Migros" → "migros" ve arama HİÇ eşleşmez. (Testle yakalandı; locale'siz
 *     `toLowerCase()` de "İnternet"i "i̇nternet" yapıp aynı derdi ters yönden yaratır.)
 *  2) Kullanıcı Türkçe karakter yazmadan arar: "sarj" yazıp "Şarj"ı bulmak ister.
 *  Katlama her iki tarafa da uygulanır, yani karşılaştırma simetriktir. */
const TR_KATLA: Record<string, string> = {
  ı: "i", i: "i", ş: "s", ğ: "g", ü: "u", ö: "o", ç: "c", â: "a", î: "i", û: "u",
};
const sadelestir = (s: string) =>
  s.toLocaleLowerCase("tr").replace(/[ıişğüöçâîû]/g, (ch) => TR_KATLA[ch] ?? ch);

/** Serbest metin araması: ad + detay + etiket taranır. Boş sorgu listeyi olduğu gibi döner.
    Birden çok kelime VE ile bağlanır ("market garanti" → ikisi de geçmeli), çünkü kullanıcı
    hatırladığı parçaları arka arkaya yazar; OR sonuçları gürültüye boğardı. */
export function kayitAra(kayitlar: Kayit[], sorgu: string): Kayit[] {
  const kelimeler = sadelestir(sorgu).split(/\s+/).filter(Boolean);
  if (!kelimeler.length) return kayitlar;
  return kayitlar.filter((k) => {
    const havuz = sadelestir(`${k.ad} ${k.detay} ${k.etiket}`);
    return kelimeler.every((w) => havuz.includes(w));
  });
}

export type KayitSuzgec = {
  tur?: KayitTuru | "hepsi";
  /** bu tarihten itibaren (dahil), YYYY-MM-DD; yoksa sınır yok */
  from?: string;
  sorgu?: string;
};

/** Tür + tarih + metin süzgeçlerini sırayla uygular (hepsi opsiyonel). */
export function kayitSuz(kayitlar: Kayit[], s: KayitSuzgec): Kayit[] {
  let out = kayitlar;
  if (s.tur && s.tur !== "hepsi") out = out.filter((k) => k.tur === s.tur);
  if (s.from) out = out.filter((k) => k.date >= s.from!);
  if (s.sorgu) out = kayitAra(out, s.sorgu);
  return out;
}

/** Aya göre gruplar (liste başlıkları için) — giriş sırası korunur, yani en yeni ay üstte. */
export function kayitlariAyaGoreGrupla(kayitlar: Kayit[]): { ym: string; kayitlar: Kayit[] }[] {
  const m = new Map<string, Kayit[]>();
  for (const k of kayitlar) {
    const ym = k.date.slice(0, 7);
    if (!m.has(ym)) m.set(ym, []);
    m.get(ym)!.push(k);
  }
  return [...m.entries()].map(([ym, ks]) => ({ ym, kayitlar: ks }));
}
