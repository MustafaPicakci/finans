import nodemailer from "nodemailer";

/* Faz 6 — e-posta gönderimi (şifre sıfırlama & hesap aktivasyonu).
   Seçilen yol yapılandırılmamışsa (dev) e-posta gönderilmez; içerik/bağlantı konsola loglanır. */
/* ————— Gönderim yolu seçimi (Faz 28) —————
   Üç yol var ve seçim AÇIKTIR: `MAIL_PROVIDER` = smtp (varsayılan) | gmail | resend.
   ai/provider.ts'teki `AI_PROVIDER` deseninin aynısı — sağlayıcı değiştirmek kod değil env işidir.
   Örtük seçim (ör. "anahtar doluysa o yola geç") bilinçli olarak KULLANILMADI: hangi yolun aktif
   olduğu env'e bakınca görünmeli, yoksa yanlış yolda hata aranır.

   NEDEN birden çok yol: PaaS'lerin çoğu giden SMTP'yi kapatıyor. Render, ÜCRETSİZ web
   servislerinde 25/465/587'yi Eylül 2025'ten beri engelliyor (port 25 tüm planlarda kapalı,
   EC2 üzerinde çalıştıkları için). Sonuç: hangi SMTP sağlayıcısı/parolası girilirse girilsin
   bağlantı kurulamaz — ayar hatası gibi görünen bir PLATFORM kısıtı. HTTP yolları 443'ü
   kullandığından bu engelin dışındadır. */
export type MailProvider = "smtp" | "gmail" | "resend";
const PROVIDERS: MailProvider[] = ["smtp", "gmail", "resend"];
const rawProvider = (process.env.MAIL_PROVIDER || "smtp").trim().toLowerCase();
if (!PROVIDERS.includes(rawProvider as MailProvider))
  console.error(`[mail] UYARI: MAIL_PROVIDER="${rawProvider}" tanınmıyor (${PROVIDERS.join("|")}) — smtp'ye düşülüyor.`);
export const mailProvider: MailProvider =
  PROVIDERS.includes(rawProvider as MailProvider) ? rawProvider as MailProvider : "smtp";

const useSmtp = mailProvider === "smtp";
const useGmail = mailProvider === "gmail";
const useHttp = mailProvider === "resend";

/* ---- YOL: smtp ---- */
const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT || 587);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;

/* ---- YOL: resend ----
   Doğrulanmış domain yoksa Resend'in paylaşımlı test göndereni kullanılabilir; o adres YALNIZ
   Resend hesabının kendi e-postasına gönderebilir (şifre sıfırlama için yeter, başkasını
   aktive etmeye yetmez). Domain doğrulanınca tek yapılacak MAIL_FROM'u değiştirmek. */
const resendKey = process.env.RESEND_API_KEY;
const RESEND_TEST_FROM = "Finans <onboarding@resend.dev>";

/* ---- YOL: gmail ----
   Postayı Google'ın KENDİ sunucusundan çıkarır: From @gmail.com olur, DKIM/SPF hizalanır, yani
   Resend'in test göndereninin aksine HERKESE ulaşır. SMTP'den tek farkı taşımadır (443, engelli
   587 değil) — teslim edilebilirlik Gmail SMTP ile aynıdır, çünkü aynı MTA aynı imzayı atar.
   Yetki `gmail.send` ile sınırlıdır: uygulama parolasının aksine posta kutusunu OKUYAMAZ. */
const gmailClientId = process.env.GMAIL_CLIENT_ID;
const gmailClientSecret = process.env.GMAIL_CLIENT_SECRET;
const gmailRefreshToken = process.env.GMAIL_REFRESH_TOKEN;
const gmailSender = process.env.GMAIL_SENDER;

/* Gmail gönderirken From, yetkilendirilmiş hesabın adresi OLMAK ZORUNDA — Google başka bir adresi
   (alias olarak tanımlanmadıysa) sessizce kendi adresiyle değiştirir. Bu yüzden gmail yolunda
   varsayılan GMAIL_SENDER'dır, MAIL_FROM değil. */
const from = (useGmail && !process.env.MAIL_FROM && gmailSender)
  ? `Finans <${gmailSender}>`
  : process.env.MAIL_FROM
  || (useHttp ? RESEND_TEST_FROM : user ? `Finans <${user}>` : "Finans <no-reply@finans.local>");

export const mailConfigured =
  useGmail ? !!(gmailClientId && gmailClientSecret && gmailRefreshToken)
  : useHttp ? !!resendKey
  : !!(host && user && pass);
/* Zaman aşımları şart: yanıtsız/karadelik bir SMTP sunucusunda bağlantı SONSUZA dek asılı kalır —
   gönderim promise'i ne çözülür ne reddedilir, yani hata da loglanmaz. Sessiz asılma, açık hatadan
   beterdir (açılış doğrulaması "her şey yolunda" sanısı verir). Test edilerek eklendi. */
