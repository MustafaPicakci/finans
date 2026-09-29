import {
  parolaTuret, yeniSalt, yeniDek, dekSar, dekAc, dekAnahtari, yeniKurtarmaKodu, kurtarmaSarici,
  VARSAYILAN_KDF, kdfDenetle, type Bayt,
} from "@finans/crypto";
import { api, ApiError, type SessionUser } from "../../api";
import { anahtarKur } from "../../yazim/anahtar";

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
/** sessionStorage: girişte kullanılan parola bugünkü kurala uymuyordu (Hesabım bunu hatırlatır). */
export const ZAYIF_PAROLA_KEY = "finans-zayif-parola";
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
    DEK burada yalnız parolayla sarılır; kurtarma paketi ilk girişte, kod kullanıcıya
    GÖSTERİLEREK eklenir (`kurtarmaHazirla`) — kayıt ile ilk giriş aynı yoldan geçsin diye. */
export async function yeniMalzeme(parola: string) {
  const kdf_salt = yeniSalt();
  const { kek, authToken } = await parolaTuret(parola, kdf_salt, VARSAYILAN_KDF);
  const dekHam = yeniDek();
  const govde = {
    auth_token: authToken, kdf_salt, kdf_params: JSON.stringify(VARSAYILAN_KDF),
    dek_wrapped_pw: await dekSar(dekHam, kek, "pw"),
  };
  return { govde, kek, dekHam };
}

export type GirisSonucu = {
  user: SessionUser;
  /** Açılmış ham veri anahtarı — YALNIZ giriş akışı boyunca elde tutulur (kurtarma paketi
      sarmak için gerekir), sonra dışa aktarılamaz CryptoKey'e çevrilip bırakılır. */
  dekHam: Bayt;
  /** Hesabın kurtarma paketi yok → uygulama açılmadan önce kod gösterilip kaydedilmeli. */
  kurtarmaGerekli: boolean;
};

/** Tam giriş: önce salt, sonra hesap türüne göre legacy (+ aynı istekte yükseltme) ya da v2.
    Aşama 6'dan beri veri anahtarı AÇILAMAZSA giriş BAŞARISIZDIR: eskiden (aşama 3b "kanarya")
    yalnız uyarıydı çünkü hiçbir veri ona bağlı değildi; artık anahtarsız oturum veriyi ne
    okuyabilir ne yazabilir. */
export async function girisYap(email: string, parola: string): Promise<GirisSonucu> {
  const pre = await api.prelogin(email);
  let kek: CryptoKey, r: Awaited<ReturnType<typeof api.login>>;
  if (pre.kdf === "legacy") {
    /* Eski hesap: parolayı SON BİR KEZ sunucuya gönderiyor ve AYNI istekte v2'ye geçiyoruz.
       Yükseltme ayrı bir istek olsaydı çalınmış bir oturum ona kendi token'ını yazabilirdi. */
    const m = await yeniMalzeme(parola);
    kek = m.kek;
    r = await api.login(email, { password: parola, upgrade: m.govde });
  } else {
    const t = await parolaTuret(parola, pre.salt, kdfDenetle(pre.params));
    kek = t.kek;
    r = await api.login(email, { auth_token: t.authToken });
  }
  if (!r.dek_wrapped_pw) throw new ApiError(409, "Hesabın şifreleme anahtarı kurulamadı — tekrar giriş yapmayı dene");
  let dekHam: Bayt;
  try { dekHam = await dekAc(r.dek_wrapped_pw, kek, "pw"); }
  catch { throw new ApiError(409, "Veri anahtarın bu tarayıcıda açılamadı. Tarayıcın güncel mi? (Sorun sürerse başka bir tarayıcı dene.)"); }
  return { user: r.user, dekHam, kurtarmaGerekli: !r.kurtarma };
}

/** Anahtarı oturuma yerleştirir (bellek + cihaz). Kurtarma paketi gerekiyorsa ÖNCE o
    kaydedilmiş olmalı: anahtar cihaza yazıldığı an uygulama şifreli yazmaya başlar. */
export async function anahtariYerlestir(user: SessionUser, dekHam: Bayt): Promise<void> {
  await anahtarKur({ userId: user.id, dek: await dekAnahtari(dekHam) });
}

