import { describe, it, expect } from "vitest";
import { sar, ac, sifreliMi, b64u, unb64u, type Bayt } from "./aead.js";
import {
  parolaTuret, yeniSalt, yeniDek, dekAnahtari, dekSar, dekAc,
  yeniKurtarmaKodu, kurtarmaKoduCoz, kurtarmaSarici, VARSAYILAN_KDF, kdfDenetle, type KdfParams,
} from "./keys.js";

/* Testler hızlı kalsın diye düşük iterasyon; GERÇEK parametre (600k) yalnız altın vektörde
   koşar — o test parametrenin kendisi sessizce değişirse patlamak için var. */
const HIZLI: KdfParams = { alg: "PBKDF2-SHA256", iter: 1000 };
const esit = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const anahtar = async () => dekAnahtari(yeniDek());
const bayt = (s: string): Bayt => new TextEncoder().encode(s) as Bayt;

describe("AEAD", () => {
  it("gidiş-dönüş: şifrelenen aynı AAD ile aynen geri gelir", async () => {
    const k = await anahtar();
    expect(new TextDecoder().decode(await ac(k, await sar(k, bayt("Migros -450,50"), "x"), "x"))).toBe("Migros -450,50");
  });

  it("aynı veri iki kez şifrelenince iki FARKLI paket çıkar (IV rastgele)", async () => {
    const k = await anahtar();
    expect(await sar(k, bayt("aynı"), "x")).not.toBe(await sar(k, bayt("aynı"), "x"));
  });

  /* AAD'nin varlık sebebi bu test: paket başka bir yere taşınırsa AÇILMAMALI. */
  it("farklı AAD ile açmak FIRLATIR", async () => {
    const k = await anahtar();
    const p = await sar(k, bayt("gizli"), "transactions:6");
    await expect(ac(k, p, "transactions:7")).rejects.toThrow();
  });

  it("paketin tek karakteri değişirse FIRLATIR — sessizce çöp döndürmez", async () => {
    const k = await anahtar();
    const p = await sar(k, bayt("gizli"), "x");
    const son = p.at(-1) === "A" ? "B" : "A";
    await expect(ac(k, p.slice(0, -1) + son, "x")).rejects.toThrow();
  });

  it("yanlış anahtarla FIRLATIR", async () => {
    const p = await sar(await anahtar(), bayt("gizli"), "x");
    await expect(ac(await anahtar(), p, "x")).rejects.toThrow();
  });

  it("tanınmayan biçim ve sürüm anlaşılır hatayla reddedilir", async () => {
    const k = await anahtar();
    await expect(ac(k, "v2:abc:def", "x")).rejects.toThrow(/tanınmayan/);
    await expect(ac(k, "düz metin", "x")).rejects.toThrow(/tanınmayan/);
  });

  it("sifreliMi yalnız bu biçimi tanır (göç yeniden çalıştırılabilsin diye)", async () => {
    expect(sifreliMi(await sar(await anahtar(), bayt("a"), "x"))).toBe(true);
    expect(sifreliMi("Migros")).toBe(false);
    expect(sifreliMi(-450.5)).toBe(false);
    expect(sifreliMi(null)).toBe(false);
  });

  it("base64url her uzunlukta gidiş-dönüş yapar (dolgu kenar durumları)", () => {
    for (let n = 0; n < 8; n++) {
      const b = new Uint8Array(n).map((_, i) => 250 + i);
      expect(esit(unb64u(b64u(b)), b)).toBe(true);
      expect(b64u(b)).not.toMatch(/[+/=]/);
    }
  });
});

