import nodemailer from "nodemailer";

/* Faz 6 — e-posta gönderimi. Generic SMTP (env'den): şimdi Gmail SMTP ile başla, ileride
   domain alıp Resend/Brevo/kendi SMTP'ne geçmek için SADECE env değişir, kod değişmez.
   Gmail için: SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_USER=<gmail>, SMTP_PASS=<uygulama parolası>.
   SMTP yapılandırılmamışsa (dev) e-posta gönderilmez; içerik/bağlantı konsola loglanır. */
const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT || 587);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const from = process.env.MAIL_FROM || (user ? `Finans <${user}>` : "Finans <no-reply@finans.local>");

export const mailConfigured = !!(host && user && pass);
/* Zaman aşımları şart: yanıtsız/karadelik bir SMTP sunucusunda bağlantı SONSUZA dek asılı kalır —
   gönderim promise'i ne çözülür ne reddedilir, yani hata da loglanmaz. Sessiz asılma, açık hatadan
   beterdir (açılış doğrulaması "her şey yolunda" sanısı verir). Test edilerek eklendi. */
const transporter = mailConfigured
  ? nodemailer.createTransport({
    host, port, secure: port === 465, auth: { user: user!, pass: pass! },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  })
  : null;

/** From başlığındaki alan adı — teslim uyarıları ve MAIL_FROM kontrolü için */
const fromDomain = /<([^>]+)>/.exec(from)?.[1].split("@")[1] ?? from.split("@")[1] ?? "";

/* Son gönderim hatası — açılışta/sonrasında sessiz kalmasın diye tutulur. Gönderim bilinçli olarak
   BLOKLAMAZ (kayıt akışı e-postayı beklemez), ama hata görünmez de kalmamalı: sunucu sahibi
   "kimse aktivasyon alamıyor" durumunu logdan tek satırda görebilmeli. */
export let lastMailError: { at: string; to: string; message: string } | null = null;

/** Açılışta kimlik bilgilerini doğrular — bozuk SMTP ayarı ilk kayıtta değil, ilk saniyede belli olsun.
    Bloklamaz; yalnız loglar. */
export async function verifyMailConfig(): Promise<boolean> {
  if (!transporter) return false;
  try {
    await transporter.verify();
    console.log(`[mail] SMTP doğrulandı: ${host}:${port} · gönderen ${from}`);
    return true;
  } catch (e) {
    console.error(`[mail] UYARI: SMTP bağlantısı/kimlik doğrulaması BAŞARISIZ (${host}:${port}) — e-postalar gitmeyecek:`, e instanceof Error ? e.message : e);
    return false;
  }
}

/** MAIL_FROM doğrulanmış domain'de değilse teslim zayıf kalır (SPF/DKIM eşleşmez). Tipik tuzak:
    Resend'de SMTP_USER "resend" olduğundan MAIL_FROM verilmezse From "Finans <resend>" olur. */
export function mailFromWarning(): string | null {
  if (!mailConfigured) return null;
  if (!fromDomain || !fromDomain.includes("."))
    return `MAIL_FROM geçerli bir adres değil (${from}) — doğrulanmış domain'inden ver, ör. MAIL_FROM="Finans <no-reply@ornek.com>"`;
  if (host?.includes("gmail"))
    return `Gmail SMTP kullanılıyor (${from}) — aktivasyon postaları kurumsal alan adlarına phishing sayılıp düşebilir; prod için transactional sağlayıcı + kendi domain'in şart.`;
  return null;
}

/** `text` HTML'in düz metin karşılığıdır — yalnız-HTML gönderim yaygın bir spam sinyalidir,
    multipart/alternative teslim oranını belirgin iyileştirir (ve metin istemcilerinde okunur kalır). */
export async function sendMail(to: string, subject: string, html: string, text?: string): Promise<void> {
  const plain = text ?? html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!transporter) {
    console.log(`[mail] SMTP yapılandırılmadı — gönderilmedi. to=${to} | ${subject}\n[mail] ${plain}`);
    return;
  }
  try {
    await transporter.sendMail({ from, to, subject, html, text: plain });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    lastMailError = { at: new Date().toISOString(), to, message };
    console.error(`[mail] GÖNDERİLEMEDİ to=${to} konu="${subject}": ${message}`);
    throw e;
  }
}

/* ---- şablonlar (Türkçe, satır-içi stil; e-posta istemcileri harici CSS'i çoğunlukla atar) ---- */
function wrap(title: string, body: string, cta: { label: string; link: string }): string {
  return `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0D1322">
    <div style="font-size:18px;font-weight:700;margin-bottom:16px">₺ finans</div>
    <div style="font-size:16px;font-weight:600;margin-bottom:8px">${title}</div>
    <div style="font-size:14px;line-height:1.6;color:#3a4256;margin-bottom:20px">${body}</div>
    <a href="${cta.link}" style="display:inline-block;background:#0D1322;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-size:14px;font-weight:600">${cta.label}</a>
    <div style="font-size:12px;color:#8a92a6;margin-top:20px;line-height:1.5">Bu bağlantı çalışmıyorsa tarayıcına yapıştır:<br><span style="word-break:break-all">${cta.link}</span></div>
  </div>`;
}

/** Düz metin karşılığı — HTML'den türetmek yerine elle yazılır: bağlantı tek başına satırda durur,
    istemciler onu doğru linkler ve metin sürümü "gerçek" görünür (spam puanı düşer). */
const plainWrap = (title: string, body: string, link: string): string =>
  `${title}\n\n${body}\n\n${link}\n\n— finans`;

export type MailContent = { subject: string; html: string; text: string };

export function resetEmail(link: string): MailContent {
  const body = "Şifreni sıfırlamak için bu isteği sen yaptıysan aşağıdaki bağlantıya git. Bağlantı 1 saat geçerlidir. Sen istemediysen bu e-postayı yok say — şifren değişmez.";
  return {
    subject: "Finans — şifre sıfırlama",
    html: wrap("Şifreni sıfırla",
      "Şifreni sıfırlamak için bu isteği sen yaptıysan aşağıdaki butona tıkla. Bağlantı <b>1 saat</b> geçerlidir. Sen istemediysen bu e-postayı yok say — şifren değişmez.",
      { label: "Şifremi sıfırla", link }),
    text: plainWrap("Şifreni sıfırla", body, link),
  };
}

export function verifyEmail(link: string): MailContent {
  const body = "Kaydını tamamlamak için e-posta adresini doğrula. Bağlantı 24 saat geçerlidir.";
  return {
    subject: "Finans — hesabını aktive et",
    html: wrap("Hesabını aktive et",
      "Kaydını tamamlamak için e-posta adresini doğrula. Bağlantı <b>24 saat</b> geçerlidir.",
      { label: "Hesabımı aktive et", link }),
    text: plainWrap("Hesabını aktive et", body, link),
  };
}
