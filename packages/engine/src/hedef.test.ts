import { describe, expect, it } from "vitest";
import { hedefTahmin } from "./hedef.js";
import type { AllData } from "./types.js";

const veri = (e: Partial<AllData>) => ({ accounts: [], cards: [], card_txs: [], account_entries: [], trades: [], transactions: [], ...e }) as unknown as AllData;

const kartEkstresi = [
  "Hesap Kesim Tarihi\t04/09/2026",
  "Dönem Borcu\t500.00 TL",
  "Önceki Dönem Hesap Özeti Bakiyesi\t1,000.00",
  "11/08/2026\tÖdemeniz için Teşekkürler\t1,000.00(-)",
  "21/08/2026\tOKYANUS KAHVE\t420.00",
  "23/08/2026\tMARKET\t80.00",
].join("\n");

describe("hedefTahmin — içe aktarma hedefi belgeden", () => {
  it("kart ekstresi: kart seçilir, defterinde en çok satırı eşleşen kart kazanır (hesap varken bile)", () => {
    const d = veri({
      accounts: [{ id: 1, name: "Akbank", kind: "banka" }] as AllData["accounts"],
      cards: [{ id: 5, name: "Garanti" }, { id: 6, name: "Akbank" }] as AllData["cards"],
      card_txs: [{ id: 1, card_id: 6, date: "2026-08-21", name: "Okyanus", amount: 420, installments: 1 }] as AllData["card_txs"],
    });
    expect(hedefTahmin(kartEkstresi, d)).toEqual({ tur: "kart", hedef: "c:6", eslesen: 1, emin: true });
  });

  it("kanıt yoksa ilk aday, ama emin değil; tek aday varsa emin", () => {
    const iki = veri({ cards: [{ id: 5, name: "A" }, { id: 6, name: "B" }] as AllData["cards"] });
    expect(hedefTahmin(kartEkstresi, iki)).toMatchObject({ hedef: "c:5", emin: false });
    const tek = veri({ cards: [{ id: 6, name: "B" }] as AllData["cards"] });
    expect(hedefTahmin(kartEkstresi, tek)).toMatchObject({ hedef: "c:6", emin: true });
    expect(hedefTahmin(kartEkstresi, veri({}))).toEqual({ tur: "kart", hedef: "", eslesen: 0, emin: false });
  });

  it("hesap dökümü: belgenin son bakiyesi hesabın o günkü bakiyesiyse o hesap (eşleşme olmasa da)", () => {
    const dokum = "01.09.2026\tMIGROS\t-100,00\t900,00\n02.09.2026\tMAAS\t2.000,00\t2.900,00";
    const d = veri({
      accounts: [{ id: 1, name: "A" }, { id: 2, name: "B" }] as AllData["accounts"],
      account_entries: [
        { id: 1, account_id: 1, date: "2026-08-01", amount: 50, kind: "acilis" },
        { id: 2, account_id: 2, date: "2026-08-01", amount: 2900, kind: "acilis" },
      ] as AllData["account_entries"],
    });
    expect(hedefTahmin(dokum, d)).toMatchObject({ tur: "hesap", hedef: "a:2", emin: true });
  });

  it("aracı kurum ekstresi: işlem tablosu → portföy işlemleri, aracı kurum hesabına", () => {
    const txt = "Tarih\tSembol\tİşlem\tAdet\tFiyat\n05.08.2026\tTHYAO\tAlış\t10\t300,00";
    const d = veri({ accounts: [{ id: 1, name: "Banka", kind: "banka" }, { id: 3, name: "Midas", kind: "araci" }] as AllData["accounts"] });
    expect(hedefTahmin(txt, d)).toMatchObject({ tur: "islem", hedef: "t:3", emin: true });
  });
});