const transporter = useSmtp && host && user && pass
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
  if (!mailConfigured) {
    /* Seçilen yolun env'i eksikse bunu açılışta söyle — aksi hâlde ilk kayıtta "mail gelmedi"
       diye fark edilir ve suç yanlış yerde aranır. */
    const need = useGmail ? "GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN"
      : useHttp ? "RESEND_API_KEY" : "SMTP_HOST/SMTP_USER/SMTP_PASS";
    console.error(`[mail] UYARI: MAIL_PROVIDER=${mailProvider} seçili ama ${need} eksik — e-postalar GÖNDERİLMEYECEK, yalnız loga yazılacak.`);
    return false;
  }
  if (useGmail) {
    /* Resend'in aksine bu yol GERÇEKTEN doğrulanabilir: refresh token'ı şimdi bozdurmayı dene.
       Ölü bir jetonu ilk kayıtta değil, ilk saniyede öğren — 7 günlük "Testing" tuzağı tam olarak
       böyle sessizce vuruyor. Yan fayda: jeton önbelleğe girer, ilk gönderim hızlanır. */
    try {
      await gmailAccessToken();
      console.log(`[mail] Gmail API doğrulandı · gönderen ${from}`);
      return true;
    } catch (e) {
      console.error(`[mail] UYARI: Gmail API kimlik doğrulaması BAŞARISIZ — e-postalar gitmeyecek: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }
  if (useHttp) {
    /* HTTP yolunda "bağlantı doğrulama" diye bir adım yok; anahtarın geçerliliği ilk gönderimde
       belli olur. Yine de yapılandırmayı loglamak açılışta hangi yolun aktif olduğunu görünür
       kılar — SMTP'den geçildiği fark edilmezse hata yanlış yerde aranır. */
    console.log(`[mail] HTTP API (Resend) kullanılıyor · gönderen ${from}`);
    return true;
  }
  if (!transporter) return false;
  try {
    await transporter.verify();
    console.log(`[mail] SMTP doğrulandı: ${host}:${port} · gönderen ${from}`);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[mail] UYARI: SMTP bağlantısı/kimlik doğrulaması BAŞARISIZ (${host}:${port}) — e-postalar gitmeyecek: ${msg}`);
    /* Bağlantı hatasının en olası sebebi yanlış parola değil, platformun portu kapatmasıdır;
       kullanıcı saatlerce kimlik bilgisi denemesin diye bunu açıkça söyle. */
    if (/ETIMEDOUT|ECONNREFUSED|ESOCKET|ENETUNREACH|timeout/i.test(msg)) {
      console.error("[mail] İPUCU: Bu bir BAĞLANTI hatası, kimlik hatası değil. Render ücretsiz web servisleri giden SMTP portlarını (25/465/587) engeller — parolayı değiştirmek çözmez. MAIL_PROVIDER=gmail (Gmail API) ya da MAIL_PROVIDER=resend ile 443 üzerinden gönderime geç, veya ücretli plana yüksel.");
    }
    return false;
  }
}

/** MAIL_FROM doğrulanmış domain'de değilse teslim zayıf kalır (SPF/DKIM eşleşmez). Tipik tuzak:
    Resend'de SMTP_USER "resend" olduğundan MAIL_FROM verilmezse From "Finans <resend>" olur. */
export function mailFromWarning(): string | null {
  if (!mailConfigured) return null;
  if (useGmail) {
    /* Gmail yolunda From, yetkilendirilmiş hesap OLMAK ZORUNDA; uyuşmazsa Google sessizce
       kendi adresiyle değiştirir ve MAIL_FROM'un hiçbir etkisi olmaz — "ayarladım ama değişmedi"
       tuzağı. Uyuşuyorsa da freemail göndereninin bedelini hatırlat. */
    if (gmailSender && !from.includes(gmailSender))
      return `MAIL_FROM (${from}) yetkilendirilmiş Gmail hesabıyla (${gmailSender}) uyuşmuyor — Google From'u sessizce kendi adresiyle değiştirir. MAIL_FROM'u kaldır ya da alias olarak tanımla.`;
    return `Şahsi Gmail adresinden gönderiliyor (${from}) — adresin kaydolan herkese görünür, günlük sınır 500 alıcıdır ve aktivasyon postaları bazı kurumsal alan adlarında spam'e düşebilir. Kalıcı çözüm: kendi domain'ini doğrulayıp MAIL_PROVIDER=resend'e geçmek.`;
  }
  if (!fromDomain || !fromDomain.includes("."))
    return `MAIL_FROM geçerli bir adres değil (${from}) — doğrulanmış domain'inden ver, ör. MAIL_FROM="Finans <no-reply@ornek.com>"`;
  /* Test göndereni sessizce "çalışıyor" sanılmasın: kendi adresine gider, başkasına GİTMEZ —
     yani tek kullanıcı için yeterli ama yeni kullanıcı aktive edilemez. */
  if (from === RESEND_TEST_FROM)
    return `Resend test göndereni (${from}) kullanılıyor — postalar YALNIZ Resend hesabının kendi e-postasına ulaşır. Başka kullanıcıların aktivasyonu için domain doğrulayıp MAIL_FROM'u kendi adresinle değiştir.`;
  if (host?.includes("gmail"))
    return `Gmail SMTP kullanılıyor (${from}) — aktivasyon postaları kurumsal alan adlarına phishing sayılıp düşebilir; prod için transactional sağlayıcı + kendi domain'in şart.`;
  return null;
}