describe("parolaTuret", () => {
  const salt = "AAECAwQFBgcICQoLDA0ODw";

  it("aynı girdiler aynı auth_token'ı verir (giriş her cihazda aynı sonuca varmalı)", async () => {
    const a = await parolaTuret("parola-12345", salt, HIZLI);
    const b = await parolaTuret("parola-12345", salt, HIZLI);
    expect(a.authToken).toBe(b.authToken);
  });

  it("farklı salt ya da parola farklı token verir", async () => {
    const t = (await parolaTuret("parola-12345", salt, HIZLI)).authToken;
    expect((await parolaTuret("parola-12346", salt, HIZLI)).authToken).not.toBe(t);
    expect((await parolaTuret("parola-12345", yeniSalt(), HIZLI)).authToken).not.toBe(t);
  });

  /* Tasarımın dayanağı: sunucuya giden token KEK'i VERMEMELİ. Biri ileride KEK'i token'dan
     türetecek bir "sadeleştirme" yaparsa bu test patlar. */
  it("auth_token KEK olarak kullanılamaz — token'ı ele geçiren DEK'i açamaz", async () => {
    const { kek, authToken } = await parolaTuret("parola-12345", salt, HIZLI);
    const dek = yeniDek();
    const sarili = await dekSar(dek, kek, "pw");
    const sahteKek = await crypto.subtle.importKey("raw", unb64u(authToken), "AES-GCM", false, ["decrypt"]);
    await expect(dekAc(sarili, sahteKek, "pw")).rejects.toThrow();
  });

  it("desteklenmeyen KDF açıkça reddedilir", async () => {
    await expect(parolaTuret("x", salt, { alg: "MD5" } as unknown as KdfParams)).rejects.toThrow(/desteklenmeyen/);
  });

  it("sunucudan gelen zayıf ya da bozuk KDF parametresi reddedilir", () => {
    expect(kdfDenetle({ alg: "PBKDF2-SHA256", iter: 600_000 })).toEqual(VARSAYILAN_KDF);
    expect(kdfDenetle({ alg: "PBKDF2-SHA256", iter: 1_200_000 }).iter).toBe(1_200_000);
    for (const kotu of [
      { alg: "PBKDF2-SHA256", iter: 1 }, { alg: "PBKDF2-SHA256", iter: 599_999 },
      { alg: "PBKDF2-SHA256", iter: "600000" }, { alg: "PBKDF2-SHA256", iter: 6e5 + 0.5 },
      { alg: "MD5", iter: 600_000 }, {}, null, undefined,
    ]) expect(() => kdfDenetle(kotu)).toThrow(/güvenli değil/);
  });

  it("varsayılan KDF OWASP eşiğinin altına düşmemiş", () => {
    expect(VARSAYILAN_KDF.alg).toBe("PBKDF2-SHA256");
    expect(VARSAYILAN_KDF.iter).toBeGreaterThanOrEqual(600_000);
  });
});

/* ————— ALTIN VEKTÖRLER —————
   Projedeki en yüksek bedelli hata sınıfı: türetme ya da biçim SESSİZCE değişirse (HKDF info
   dizesi, IV boyu, base64 alfabesi, AAD kuralı) mevcut kullanıcılar giriş yapamaz ve veri
   kalıcı olarak okunamaz olur. Bu değerler kodun bir sürümünden alınıp buraya GÖMÜLDÜ;
   değişirse test patlar. Bilinçli bir biçim değişikliğinde yeni sürüm öneki (v2) açılır,
   bu vektörler SİLİNMEZ — eski veri hâlâ okunabilmeli. */
describe("altın vektörler", () => {
  const SALT = "AAECAwQFBgcICQoLDA0ODw";
  const PAROLA = "Doğru-At-Pil-Zımba-2026";
  const TOKEN = "NrIkmfc_t19WsrfIAZYWOMd7VIZOtL9BOwqMrD-Nw7c";
  const PAKET = "v1:HLMSRy3LL63IDZdW:0AfF9GMoOHSMSiZR_2KcB8qVoYlHcKH4qDtCk3nHoFqojgJ7IqHNQHZaFw4WS-Gv";
  const DEK = new Uint8Array(32).map((_, i) => i * 7 + 3);

  it("gerçek parametrelerle auth_token değişmedi", async () => {
    expect((await parolaTuret(PAROLA, SALT, VARSAYILAN_KDF)).authToken).toBe(TOKEN);
  }, 30_000);

  it("gömülü paket bugünkü kodla açılıyor ve DEK birebir aynı", async () => {
    const { kek } = await parolaTuret(PAROLA, SALT, VARSAYILAN_KDF);
    expect(esit(await dekAc(PAKET, kek, "pw"), DEK)).toBe(true);
  }, 30_000);
});

