/* GMAIL_REFRESH_TOKEN üreteci — TEK SEFERLİK, YEREL çalıştırılır (sunucuda değil).
 *
 *   pnpm --filter @finans/server gmail-token
 *
 * Ön koşul — Google Cloud Console'da:
 *   1. Proje oluştur → "APIs & Services" → Library → "Gmail API" → ENABLE.
 *   2. "OAuth consent screen" → External → uygulama adı/destek e-postası doldur.
 *      Scope eklemene gerek yok (istek anında sorulur).
 *      → "PUBLISH APP" ile "In Production"a AL. Bu adım ATLANAMAZ: "Testing" modunda
 *        Google refresh token'ı 7 GÜNDE bir iptal eder ve gönderim sessizce durur.
 *        "Doğrulanmamış uygulama" uyarısı normaldir; yalnız kendi hesabın izin vereceği için
 *        Google'ın doğrulama muafiyeti (kişisel kullanım) kapsamındadır.
 *   3. "Credentials" → Create credentials → OAuth client ID → **Desktop app**.
 *      (Desktop tipi loopback yönlendirmesine izin verir; ayrıca redirect URI kaydetmen gerekmez.)
 *   4. Client ID ve Client Secret'ı buraya ver:
 *
 *   GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... pnpm --filter @finans/server gmail-token
 *
 * Script bir tarayıcı bağlantısı basar, izni yakalar ve refresh token'ı yazdırır. Çıktıyı
 * Render'daki ortam değişkenlerine gir (GMAIL_REFRESH_TOKEN). Token'ı git'e KOYMA.
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("HATA: GMAIL_CLIENT_ID ve GMAIL_CLIENT_SECRET ver.\n" +
    "  GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... pnpm --filter @finans/server gmail-token");
  process.exit(1);
}

const PORT = 5555;
const redirectUri = `http://localhost:${PORT}`;
/* CSRF koruması: Google state'i aynen geri döndürür, uyuşmazsa yanıt bizim isteğimize ait değildir. */
const state = randomBytes(16).toString("hex");

const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  /* Yalnız GÖNDERME yetkisi. gmail.readonly/modify İSTEME — posta kutusunu okuma yetkisine
     ihtiyacımız yok ve restricted scope olduklarından CASA güvenlik denetimi tetiklerler. */
  scope: "https://www.googleapis.com/auth/gmail.send",
  access_type: "offline",   // refresh token için şart
  prompt: "consent",        // zaten izin verilmişse bile YENİ refresh token üretsin
  state,
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  if (url.pathname !== "/") { res.writeHead(404).end(); return; }

  const reply = (msg) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<meta charset="utf-8"><body style="font-family:system-ui;padding:40px">${msg}</body>`);
  };

  const err = url.searchParams.get("error");
  if (err) { reply(`❌ İzin verilmedi: ${err}`); console.error(`HATA: ${err}`); server.close(); process.exit(1); }

  const code = url.searchParams.get("code");
  if (!code) { reply("Bekleniyor…"); return; }
  if (url.searchParams.get("state") !== state) {
    reply("❌ state uyuşmuyor."); console.error("HATA: state uyuşmadı — isteği yeniden başlat.");
    server.close(); process.exit(1);
  }

  const tokRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: "authorization_code",
    }),
  });
  const body = await tokRes.text();
  if (!tokRes.ok) {
    reply("❌ Jeton alınamadı, terminale bak.");
    console.error(`HATA ${tokRes.status}: ${body}`);
    server.close(); process.exit(1);
  }
  const { refresh_token, access_token } = JSON.parse(body);
  if (!refresh_token) {
    /* access_type=offline + prompt=consent varken bu olmamalı; olduysa client tipi yanlış olabilir. */
    reply("❌ refresh_token dönmedi.");
    console.error("HATA: refresh_token yok. OAuth client tipinin 'Desktop app' olduğundan emin ol.");
    server.close(); process.exit(1);
  }

  /* Hangi adresin yetkilendirildiğini göster — GMAIL_SENDER bu olmalı. Yanlış Google hesabıyla
     giriş yapmak sık bir hata ve sonucu ancak ilk gönderimde fark edilirdi. */
  let email = "";
  try {
    const p = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile",
      { headers: { Authorization: `Bearer ${access_token}` } });
    if (p.ok) email = (await p.json()).emailAddress ?? "";
  } catch { /* bilgi amaçlı; başarısızlığı akışı bozmaz */ }

  reply("✅ Tamamlandı — terminale dönebilirsin.");
  console.log("\n✅ Render ortam değişkenlerine şunları gir:\n");
  console.log("  MAIL_PROVIDER=gmail");
  console.log(`  GMAIL_CLIENT_ID=${clientId}`);
  console.log("  GMAIL_CLIENT_SECRET=<yukarıdaki secret>");
  console.log(`  GMAIL_REFRESH_TOKEN=${refresh_token}`);
  if (email) console.log(`  GMAIL_SENDER=${email}`);
  console.log("\n⚠️  OAuth ekranını 'In Production'a almadıysan bu token 7 gün sonra ölür.\n");
  server.close();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log("\nBu bağlantıyı tarayıcıda aç:\n");
  console.log(authUrl);
  console.log("\n('Google bu uygulamayı doğrulamadı' uyarısında: Advanced → Go to … (unsafe))\n");
});
