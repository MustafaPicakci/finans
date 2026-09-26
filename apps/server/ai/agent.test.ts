import { describe, it, expect } from "vitest";
import { planGecerli } from "./index.js";
import { AiError, withKeyFallback, type AiProvider } from "./provider.js";

/* Ajan döngüsünün testleri `packages/asistan`'a taşındı (E2EE aşama 4). Burada kalanlar
   SUNUCUYA ait iki şey: sağlayıcının anahtar devri (anahtarlar yalnız sunucuda) ve plan
   deposunun ömrü (ai_plans). */

describe("planın ömrü", () => {
  const saatOnce = (s: number) => {
    const d = new Date(Date.now() - s * 3600_000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  it("taze plan geçerli, süresi dolan geçersizdir", () => {
    expect(planGecerli(saatOnce(1))).toBe(true);
    expect(planGecerli(saatOnce(23))).toBe(true);
    expect(planGecerli(saatOnce(25))).toBe(false);
  });
  /* Onay kartı artık yenilemeden sonra geri geldiğinden, süresi dolmuş bir planın
     sessizce "geçerli" görünmesi kullanıcıya bayat argümanları onaylatırdı. */
  it("sınır ttl parametresiyle daraltılabilir", () => {
    expect(planGecerli(saatOnce(2), 1)).toBe(false);
    expect(planGecerli(saatOnce(2), 3)).toBe(true);
  });
});

describe("withKeyFallback", () => {
  /** kota/anahtar hatası → anahtar değiştirmeye DEĞER (retryable) */
  const quota = () => new AiError("AI kotası doldu, biraz sonra tekrar dene", true);

  it("çalışan tek anahtarda sonucu döndürür", async () => {
    await expect(withKeyFallback(["k1"], async (k) => `ok:${k}`)).resolves.toBe("ok:k1");
  });

  /* NOT: imleç (son çalışan anahtar) modül düzeyinde kalıcıdır — bu bilinçli, çünkü kota
     dolan anahtara her istekte yeniden çarpmak istemiyoruz. Testler bu yüzden "hangi
     anahtar" yerine "kaç anahtar denendi" üzerinden yazıldı; sırayla çalışmaları gerekmesin. */
  it("kota dolan anahtardan sıradakine geçer", async () => {
    const tried: string[] = [];
    let ilk = "";
    const out = await withKeyFallback(["k1", "k2"], async (k) => {
      tried.push(k);
      if (!ilk) { ilk = k; throw quota(); } // hangisiyle başlarsa başlasın, ilki kotada
      return "ok";
    }, () => {});
    expect(out).toBe("ok");
    expect(tried).toHaveLength(2);
  });

  it("çalışan anahtarda kalır — sonraki istek kota dolan anahtara geri dönmez", async () => {
    let calisan = "";
    await withKeyFallback(["k1", "k2"], async (k) => {
      if (!calisan) { calisan = k === "k1" ? "k2" : "k1"; throw quota(); }
      return "ok";
    }, () => {});
    const tried: string[] = [];
    await withKeyFallback(["k1", "k2"], async (k) => { tried.push(k); return "ok"; }, () => {});
    expect(tried).toEqual([calisan]); // doğrudan çalışan anahtardan başladı
  });

  it("anahtarla ilgisi olmayan hatada anahtar harcamaz (aynı istek diğerinde de patlar)", async () => {
    const tried: string[] = [];
    await expect(withKeyFallback(["k1", "k2"], async (k) => { tried.push(k); throw new AiError("model yok"); }, () => {}))
      .rejects.toThrow("model yok");
    expect(tried).toHaveLength(1);
  });

  it("tüm anahtarlar tükenirse son hatayı fırlatır", async () => {
    await expect(withKeyFallback(["k1", "k2"], async () => { throw quota(); }, () => {}))
      .rejects.toThrow("kotası doldu");
  });
});

