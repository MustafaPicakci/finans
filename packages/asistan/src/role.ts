/* ============================================================================
   Röle girdisinin doğrulanması (sunucu, POST /api/ai/relay)
   ----------------------------------------------------------------------------
   E2EE'den beri bağlam ve sohbet geçmişi İSTEMCİDEN gelir — sunucu veriyi ve şifreli
   geçmişi okuyamaz, yani doğrulayamaz da. Eskiden bağlamı veritabanından sunucu kuruyordu;
   şimdi röle, gelen nesneyi olduğu gibi sistem promptuna yazsaydı giriş yapmış herkes
   API anahtarımızla promptun içine istediği metni koyabilir, sahte bir geçmişle kapsam
   kuralını kolayca aşıp asistanı genel amaçlı bir sohbet botuna çevirebilirdi.

   Tam çözüm yok (sahte ama "biçimce doğru" bir geçmiş hâlâ gönderilebilir — gerçeğini
   görmeden ayırt edilemez). Buradaki iş kötüye kullanımın ALANINI daraltmak:
   - bağlam yeniden KURULUR: yalnız bilinen alanlar, bilinen tiplerde, kırpılmış metinle;
     fazladan alan düşer, tip uymayan alan isteği reddettirir;
   - mesajlar biçim + boyut + araç adı açısından denetlenir.
   Maliyeti sınırlayan asıl önlem kullanıcı başına günlük tavandır (sunucuda). */

import type { UserContext } from "./context.js";

/** Bağlamdaki tek bir metnin tavanı. Adlar kısa; uzun metin yalnız prompt enjeksiyonuna yarar. */
export const BAGLAM_METIN_TAVAN = 100;
/** Bağlamdaki bir listenin tavanı (hesap, kart, kategori…). Gerçek kullanıcı çok altında kalır. */
export const BAGLAM_LISTE_TAVAN = 500;
/** Rol başına tek mesaj tavanları (karakter). Asistan yanıtı ~8.000, araç sonucu en uzun olanıdır
    (kayit_ara ≤50 satır, harcama_ozeti kırılımı). */
export const MESAJ_TAVAN = { user: 8_000, assistant: 12_000, tool: 40_000 } as const;
/** Bütün geçmişin (JSON) tavanı — gövde sınırı 256 KB, bunun altında kalır. */
export const GECMIS_TAVAN = 200_000;

const TARIH = /^\d{4}-\d{2}-\d{2}$/;

/** Denetim hatası — mesajı istemciye 400 ile döner. */
export class RoleHatasi extends Error {}

/** Metni tek satıra indirir ve kırpar: satır sonlarıyla promptun içinde yeni bir "bölüm" açılmasın. */
const metin = (v: unknown, tavan = BAGLAM_METIN_TAVAN): string =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, tavan) : "";

const tamsayi = (v: unknown, alan: string): number => {
  if (typeof v !== "number" || !Number.isInteger(v)) throw new RoleHatasi(`bağlam: ${alan} tamsayı olmalı`);
  return v;
};
const sayiYaDaNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function liste<T>(v: unknown, alan: string, kur: (x: Record<string, unknown>) => T): T[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new RoleHatasi(`bağlam: ${alan} liste olmalı`);
  if (v.length > BAGLAM_LISTE_TAVAN) throw new RoleHatasi(`bağlam: ${alan} çok uzun`);
  return v.map((x) => {
    if (!x || typeof x !== "object") throw new RoleHatasi(`bağlam: ${alan} öğesi nesne olmalı`);
    return kur(x as Record<string, unknown>);
  });
}

