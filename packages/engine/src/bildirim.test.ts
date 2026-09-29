import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { bildirimPlani } from "./bildirim.js";
import { project } from "./projection.js";
import type { AllData, Card } from "./types.js";

const data = (over: Partial<AllData> = {}): AllData => ({
  accounts: [], recurring: [], loans: [], oneoffs: [], trades: [], portfolios: [], cards: [], card_txs: [],
  prices: [], price_history: [], categories: [], transactions: [], deposits: [], recurring_realized: [],
  statement_payments: [], settings: {}, recurring_amounts: [], account_entries: [], transfers: [],
  ...over,
} as AllData);
const kart = (over: Partial<Card> = {}): Card => ({ id: 3, name: "Bonus", limit_amount: 0, statement_day: 5, due_day: 15, ...over });
/** yerel saatle kurulmuş anın ISO'su — testler saat diliminden bağımsız kalsın */
const iso = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h).toISOString();
const plan = (d: AllData) => bildirimPlani(d, project(d, 3), new Date());

describe("bildirimPlani", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 20, 12)); }); // 20 Eylül 2026 öğlen
  afterEach(() => vi.useRealTimers());

  it("düzenli gider olaydan 3 gün önce 09:00'da, tutarıyla; gelir hatırlatılmaz", () => {
    const d = data({
      recurring: [
        { id: 1, kind: "expense", name: "Kira", day: 1, from_month: null, to_month: null },
        { id: 2, kind: "income", name: "Maaş", day: 15, from_month: null, to_month: null },
      ],
      recurring_amounts: [{ recurring_id: 1, from_month: "0000-01", amount: 25_000 }, { recurring_id: 2, from_month: "0000-01", amount: 85_000 }],
    });
    const ekim = plan(d).find((o) => o.anahtar === "r:1:2026-10-01")!;
    expect(ekim.zaman).toBe(iso(2026, 9, 28));
    expect(ekim.baslik).toBe("Kira · 3 gün sonra");
    expect(ekim.govde).toContain("₺25.000");
    expect(ekim.bitis).toBe(new Date(2026, 9, 2).toISOString()); // olay günü bitince gönderilmez
    expect(plan(d).some((o) => o.anahtar.startsWith("r:2:"))).toBe(false);
  });

  it("hatırlatma anı geçmişte kalan olay plana girmez (olay 2 gün sonra)", () => {
    const d = data({
      recurring: [{ id: 1, kind: "expense", name: "Aidat", day: 22, from_month: null, to_month: null }],
      recurring_amounts: [{ recurring_id: 1, from_month: "0000-01", amount: 1_500 }],
    });
    const anahtarlar = plan(d).map((o) => o.anahtar);
    expect(anahtarlar).not.toContain("r:1:2026-09-22");
    expect(anahtarlar).toContain("r:1:2026-10-22");
  });

  it("gerçekleşmiş ay hatırlatılmaz — projeksiyonla aynı kural", () => {
    const d = data({
      recurring: [{ id: 1, kind: "expense", name: "Kira", day: 1, from_month: null, to_month: null }],
      recurring_amounts: [{ recurring_id: 1, from_month: "0000-01", amount: 25_000 }],
      recurring_realized: [{ recurring_id: 1, ym: "2026-10" }] as AllData["recurring_realized"],
    });
    const anahtarlar = plan(d).map((o) => o.anahtar);
    expect(anahtarlar).not.toContain("r:1:2026-10-01");
    expect(anahtarlar).toContain("r:1:2026-11-01");
  });

  it("kredi taksiti kalan taksit sayısıyla; biten kredi hatırlatılmaz", () => {
    const d = data({ loans: [{ id: 7, name: "Taşıt kredisi", amount: 9_100, first_date: "2026-10-10", total: 2 }] });
    const p = plan(d).filter((o) => o.anahtar.startsWith("l:7:"));
    expect(p.map((o) => o.anahtar)).toEqual(["l:7:2026-10-10", "l:7:2026-11-10"]);
    expect(p[0].baslik).toBe("Taşıt kredisi taksiti · 3 gün sonra");
    expect(p[0].govde).toContain("bu taksitten sonra 1 kalıyor"); // ilki ödenince 1 kalır — "kalan 1" son taksit sanılırdı
    expect(p[1].govde).toContain("son taksit");
  });

  it("kart: kesimden 3 gün önce 'şu ana kadar' tutarıyla, son ödemeden 3 gün önce ekstre tutarıyla", () => {
    const d = data({
      cards: [kart()],
      card_txs: [{ id: 1, card_id: 3, date: "2026-09-18", name: "Market", amount: 1_200, installments: 1 }],
    });
    const p = plan(d);
    const kesim = p.find((o) => o.anahtar === "k:3:2026-10-05")!;
    expect(kesim.zaman).toBe(iso(2026, 10, 2));
    expect(kesim.baslik).toBe("Bonus ekstresi 3 gün sonra kesiliyor");
    expect(kesim.govde).toContain("şu ana kadar ₺1.200");
    expect(kesim.url).toBe("/kart");
    const odeme = p.find((o) => o.anahtar === "e:3:2026-10-15")!;
    expect(odeme.zaman).toBe(iso(2026, 10, 12));
    expect(odeme.govde).toContain("₺1.200");
  });

  it("harcaması olmayan kesim hatırlatılmaz (her ay '₺0' gürültü olurdu)", () => {
    expect(plan(data({ cards: [kart()] }))).toEqual([]);
  });

  it("ödenmiş ekstre hatırlatılmaz", () => {
    const d = data({
      cards: [kart()],
      card_txs: [{ id: 1, card_id: 3, date: "2026-09-18", name: "Market", amount: 1_200, installments: 1 }],
      statement_payments: [{ card_id: 3, due: "2026-10-15" }] as AllData["statement_payments"],
    });
    expect(plan(d).some((o) => o.anahtar === "e:3:2026-10-15")).toBe(false);
  });

  it("ufuk dışı olay plana girmez ve plan zamana göre sıralıdır", () => {
    const d = data({
      recurring: [{ id: 1, kind: "expense", name: "Kira", day: 1, from_month: null, to_month: null }],
      recurring_amounts: [{ recurring_id: 1, from_month: "0000-01", amount: 25_000 }],
      oneoffs: [{ id: 4, date: "2026-10-03", name: "Sigorta", amount: -3_000 }],
    });
    const p = bildirimPlani(d, project(d, 6), new Date(), { ufukGun: 30 });
    expect(p.map((o) => o.anahtar)).toEqual(["r:1:2026-10-01", "o:4:2026-10-03"]);
  });
});
