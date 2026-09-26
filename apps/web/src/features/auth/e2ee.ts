import { parolaTuret, yeniSalt, yeniDek, dekSar, dekAc, VARSAYILAN_KDF, type KdfParams } from "@finans/crypto";
import { api, type SessionUser } from "../../api";

/* ————— SIFIR BİLGİ GİRİŞİ — istemci tarafı (E2EE aşama 3b) —————
   Parola bu dosyadan DIŞARI ÇIKMAZ. Sunucuya giden yalnız paroladan türetilmiş `auth_token`;
   KEK (veri anahtarını saran anahtar) cihazda kalır. Gerekçe ve türetme zinciri:
   packages/crypto/src/keys.ts. Ekranlar (giriş/kayıt/sıfırlama/hesap silme) yalnız bu
   dosyayı çağırır — parolayla doğrudan fetch yapan ikinci bir yol olmamalı. */

/* Parola politikası YALNIZ burada uygulanabilir: sunucu parolayı hiç görmüyor (görseydi
   sıfır bilgi olmazdı). Sunucunun zorlayabildiği tek şey KDF maliyetidir (600k alt sınır).
   Sıfır bilgiden sonra sızan bir veritabanı sarılı anahtarı da sızdırır ve çevrimdışı
   deneme yapılabilir — yani parola gücü bu mimaride ÖNCEKİNDEN daha önemli. */
export const PAROLA_MIN = 12;
/* Uzunluk kuralı yaygın parolaların çoğunu zaten eler (sızıntı listelerinin büyük kısmı kısa);
   bu liste 12+ karakterde de sık görülen kalıpları yakalar. Tam bir sözlük değil, bilinçli. */
const YAYGIN = [
  "123456789012", "1234567890123", "qwertyuiopas", "qwertyuiop12", "password1234", "passwordpassword",
  "sifre1234567", "sifresifre12", "parola123456", "parolaparola", "asdfghjklasd", "111111111111",
  "000000000000", "abcdefghijkl", "iloveyou1234", "galatasaray1905", "fenerbahce1907", "besiktas1903",
];

/** Yeni parola için sorun varsa açıklaması, yoksa null. */
export function parolaSorunu(parola: string, email: string): string | null {
  if (parola.length < PAROLA_MIN) return `Parola en az ${PAROLA_MIN} karakter olmalı`;
  const kucuk = parola.toLocaleLowerCase("tr");
  if (/^(.)\1+$/.test(parola)) return "Parola tek bir karakterin tekrarı olamaz";
  if (YAYGIN.some((y) => kucuk.includes(y))) return "Bu parola çok yaygın — tahmin edilmesi kolay";
  const yerel = email.split("@")[0]?.toLocaleLowerCase("tr");
  if (yerel && yerel.length >= 4 && kucuk.includes(yerel)) return "Parola e-posta adresini içermemeli";
  return null;
}

/** Kayıt / sıfırlama / yükseltme için sunucuya gidecek malzeme. Yeni salt + yeni DEK.
    DEK yalnız parolayla sarılır; kurtarma paketi aşama 6'da (şifreleme başlarken) eklenir. */
export async function yeniMalzeme(parola: string) {
  const kdf_salt = yeniSalt();
  const { kek, authToken } = await parolaTuret(parola, kdf_salt, VARSAYILAN_KDF);
  return {
    auth_token: authToken, kdf_salt, kdf_params: JSON.stringify(VARSAYILAN_KDF),
    dek_wrapped_pw: await dekSar(yeniDek(), kek, "pw"),
  };
}

/** KANARYA: sunucudaki sarılı DEK bu tarayıcıda paroladan türeyen KEK ile açılabiliyor mu?
    Aşama 3b'de HİÇBİR VERİ bu anahtara bağlı değil — yani bu, gerçek tarayıcıların
    (Safari, Chrome Android…) WebCrypto'sunu gerçek sunucu verisine karşı, bedelsiz bir anda
    sınamak. Başarısızlık girişi ENGELLEMEZ (engellemek için sebep yok), yalnız görünür kılınır:
    aşama 6'daki göç bu anahtarı açamazsa başlamayı reddedecek. */
async function kanarya(sarili: string | null, kek: CryptoKey): Promise<void> {
  if (!sarili) return;
  try { await dekAc(sarili, kek, "pw"); }
  catch (e) { console.warn("[e2ee] kanarya: sarılı veri anahtarı bu tarayıcıda açılamadı", e); }
}

/** Tam giriş: önce salt, sonra hesap türüne göre legacy (+ aynı istekte yükseltme) ya da v2. */
export async function girisYap(email: string, parola: string): Promise<SessionUser> {
  const pre = await api.prelogin(email);
  if (pre.kdf === "legacy") {
    /* Eski hesap: parolayı SON BİR KEZ sunucuya gönderiyor ve AYNI istekte v2'ye geçiyoruz.
       Yükseltme ayrı bir istek olsaydı çalınmış bir oturum ona kendi token'ını yazabilirdi. */
    const upgrade = await yeniMalzeme(parola);
    const r = await api.login(email, { password: parola, upgrade });
    return r.user;
  }
  const { kek, authToken } = await parolaTuret(parola, pre.salt, pre.params as KdfParams);
  const r = await api.login(email, { auth_token: authToken });
  await kanarya(r.dek_wrapped_pw, kek);
  return r.user;
}

/** Parola onayı isteyen işlemler (hesap silme) için hesap türüne uygun kanıt. */
export async function parolaKaniti(email: string, parola: string): Promise<{ password?: string; auth_token?: string }> {
  const pre = await api.prelogin(email);
  if (pre.kdf === "legacy") return { password: parola };
  return { auth_token: (await parolaTuret(parola, pre.salt, pre.params as KdfParams)).authToken };
}