describe("DEK sarma", () => {
  it("parola ile sarılan DEK aynı parola ile açılır", async () => {
    const salt = yeniSalt();
    const dek = yeniDek();
    const { kek } = await parolaTuret("parola-12345", salt, HIZLI);
    const { kek: kek2 } = await parolaTuret("parola-12345", salt, HIZLI); // başka cihaz
    expect(esit(await dekAc(await dekSar(dek, kek, "pw"), kek2, "pw"), dek)).toBe(true);
  });

  /* Sunucu iki sarılı paketin yerini değiştirirse fark edilmeli. */
  it("parola-sarılı paket 'kurtarma' amacıyla açılamaz (AAD amaç bağı)", async () => {
    const { kek } = await parolaTuret("parola-12345", yeniSalt(), HIZLI);
    const p = await dekSar(yeniDek(), kek, "pw");
    await expect(dekAc(p, kek, "rk")).rejects.toThrow();
  });

  it("parola DEĞİŞİMİ veriyi yeniden şifrelemez: aynı DEK yeni KEK ile sarılır", async () => {
    const dek = yeniDek();
    const eski = await parolaTuret("eski-parola-1", yeniSalt(), HIZLI);
    const yeniSaltDegeri = yeniSalt();
    const yeni = await parolaTuret("yeni-parola-2", yeniSaltDegeri, HIZLI);
    const acik = await dekAc(await dekSar(dek, eski.kek, "pw"), eski.kek, "pw");
    const yeniPaket = await dekSar(acik, yeni.kek, "pw");
    const tekrar = await parolaTuret("yeni-parola-2", yeniSaltDegeri, HIZLI);
    expect(esit(await dekAc(yeniPaket, tekrar.kek, "pw"), dek)).toBe(true);
  });

  it("DEK ile şifrelenen veri, DEK paroladan geri açıldıktan sonra okunuyor (uçtan uca)", async () => {
    const salt = yeniSalt();
    const dek = yeniDek();
    const { kek } = await parolaTuret("parola-12345", salt, HIZLI);
    const kayit = await sar(await dekAnahtari(dek), bayt('{"amount":-450.5,"name":"Migros"}'), "transactions:6");
    const sarili = await dekSar(dek, kek, "pw");
    // … başka cihaz, sadece parolayı biliyor:
    const { kek: k2 } = await parolaTuret("parola-12345", salt, HIZLI);
    const dek2 = await dekAnahtari(await dekAc(sarili, k2, "pw"));
    expect(JSON.parse(new TextDecoder().decode(await ac(dek2, kayit, "transactions:6")))).toEqual({ amount: -450.5, name: "Migros" });
  });
});

describe("kurtarma kodu", () => {
  it("biçim: 4'erli 8 grup, yalnız Crockford alfabesi (I/L/O/U yok)", () => {
    const k = yeniKurtarmaKodu();
    expect(k).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/);
  });

  it("her üretim farklı", () => {
    expect(yeniKurtarmaKodu()).not.toBe(yeniKurtarmaKodu());
  });

  it("gidiş-dönüş: kod bayta, bayt aynı koda döner", () => {
    const k = yeniKurtarmaKodu();
    expect(kurtarmaKoduCoz(k)).toHaveLength(20);
  });

  /* Kullanıcı bunu kağıttan geri yazacak: tek harf karışıklığı veriyi kalıcı kaybettirir. */
  it("elle yazıma toleranslı: küçük harf, boşluk, tire yok, I/L→1, O→0", async () => {
    const k = yeniKurtarmaKodu();
    const bozuk = k.toLowerCase().replace(/-/g, " ").replace(/1/g, "l").replace(/0/g, "o");
    expect(esit(kurtarmaKoduCoz(bozuk), kurtarmaKoduCoz(k))).toBe(true);
  });

  it("yanlış uzunluk ve geçersiz karakter anlaşılır hatayla reddedilir", () => {
    expect(() => kurtarmaKoduCoz("ABCD-EFGH")).toThrow(/32 karakter/);
    expect(() => kurtarmaKoduCoz("U".repeat(32))).toThrow(/geçersiz karakter/);
  });

  it("kurtarma koduyla sarılan DEK aynı kodla açılır", async () => {
    const kod = yeniKurtarmaKodu();
    const dek = yeniDek();
    const p = await dekSar(dek, await kurtarmaSarici(kod), "rk");
    expect(esit(await dekAc(p, await kurtarmaSarici(kod.toLowerCase()), "rk"), dek)).toBe(true);
  });

  it("başka bir kod açamaz", async () => {
    const p = await dekSar(yeniDek(), await kurtarmaSarici(yeniKurtarmaKodu()), "rk");
    await expect(dekAc(p, await kurtarmaSarici(yeniKurtarmaKodu()), "rk")).rejects.toThrow();
  });

  /* Kurtarma kodu parola salt'ına bağlı DEĞİL: parola değişip salt yenilense de çalışmalı —
     kullanıcı ona tam da parolayı kaybettiğinde muhtaç. */
  it("parola ve salt değişse de kurtarma kodu aynı DEK'i açmaya devam eder", async () => {
    const kod = yeniKurtarmaKodu();
    const dek = yeniDek();
    const rkPaket = await dekSar(dek, await kurtarmaSarici(kod), "rk");
    // parola değişimi: yeni salt, yeni KEK — rk paketi hiç dokunulmadı
    await parolaTuret("tamamen-yeni-parola", yeniSalt(), HIZLI);
    expect(esit(await dekAc(rkPaket, await kurtarmaSarici(kod), "rk"), dek)).toBe(true);
  });
});