/** `text` HTML'in düz metin karşılığıdır — yalnız-HTML gönderim yaygın bir spam sinyalidir,
    multipart/alternative teslim oranını belirgin iyileştirir (ve metin istemcilerinde okunur kalır). */
async function sendViaResend(to: string, subject: string, html: string, text: string): Promise<void> {
  /* SMTP tarafındaki dersin aynısı: zaman aşımı ŞART — yanıtsız bir uç noktada istek sonsuza
     dek asılı kalır ve hata hiç loglanmaz. */
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, text }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    /* Gövde hatanın SEBEBİNİ taşır (ör. doğrulanmamış domain, test göndereniyle başkasına
       gönderme denemesi) — durum kodu tek başına yanıltıcıdır, metni de logla. */
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}${body ? ` — ${body.slice(0, 300)}` : ""}`);
  }
}

/* ————— Gmail API gönderimi —————
   Erişim jetonu 1 saatlik; refresh token'dan üretilip süresi dolana dek bellekte tutulur.
   Her gönderimde yeniden almak hem yavaş hem gereksiz kota harcamasıdır. */
let gmailToken: { value: string; expiresAt: number } | null = null;

async function gmailAccessToken(): Promise<string> {
  /* 60 sn'lik pay: jeton gönderim sırasında dolarsa istek 401 alırdı. */
  if (gmailToken && gmailToken.expiresAt > Date.now() + 60_000) return gmailToken.value;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: gmailClientId!, client_secret: gmailClientSecret!,
      refresh_token: gmailRefreshToken!, grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.text().catch(() => "");
  if (!res.ok) {
    /* `invalid_grant` neredeyse her zaman TEK bir şey demek: refresh token ölmüş. En sık sebebi
       OAuth ekranının "Testing"de bırakılmasıdır — Google o durumda jetonu 7 GÜNDE bir iptal eder
       ve gönderim sessizce durur. Bunu açıkça söyle, yoksa "dün çalışıyordu" diye aranır. */
    if (/invalid_grant/i.test(body))
      throw new Error("Gmail refresh token geçersiz/süresi dolmuş — OAuth ekranı 'Testing' modundaysa Google jetonu 7 günde bir iptal eder. Google Cloud → OAuth consent screen → 'Publish app' ile 'In Production'a al, sonra GMAIL_REFRESH_TOKEN'ı yeniden üret (pnpm --filter @finans/server gmail-token).");
    throw new Error(`Gmail jeton yenileme başarısız ${res.status}${body ? ` — ${body.slice(0, 300)}` : ""}`);
  }
  const j = JSON.parse(body) as { access_token: string; expires_in: number };
  gmailToken = { value: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

/** Başlıklarda ASCII dışı karakter (Türkçe) ham geçemez — RFC 2047 encoded-word şart.
    "Finans — hesabını aktive et" düz gönderilirse istemciler bozuk karakter gösterir. */
const encodeHeader = (s: string): string =>
  /^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;

/** From'da yalnız görünen ad kodlanır; adres kısmı ASCII kalmalı. */
function encodeFrom(value: string): string {
  const m = /^(.*?)\s*<([^>]+)>$/.exec(value);
  return m ? `${encodeHeader(m[1])} <${m[2]}>` : encodeHeader(value);
}

/** RFC 2045: base64 gövde satırları en fazla 76 karakter olmalı. */
const b64Body = (s: string): string =>
  (Buffer.from(s, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");

async function sendViaGmail(to: string, subject: string, html: string, text: string): Promise<void> {
  const token = await gmailAccessToken();
  /* SMTP tarafındaki multipart kuralı burada da geçerli: yalnız-HTML gönderim spam sinyalidir. */
  const boundary = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const mime = [
    `From: ${encodeFrom(from)}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64Body(text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64Body(html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
  /* Gmail API `raw`ı base64URL bekler (standart base64 değil): +/ yerine -_, dolgu atılır. */
  const raw = Buffer.from(mime, "utf8").toString("base64url");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    /* 429 = günlük gönderim sınırı (şahsi Gmail'de 500 alıcı/gün). Durum kodu tek başına
       "kota mı, yetki mi" ayrımını vermez; gövdeyi de logla. */
    throw new Error(`Gmail ${res.status}${body ? ` — ${body.slice(0, 300)}` : ""}`);
  }
}

export async function sendMail(to: string, subject: string, html: string, text?: string): Promise<void> {
  const plain = text ?? html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!mailConfigured) {
    console.log(`[mail] E-posta yapılandırılmadı (MAIL_PROVIDER=${mailProvider}) — gönderilmedi. to=${to} | ${subject}\n[mail] ${plain}`);
    return;
  }
  try {
    if (useGmail) await sendViaGmail(to, subject, html, plain);
    else if (useHttp) await sendViaResend(to, subject, html, plain);
    else await transporter!.sendMail({ from, to, subject, html, text: plain });
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
