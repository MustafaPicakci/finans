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
const transporter = mailConfigured
  ? nodemailer.createTransport({ host, port, secure: port === 465, auth: { user: user!, pass: pass! } })
  : null;

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  if (!transporter) {
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    console.log(`[mail] SMTP yapılandırılmadı — gönderilmedi. to=${to} | ${subject}\n[mail] ${text}`);
    return;
  }
  await transporter.sendMail({ from, to, subject, html });
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

export function resetEmail(link: string): { subject: string; html: string } {
  return {
    subject: "Finans — şifre sıfırlama",
    html: wrap("Şifreni sıfırla",
      "Şifreni sıfırlamak için bu isteği sen yaptıysan aşağıdaki butona tıkla. Bağlantı <b>1 saat</b> geçerlidir. Sen istemediysen bu e-postayı yok say — şifren değişmez.",
      { label: "Şifremi sıfırla", link }),
  };
}

export function verifyEmail(link: string): { subject: string; html: string } {
  return {
    subject: "Finans — hesabını aktive et",
    html: wrap("Hesabını aktive et",
      "Kaydını tamamlamak için e-posta adresini doğrula. Bağlantı <b>24 saat</b> geçerlidir.",
      { label: "Hesabımı aktive et", link }),
  };
}