/** Yeni kurtarma kodu + onunla sarılmış DEK. Paket, kaydedilmeden ÖNCE aynı kodla açılıp
    ham anahtarla karşılaştırılır: kodun bir karakteri bile yanlış üretilmiş/biçimlenmiş
    olsaydı hata ŞİMDİ çıkar — kullanıcının koda muhtaç olduğu gün değil. */
export async function kurtarmaHazirla(dekHam: Bayt): Promise<{ kod: string; paket: string }> {
  const kod = yeniKurtarmaKodu();
  const paket = await dekSar(dekHam, await kurtarmaSarici(kod), "rk");
  const geri = await dekAc(paket, await kurtarmaSarici(kod), "rk");
  if (geri.length !== dekHam.length || geri.some((x, i) => x !== dekHam[i])) throw new Error("kurtarma paketi doğrulanamadı");
  return { kod, paket };
}

/** Kurtarma koduyla parola sıfırlama: ESKİ veri anahtarı koddan açılır, yeni parolayla
    yeniden sarılır — veri yerinde kalır. Kod yanlışsa sunucuya HİÇBİR ŞEY gitmez (paket
    tarayıcıda açılamaz), yani yanlış bir denemenin bağlantıyı yakması ya da hesabı bozması
    imkânsız. Yeni sarım da göndermeden önce yeni parolayla açılıp doğrulanır. */
export async function kurtarmaIleSifirla(token: string, kod: string, yeniParola: string, paket: string): Promise<void> {
  let dekHam: Bayt;
  try { dekHam = await dekAc(paket, await kurtarmaSarici(kod), "rk"); }
  catch (e) {
    const m = (e as Error).message;
    throw new ApiError(400, /kurtarma kodu/.test(m) ? m.charAt(0).toUpperCase() + m.slice(1) : "Kurtarma kodu bu hesaba ait değil ya da yanlış yazılmış");
  }
  const kdf_salt = yeniSalt();
  const { kek, authToken } = await parolaTuret(yeniParola, kdf_salt, VARSAYILAN_KDF);
  const dek_wrapped_pw = await dekSar(dekHam, kek, "pw");
  const geri = await dekAc(dek_wrapped_pw, kek, "pw");
  if (geri.some((x, i) => x !== dekHam[i])) throw new Error("yeni parola paketi doğrulanamadı");
  await api.reset(token, { auth_token: authToken, kdf_salt, kdf_params: JSON.stringify(VARSAYILAN_KDF), dek_wrapped_pw }, "kurtarma");
}

/** Parola değişimi: veri yeniden şifrelenmez, aynı DEK yeni parolanın KEK'iyle yeniden sarılır.
    Yeni paket göndermeden önce yeni parolayla açılıp doğrulanır — yanlış sarılmış bir paket
    bir sonraki girişte veriyi kilitlerdi. */
export async function parolaDegistir(email: string, eski: string, yeni: string): Promise<void> {
  const pre = await api.prelogin(email);
  if (pre.kdf !== "v2") throw new ApiError(409, "Önce çıkış yapıp yeniden giriş yap");
  const e = await parolaTuret(eski, pre.salt, kdfDenetle(pre.params));
  const { dek_wrapped_pw } = await api.parolaPaketi(e.authToken);
  if (!dek_wrapped_pw) throw new ApiError(409, "Hesabın şifreleme anahtarı bulunamadı");
  const dekHam = await dekAc(dek_wrapped_pw, e.kek, "pw");
  const kdf_salt = yeniSalt();
  const n = await parolaTuret(yeni, kdf_salt, VARSAYILAN_KDF);
  const paket = await dekSar(dekHam, n.kek, "pw");
  const geri = await dekAc(paket, n.kek, "pw");
  if (geri.some((x, i) => x !== dekHam[i])) throw new Error("yeni parola paketi doğrulanamadı");
  await api.parolaYaz({ eski_auth_token: e.authToken, auth_token: n.authToken, kdf_salt, kdf_params: JSON.stringify(VARSAYILAN_KDF), dek_wrapped_pw: paket });
}

/** Parola onayı isteyen işlemler (hesap silme) için hesap türüne uygun kanıt. */
export async function parolaKaniti(email: string, parola: string): Promise<{ password?: string; auth_token?: string }> {
  const pre = await api.prelogin(email);
  if (pre.kdf === "legacy") return { password: parola };
  return { auth_token: (await parolaTuret(parola, pre.salt, kdfDenetle(pre.params))).authToken };
}
