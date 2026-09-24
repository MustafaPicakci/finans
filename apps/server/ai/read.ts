/* ============================================================================
   Okuma araçları (Faz 22)
   ----------------------------------------------------------------------------
   Yazma araçlarının aksine bunlar bir API ucuna karşılık gelmez: sistemin
   durumunu modelin ANLAYABİLECEĞİ kadar küçültülmüş biçimde döndürürler.
   Kullanıcının tanım kayıtları (hesap/kart/kategori adları) zaten her istekte
   sistem promptuna giriyor (context.ts); buradakiler istek üzerine bakılan,
   büyük ya da hesaplanması gereken şeyler:
     - kart_ekstreleri → ekstre_ode'nin ihtiyaç duyduğu `due` tarihleri
     - pozisyonlar     → "tümünü sat", "kaç adet var" soruları
     - kayit_ara       → düzenle/sil araçlarının ihtiyaç duyduğu kayıt id'leri
   Hepsi kullanıcıya scope'ludur (uid ile sorgulanır).

   ————— Faz 35: TOPLAMLAR —————
   Yukarıdakiler yazma araçlarının ihtiyaç duyduğu id/tutarları verir; asistanın kendisi SORU
   cevaplayamıyordu. "Bu ay ne kadar harcadım" sorulduğunda modelin elindeki tek yol `kayit_ara`
   ile en çok 50 satır çekip kafadan toplamaktı: tek TÜR (kart + hesap birleşmiyor), 50'yi aşan
   ayda SESSİZCE eksik, ve ekstre ödemesiyle kart harcamasını ayırt etmeden. Yani cevap ya yoktu
   ya yanlıştı — ikisi de kabul edilemez, çünkü kullanıcı rakamı doğru sanır.

   Üç araç bu boşluğu kapatır ve toplamı MODEL DEĞİL SUNUCU hesaplar (harcama_ozeti,
   net_varlik, nakit_durumu). Matematik burada değil engine'de: net varlık `Day.worth` ile,
   harcama özeti çifte sayma kuralıyla, nakit açığı Özet ekranının kendi önerisiyle aynı
   tanımdır — asistanın söylediği rakam ekranda görünenle çelişmesin diye. */

import {
  positions, openPositions, txShares, keyOf, stmtKey, harcamaOzeti, netWorthBreakdown, project,
  cashGap, fundSellSuggestion,
  type Card, type CardTx, type Trade, type Price, type Transaction, type Category,
  type HarcamaTemeli, type HarcamaGrup, type Rates,
} from "@finans/engine";
import { db, todayLocal } from "../db.js";
import { loadAllData } from "../data.js";
import type { ArgVals } from "./tools.js";
import type { JsonSchema } from "./provider.js";

export type ReadTool = {
  name: string;
  description: string;
  parameters: JsonSchema;
  run: (uid: number, args: ArgVals) => Promise<unknown>;
};

const dateShift = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return keyOf(d);
};
const num = (v: unknown, def: number) => (Number.isFinite(Number(v)) ? Number(v) : def);
const r2 = (n: number) => Math.round(n * 100) / 100;
/** USD-doğal varlıkları TRY'ye çevirmek için kur (kaynak: settings.fx_usd_try — prices.ts her
    tazelemede yazar). Kur yoksa 0: engine USD pozisyonu çevirmeden bırakır, uydurmaz. */
const ratesOf = (settings: Record<string, string>): Rates => ({ usdTry: Number(settings.fx_usd_try) || 0 });