/** İstemcinin gönderdiği bağlamı sıfırdan yeniden kurar. Bilinmeyen alanlar düşer. */
export function baglamKur(ham: unknown): UserContext {
  if (!ham || typeof ham !== "object" || Array.isArray(ham)) throw new RoleHatasi("bağlam nesne olmalı");
  const b = ham as Record<string, unknown>;
  if (typeof b.bugun !== "string" || !TARIH.test(b.bugun)) throw new RoleHatasi("bağlam: bugun 'YYYY-MM-DD' olmalı");
  return {
    bugun: b.bugun,
    hesaplar: liste(b.hesaplar, "hesaplar", (x) => ({
      id: tamsayi(x.id, "hesap id"), ad: metin(x.ad), tur: metin(x.tur, 20), bakiye: sayiYaDaNull(x.bakiye) ?? 0,
    })),
    kartlar: liste(b.kartlar, "kartlar", (x) => ({
      id: tamsayi(x.id, "kart id"), ad: metin(x.ad),
      kesim_gunu: tamsayi(x.kesim_gunu, "kesim_gunu"), son_odeme_gunu: tamsayi(x.son_odeme_gunu, "son_odeme_gunu"),
    })),
    kategoriler: liste(b.kategoriler, "kategoriler", (x) => ({ id: tamsayi(x.id, "kategori id"), ad: metin(x.ad), tur: metin(x.tur, 20) })),
    portfoy_gruplari: liste(b.portfoy_gruplari, "portfoy_gruplari", (x) => ({ id: tamsayi(x.id, "grup id"), ad: metin(x.ad) })),
    duzenli_kalemler: liste(b.duzenli_kalemler, "duzenli_kalemler", (x) => ({
      id: tamsayi(x.id, "kalem id"), ad: metin(x.ad), tur: metin(x.tur, 20), gun: tamsayi(x.gun, "gun"),
    })),
    portfoydeki_semboller: liste(b.portfoydeki_semboller, "portfoydeki_semboller", (x) => ({
      sembol: metin(x.sembol, 20), tur: metin(x.tur, 20), para_birimi: metin(x.para_birimi, 5), guncel_fiyat: sayiYaDaNull(x.guncel_fiyat),
    })),
    usd_try: sayiYaDaNull(b.usd_try),
    nakit_sayilan_fonlar: b.nakit_sayilan_fonlar === undefined ? [] : (() => {
      if (!Array.isArray(b.nakit_sayilan_fonlar) || b.nakit_sayilan_fonlar.length > BAGLAM_LISTE_TAVAN) throw new RoleHatasi("bağlam: nakit_sayilan_fonlar geçersiz");
      return b.nakit_sayilan_fonlar.map((s) => metin(s, 20)).filter(Boolean);
    })(),
  };
}

/** Geçmişi denetler: roller, tipler, boyutlar, araç adları. Geçerliyse aynı diziyi döndürür. */
export function gecmisDenetle(ham: unknown, araclar: ReadonlySet<string>, turTavani: number): unknown[] {
  if (!Array.isArray(ham) || !ham.length) throw new RoleHatasi("geçersiz istek");
  if (ham.length > turTavani) throw new RoleHatasi("konuşma çok uzun");
  if (JSON.stringify(ham).length > GECMIS_TAVAN) throw new RoleHatasi("konuşma çok büyük");
  for (const m of ham as any[]) {
    if (m?.role === "user") {
      if (typeof m.content !== "string" || m.content.length > MESAJ_TAVAN.user) throw new RoleHatasi("geçersiz kullanıcı mesajı");
    } else if (m?.role === "assistant") {
      if (typeof m.content !== "string" || m.content.length > MESAJ_TAVAN.assistant) throw new RoleHatasi("geçersiz asistan mesajı");
      if (m.toolCalls !== undefined) {
        if (!Array.isArray(m.toolCalls)) throw new RoleHatasi("geçersiz araç çağrısı");
        for (const t of m.toolCalls) if (!araclar.has(t?.name)) throw new RoleHatasi("bilinmeyen araç");
      }
    } else if (m?.role === "tool") {
      if (typeof m.callId !== "string" || !araclar.has(m.name)) throw new RoleHatasi("geçersiz araç sonucu");
      if (JSON.stringify(m.result ?? null).length > MESAJ_TAVAN.tool) throw new RoleHatasi("araç sonucu çok büyük");
    } else {
      throw new RoleHatasi("geçersiz mesaj biçimi");
    }
  }
  /* Model her zaman kullanıcıya ya da bir araç sonucuna CEVAP verir; asistanla biten bir
     geçmiş gerçek döngüde oluşmaz — yalnız elle kurulmuş bir istekte görülür. */
  const son = (ham as any[])[ham.length - 1];
  if (son.role !== "user" && son.role !== "tool") throw new RoleHatasi("geçersiz mesaj sırası");
  return ham;
}
