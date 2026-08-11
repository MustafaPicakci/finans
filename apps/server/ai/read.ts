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
   Hepsi kullanıcıya scope'ludur (uid ile sorgulanır). */

import { positions, txShares, keyOf, stmtKey, type Card, type CardTx, type Trade, type Price } from "@finans/engine";
import { db, todayLocal } from "../db.js";
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
      return positions(trades, [...pm.values()])
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
      "tur: islem (gerçekleşen gelir/gider) | portfoy (alım-satım) | kart (kart harcaması) | plan (tek seferlik plan kalemi).",
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
      const limit = Math.min(Math.max(num(a.limit, 20), 1), 50);
      const from = a.baslangic ? String(a.baslangic) : "0000-01-01";
      const to = a.bitis ? String(a.bitis) : "9999-12-31";
      const like = a.metin ? `%${String(a.metin)}%` : "%";
      const q = (sql: string) => db.all<any>(sql, uid, from, to, like, limit);
      switch (a.tur) {
        case "portfoy":
          return q(`SELECT id, date, symbol, asset_type, side, qty, price, fee, currency, account_id, portfolio_id
                    FROM trades WHERE user_id=? AND date BETWEEN ? AND ? AND symbol ILIKE ? ORDER BY date DESC, id DESC LIMIT ?`);
        case "kart":
          return q(`SELECT id, date, name, amount, installments, card_id
                    FROM card_txs WHERE user_id=? AND date BETWEEN ? AND ? AND name ILIKE ? ORDER BY date DESC, id DESC LIMIT ?`);
        case "plan":
          return q(`SELECT id, date, name, amount FROM oneoffs
                    WHERE user_id=? AND date BETWEEN ? AND ? AND name ILIKE ? ORDER BY date DESC, id DESC LIMIT ?`);
        default:
          return q(`SELECT id, date, name, amount, category_id, account_id FROM transactions
                    WHERE user_id=? AND date BETWEEN ? AND ? AND name ILIKE ? ORDER BY date DESC, id DESC LIMIT ?`);
      }
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
];