export const READ_TOOLS: ReadTool[] = [
  {
    name: "kart_ekstreleri",
    description:
      "Kredi kartlarının ekstrelerini listeler: her ekstrenin son ödeme tarihi (due), tutarı ve ödenmiş olup olmadığı. " +
      "ekstre_ode aracının 'due' değerini buradan al. Varsayılan pencere son 3 ay + gelecek 4 ay.",
    parameters: {
      type: "object",
      properties: { card_id: { type: "integer", description: "Yalnız bu kartı listele (opsiyonel)" } },
    },
    async run(uid, a) {
      const cards = await db.all<Card>("SELECT * FROM cards WHERE user_id=?", uid);
      const txs = await db.all<CardTx>("SELECT * FROM card_txs WHERE user_id=?", uid);
      const paid = new Set(
        (await db.all<{ card_id: number; due: string }>("SELECT card_id, due FROM statement_payments WHERE user_id=?", uid))
          .map((p) => stmtKey(p.card_id, p.due)),
      );
      const from = dateShift(-95), to = dateShift(125);
      const wanted = a.card_id != null ? cards.filter((c) => c.id === Number(a.card_id)) : cards;
      return wanted.map((card) => {
        const byDue = new Map<string, number>();
        for (const t of txs.filter((t) => t.card_id === card.id)) {
          for (const sh of txShares(t, card)) {
            const k = keyOf(sh.due);
            if (k >= from && k <= to) byDue.set(k, (byDue.get(k) ?? 0) + sh.amount);
          }
        }
        return {
          kart_id: card.id, kart: card.name, kesim_gunu: card.statement_day, son_odeme_gunu: card.due_day,
          ekstreler: [...byDue.entries()].sort((x, y) => x[0].localeCompare(y[0]))
            .map(([due, amount]) => ({ due, tutar: r2(amount), odendi: paid.has(stmtKey(card.id, due)) })),
        };
      });
    },
  },
  {
    name: "pozisyonlar",
    description:
      "Portföydeki güncel pozisyonlar: sembol, tür, elde tutulan adet, ortalama maliyet, güncel fiyat ve değer. " +
      "'Tümünü sat', 'kaç adedim var', 'ne kadar kâr var' gibi sorularda kullan.",
    parameters: { type: "object", properties: { symbol: { type: "string", description: "Yalnız bu sembol (opsiyonel)" } } },
    async run(uid, a) {
      const trades = await db.all<Trade>("SELECT * FROM trades WHERE user_id=? ORDER BY date, id", uid);
      const auto = await db.all<Price>("SELECT symbol, asset_type, price, source, updated_at, currency FROM prices");
      const manual = await db.all<Price>("SELECT symbol, asset_type, price, updated_at, currency FROM user_prices WHERE user_id=?", uid);
      const pm = new Map(auto.map((p) => [`${p.asset_type}:${p.symbol}`, p]));
      for (const p of manual) pm.set(`${p.asset_type}:${p.symbol}`, { ...p, source: "manual" });
      const sym = a.symbol ? String(a.symbol).toUpperCase() : null;
      /* `openPositions`: `positions()` işlem görmüş HER sembolü döndürür, kapananlar dahil.
         Süzülmezse asistan "elinde 0 adet EREGL var" diyebiliyordu — oysa aracın kendi
         açıklaması "elde tutulan adet" diyor. Arayüzdeki liste ile aynı kural. */
      return openPositions(positions(trades, [...pm.values()]))
        .filter((p) => (sym ? p.sym.toUpperCase() === sym : true))
        .map((p) => ({
          sembol: p.sym, tur: p.type, adet: r2(p.qty), ort_maliyet: r2(p.avg),
          fiyat: p.cur != null ? r2(p.cur) : null, deger: p.value != null ? r2(p.value) : null,
          gerceklesmemis_kz: p.unreal != null ? r2(p.unreal) : null, para_birimi: p.currency,
        }));
    },
  },
  {
    name: "kayit_ara",
    description:
      "Kayıtları arar ve id'lerini döndürür — düzenleme/silme araçları bu id'leri ister. " +
      "tur: islem (gerçekleşen gelir/gider) | portfoy (alım-satım) | kart (kart harcaması) | plan (tek seferlik plan kalemi). " +
      "Sonuç { toplam, gosterilen, kayitlar } biçimindedir ve liste kesilmiş olabilir: " +
      "BU LİSTEDEN TOPLAM ÇIKARMA, toplam için harcama_ozeti aracını kullan.",
    parameters: {
      type: "object",
      properties: {
        tur: { type: "string", description: "Aranacak kayıt türü", enum: ["islem", "portfoy", "kart", "plan"] },
        metin: { type: "string", description: "Ad/sembol içinde geçen metin (opsiyonel)" },
        baslangic: { type: "string", description: "Başlangıç tarihi 'YYYY-MM-DD' (opsiyonel)" },
        bitis: { type: "string", description: "Bitiş tarihi 'YYYY-MM-DD' (opsiyonel)" },
        limit: { type: "integer", description: "En fazla kaç kayıt (varsayılan 20, en çok 50)" },
      },
      required: ["tur"],
    },
    async run(uid, a) {
      /* Tür başına TEK tanım: tablo + aranan kolon + döndürülen kolonlar. Eskiden `switch`
         her türün SQL'ini ayrı yazıyordu; sayaç eklenince tablo adı ikinci bir yerde de
         geçecekti, yani yeni bir tür eklendiğinde biri güncellenmeden kalabilirdi. */
      const TURLER = {
        islem: { tablo: "transactions", kolon: "name", secim: "id, date, name, amount, category_id, account_id" },
        portfoy: { tablo: "trades", kolon: "symbol", secim: "id, date, symbol, asset_type, side, qty, price, fee, currency, account_id, portfolio_id" },
        kart: { tablo: "card_txs", kolon: "name", secim: "id, date, name, amount, installments, card_id" },
        plan: { tablo: "oneoffs", kolon: "name", secim: "id, date, name, amount" },
      } as const;
      const tur = (String(a.tur) in TURLER ? String(a.tur) : "islem") as keyof typeof TURLER;
      const { tablo, kolon, secim } = TURLER[tur];
      const limit = Math.min(Math.max(num(a.limit, 20), 1), 50);
      const from = a.baslangic ? String(a.baslangic) : "0000-01-01";
      const to = a.bitis ? String(a.bitis) : "9999-12-31";
      const like = a.metin ? `%${String(a.metin)}%` : "%";
      const kosul = `WHERE user_id=? AND date BETWEEN ? AND ? AND ${kolon} ILIKE ?`;
      /* Sonuç `{ toplam, gosterilen, kayitlar }` — çıplak dizi DEĞİL. Eskiden dizi dönüyordu ve
         50'de kesildiğinde bunu hiçbir şey söylemiyordu: model 50 satırı toplayıp "bu ay 12.400
         harcadın" diyebiliyordu, oysa 137 kayıt vardı. Toplam sayının görünmesi, modelin
         toplamaya kalkmak yerine harcama_ozeti'ne yönelmesini de sağlar (sistem promptu bunu
         açıkça söyler). */
      const [sayim, kayitlar] = await Promise.all([
        db.get<{ n: string }>(`SELECT COUNT(*) AS n FROM ${tablo} ${kosul}`, uid, from, to, like),
        db.all<any>(`SELECT ${secim} FROM ${tablo} ${kosul} ORDER BY date DESC, id DESC LIMIT ?`, uid, from, to, like, limit),
      ]);
      const toplam = Number(sayim?.n ?? 0);
      return {
        toplam, gosterilen: kayitlar.length,
        ...(toplam > kayitlar.length
          ? { uyari: `${toplam} kayıttan yalnız ${kayitlar.length} tanesi döndü — bu listeden TOPLAM ÇIKARMA, harcama_ozeti aracını kullan.` }
          : {}),
        kayitlar,
      };
    },
  },
  {
    name: "bugun",
    description: "Bugünün tarihini döndürür. Kullanıcı 'dün', 'geçen cuma', '11 temmuzda' gibi göreli tarihler söylediğinde referans al.",
    parameters: { type: "object", properties: {} },
    async run() {
      const t = todayLocal();
      const gun = new Date().toLocaleDateString("tr-TR", { weekday: "long" });
      return { bugun: t, gun };
    },
  },
  /* ————— Faz 35: TOPLAMLAR ————— */
  {
    name: "harcama_ozeti",
    description:
      "Bir tarih aralığındaki gider/gelir TOPLAMINI sunucuda hesaplar. 'Bu ay ne kadar harcadım', " +
      "'markete ne verdim', 'geçen aya göre nasıl', 'en çok nereye gidiyor' sorularının tek doğru yolu. " +
      "Kayıt listelerinden ASLA kendin toplam çıkarma. " +
      "temel='tuketim' (varsayılan): kart harcamaları harcandığı gün tam tutarıyla sayılır, ekstre " +
      "ödemeleri sayılmaz (aynı para iki kez sayılmasın). temel='nakit': yalnız hesaptan geçenler " +
      "(ekstre ödemesi dahil, kart harcaması hariç). " +
      "grup ile kırılım al: 'ay' (aylık karşılaştırma), 'kategori' (kart harcaması da kategorisine " +
      "girer; kategorisi GİRİLMEMİŞ olanlar tek kovada toplanır ve bunu 'uyari' söyler), 'kart'. " +
      "Kartın hangi ekstreye ne yansıdığı BAŞKA bir soru → kart_ekstreleri.",
    parameters: {
      type: "object",
      properties: {
        baslangic: { type: "string", description: "'YYYY-MM-DD' (dahil). Varsayılan: bu ayın 1'i" },
        bitis: { type: "string", description: "'YYYY-MM-DD' (dahil). Varsayılan: bugün" },
        temel: { type: "string", description: "tuketim | nakit", enum: ["tuketim", "nakit"] },
        grup: { type: "string", description: "Kırılım", enum: ["yok", "ay", "kategori", "kart"] },
        metin: { type: "string", description: "Ad/kategori/kart adında geçen metin (opsiyonel, Türkçe'ye toleranslı)" },
      },
    },
    async run(uid, a) {
      const bugun = todayLocal();
      const baslangic = a.baslangic ? String(a.baslangic) : `${bugun.slice(0, 7)}-01`;
      const bitis = a.bitis ? String(a.bitis) : bugun;
      /* Tarih süzgeci SQL'de: engine zaten yeniden süzüyor ama bütün defteri belleğe çekmenin
         anlamı yok (transactions/card_txs zamanla monoton büyür). */
      /* `SELECT *` bilinçli (Faz 41 gözden geçirmesi): burada kolonlar ELLE sayılıyordu ve Faz
         39'da eklenen `card_txs.category_id` bu listeye girmedi — asistan her kart harcamasını
         kategorisiz görüyor, ekrandaki panel doğru rakamı veriyordu. Yani "asistanın rakamı
         ekranla tanım olarak aynıdır" güvencesi sessizce kırılmıştı. Kolon listesi tutmak,
         engine'in sözleşmesini İKİNCİ bir yerde tekrarlamaktır; `/api/all`'ın yükleyicisi
         (data.ts) de bu yüzden `SELECT *` kullanıyor. Tarih süzgeci kalıyor: bütün defteri
         belleğe çekmenin anlamı yok. */
      const [transactions, card_txs, categories, cards, accounts, ekstre] = await Promise.all([
        db.all<Transaction>(
          "SELECT * FROM transactions WHERE user_id=? AND date BETWEEN ? AND ?", uid, baslangic, bitis),
        db.all<CardTx>(
          "SELECT * FROM card_txs WHERE user_id=? AND date BETWEEN ? AND ?", uid, baslangic, bitis),
        db.all<Category>("SELECT id, name, kind, color FROM categories WHERE user_id=?", uid),
        db.all<Card>("SELECT * FROM cards WHERE user_id=?", uid),
        // yalnız metin süzgeci için: arama hesap adını da taramalı (bkz. harcama.ts HarcamaVeri)
        db.all<{ id: number; name: string }>("SELECT id, name FROM accounts WHERE user_id=?", uid),
        /* Ekstre ödemesi olan transaction id'leri. Engine bunu adından ÇIKARAMAZ ("Akbank
           ekstresi" elle de yazılabilir), kaynağı `statement_payments.tx_id`dir. */
        db.all<{ tx_id: number }>("SELECT tx_id FROM statement_payments WHERE user_id=? AND tx_id IS NOT NULL", uid),
      ]);
      return harcamaOzeti(
        { transactions, card_txs, categories, cards, accounts, ekstreTxIds: ekstre.map((e) => e.tx_id) },
        {
          baslangic, bitis,
          temel: (a.temel as HarcamaTemeli) ?? "tuketim",
          grup: (a.grup as HarcamaGrup) ?? "yok",
          metin: a.metin ? String(a.metin) : undefined,
        },
      );
    },
  },
  {
    name: "net_varlik",
    description:
      "Net varlığın bugünkü kırılımı: nakit + portföy + vadeli mevduat − kart borcu − kredi borcu. " +
      "'Ne kadar param var', 'net varlığım', 'ne kadar borcum var' sorularında kullan. " +
      "Rakam uygulamanın en üstünde yazan net varlıkla AYNI tanımdır.",
    parameters: { type: "object", properties: {} },
    async run(uid) {
      const data = await loadAllData(uid);
      const n = netWorthBreakdown(data, ratesOf(data.settings));
      return {
        tarih: todayLocal(),
        nakit: r2(n.nakit), portfoy: r2(n.portfoy), vadeli: r2(n.vadeli),
        toplam_varlik: r2(n.toplam),
        kart_borcu: r2(n.kartBorcu), kredi_borcu: r2(n.krediBorcu), toplam_borc: r2(n.borc),
        net_varlik: r2(n.net),
        para_birimi: "TRY",
      };
    },
  },
  {
    name: "nakit_durumu",
    description:
      "Nakit akışı projeksiyonu: bugünden ileriye bakıp en düşük bakiyeyi, varsa ilk EKSİYE DÜŞEN günü " +
      "ve yaklaşan hareketleri verir. 'Ayı çıkarır mıyım', 'ne zaman eksiye düşerim', 'param yeter mi', " +
      "'yaklaşan ödemelerim' sorularında kullan. Nakit açığı varsa hangi para piyasası fonundan ne kadar " +
      "bozulması gerektiğini de söyler (Özet ekranındaki öneriyle aynı hesap).",
    parameters: {
      type: "object",
      properties: { aylar: { type: "integer", description: "Kaç ay ileri bakılsın (1-12, varsayılan 3)" } },
    },
    async run(uid, a) {
      const aylar = Math.min(Math.max(num(a.aylar, 3), 1), 12);
      const data = await loadAllData(uid);
      const rates = ratesOf(data.settings);
      const days = project(data, aylar, rates);
      if (!days.length) return { hata: "projeksiyon üretilemedi" };
      const enDusuk = days.reduce((m, d) => (d.bal < m.bal ? d : m), days[0]);
      const ilkEksi = days.find((d) => d.bal < 0) ?? null;
      const oneri = fundSellSuggestion(days, data, rates);
      const gap = cashGap(days);
      return {
        bugun: todayLocal(),
        pencere: `${aylar} ay`,
        nakit_bugun: r2(days[0].bal),
        /* Nakit sayılan fonlar ayrı raporlanır: açık hesabı SAF nakde göre yapılır (bkz. funds.ts —
           etkin nakde bakılsa öneri hiç çıkmazdı), ama kullanıcının elinde likit fon varsa
           "eksiye düşüyorsun" cümlesi bunu söylemeden eksik kalır. */
        nakit_sayilan_fon: r2(days[0].cashFunds),
        pencere_sonu_nakit: r2(days[days.length - 1].bal),
        en_dusuk: { tarih: enDusuk.k, nakit: r2(enDusuk.bal) },
        ilk_eksi_gun: ilkEksi ? { tarih: ilkEksi.k, nakit: r2(ilkEksi.bal) } : null,
        yaklasan_hareketler: days
          .filter((d) => d.ev.length)
          .slice(0, 12)
          .map((d) => ({ tarih: d.k, hareketler: d.ev.map((e) => ({ ad: e.n, tutar: r2(e.a) })) })),
        acik_7_gun: gap ? { tutar: r2(gap.amount), ilk_eksi: gap.firstNegative.k, en_derin: gap.deepest.k } : null,
        fon_boz_onerisi: oneri
          ? {
              sembol: oneri.fund.symbol, tutar: r2(oneri.amount), en_gec: keyOf(oneri.sellBy),
              fon_degeri: r2(oneri.fund.valueTry), acigi_kapatir: oneri.covered,
            }
          : null,
        net_varlik_icin: "net_varlik aracını çağır — bu araç yalnız NAKİT akışını anlatır",
      };
    },
  },
];
