import React, { useState, useEffect } from "react";
import { api, ApiError, type SessionUser } from "../../api";
import { T, css, themeCSS } from "../../theme";
import type { Bayt } from "@finans/crypto";
import { girisYap, yeniMalzeme, parolaSorunu, anahtariYerlestir, kurtarmaIleSifirla, PAROLA_MIN, ZAYIF_PAROLA_KEY } from "./e2ee";
import { KurtarmaAdimi } from "./Kurtarma";

/* Faz 5.1 giriş/kayıt + Faz 6 şifre sıfırlama & hesap aktivasyonu.
   Auth kapısı App.tsx'te: oturum yoksa (veya URL'de reset/verify token'ı varsa) bu ekran gösterilir.
   E2EE aşama 3b: bu ekran parolayla DOĞRUDAN istek atmaz — `./e2ee` üzerinden geçer, parola
   orada türetilir ve tarayıcıdan çıkmaz. */
export type UrlAuth = { kind: "reset" | "verify"; token: string } | null;
type Mode = "login" | "register" | "forgot" | "reset";

const SUBTITLE: Record<Mode, string> = {
  login: "Devam etmek için giriş yap.",
  register: "Yeni hesap oluştur.",
  forgot: "Şifreni sıfırlamak için e-postanı gir.",
  reset: "Yeni şifreni belirle.",
};

const cleanUrl = () => window.history.replaceState(null, "", window.location.pathname);

export function Auth({ onAuthed, urlAuth, bilgi }: {
  onAuthed: (u: SessionUser) => void;
  urlAuth?: UrlAuth;
  /** Giriş ekranının neden açıldığı (ör. bu cihazda veri anahtarı yok) */
  bilgi?: string;
}) {
  const [mode, setMode] = useState<Mode>(urlAuth?.kind === "reset" ? "reset" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState(bilgi ?? "");
  const [notVerified, setNotVerified] = useState(false); // login 403 → aktive edilmemiş: yeniden gönder butonu göster
  /* Giriş başarılı ama hesabın kurtarma paketi yok → uygulamadan ÖNCE kurtarma kodu adımı */
  const [kurtarma, setKurtarma] = useState<{ user: SessionUser; dekHam: Bayt; yeniKayit: boolean } | null>(null);

  /* Şifre sıfırlama bağlantısı: hesabın verisi şifreliyse yeni parola TEK BAŞINA yetmez
     (veri anahtarı parolayla sarılı; yeni parola yeni anahtar demek). Bağlantı açılınca
     durum sorulur ve iki açık yol sunulur: kurtarma koduyla (veri korunur) ya da veriyi
     silerek. Varsayılan kurtarma kodudur — silme yolu ayrı bir onay kutusu ister. */
  const [resetBilgi, setResetBilgi] = useState<{ sifreli: boolean; kurtarma_paketi: string | null } | null>(null);
  const [resetYol, setResetYol] = useState<"kod" | "sil">("kod");
  const [kod, setKod] = useState("");
  const [silOnay, setSilOnay] = useState(false);
  useEffect(() => {
    if (urlAuth?.kind !== "reset") return;
    api.resetBilgi(urlAuth.token)
      .then((b) => { setResetBilgi(b); if (b.sifreli && !b.kurtarma_paketi) setResetYol("sil"); })
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Bağlantı doğrulanamadı"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Aktivasyon token'ı varsa mount'ta otomatik doğrula, sonra giriş moduna dön. */
  useEffect(() => {
    if (urlAuth?.kind !== "verify") return;
    setBusy(true);
    api.verify(urlAuth.token)
      .then(() => setInfo("Hesabın aktive edildi. Şimdi giriş yapabilirsin."))
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Aktivasyon başarısız"))
      .finally(() => { setBusy(false); setMode("login"); cleanUrl(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setInfo(""); setNotVerified(false); setBusy(true);
    try {
      if (mode === "login") {
        const g = await girisYap(email, password);
        /* Parola bugünkü kurala uymuyorsa (eski hesaplar 8 karakterle açıldı) uygulama içinde
           bir kez hatırlatılır. Girişi ENGELLEMEZ: kilitlemek, zayıf parolayı değiştirmekten
           daha kötü bir sonuç. Parolanın kendisi değil yalnız "zayıf" bilgisi saklanır. */
        try { if (parolaSorunu(password, email)) sessionStorage.setItem(ZAYIF_PAROLA_KEY, "1"); else sessionStorage.removeItem(ZAYIF_PAROLA_KEY); } catch { /* depo yoksa uyarı da yok */ }
        if (g.kurtarmaGerekli) { setKurtarma({ user: g.user, dekHam: g.dekHam, yeniKayit: false }); setBusy(false); return; }
        await anahtariYerlestir(g.user, g.dekHam);
        onAuthed(g.user);
        return; // onAuthed yönlendirir; busy'yi bırakmaya gerek yok
      }
      if (mode === "register") {
        const sorun = parolaSorunu(password, email);
        if (sorun) { setErr(sorun); setBusy(false); return; }
        const m = await yeniMalzeme(password);
        const res = await api.register(email, m.govde);
        if (res.pending) {
          // Doğrulama zorunlu: oturum açılmadı, kullanıcı e-postasını doğrulamalı.
          setInfo("Doğrulama e-postası gönderildi. Gelen kutunu (ve spam klasörünü) kontrol edip bağlantıya tıkla, sonra giriş yap.");
          setPassword(""); setMode("login"); setBusy(false);
        } else if (res.user) {
          // owner (ilk kullanıcı): otomatik giriş — kurtarma kodu adımı yine ŞART
          setKurtarma({ user: res.user, dekHam: m.dekHam, yeniKayit: true }); setBusy(false);
        }
        return;
      }
      if (mode === "forgot") {
        await api.forgot(email);
        setInfo("Bu e-posta kayıtlıysa sıfırlama bağlantısı gönderildi. Gelen kutunu (ve spam) kontrol et.");
      } else if (mode === "reset" && urlAuth) {
        const sorun = parolaSorunu(password, "");
        if (sorun) { setErr(sorun); setBusy(false); return; }
        if (!resetBilgi) { setBusy(false); return; }
        if (resetBilgi.sifreli && resetYol === "kod") {
          await kurtarmaIleSifirla(urlAuth.token, kod, password, resetBilgi.kurtarma_paketi!);
          setInfo("Şifren güncellendi, verilerin korundu. Yeni şifrenle giriş yapabilirsin.");
        } else if (resetBilgi.sifreli) {
          if (!silOnay) { setErr("Devam etmek için verilerinin silineceğini onayla"); setBusy(false); return; }
          await api.reset(urlAuth.token, (await yeniMalzeme(password)).govde, "sil");
          setInfo("Şifren güncellendi ve verilerin silindi. Giriş yapınca hesabın boş açılacak.");
        } else {
          await api.reset(urlAuth.token, (await yeniMalzeme(password)).govde);
          setInfo("Şifren güncellendi. Yeni şifrenle giriş yapabilirsin.");
        }
        setPassword(""); setKod(""); setMode("login"); cleanUrl();
      }
      setBusy(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Bir hata oldu, tekrar dene");
      // login sırasında 403 = hesap aktive edilmemiş → doğrulama e-postasını yeniden gönder seçeneği sun
      if (mode === "login" && e instanceof ApiError && e.status === 403) setNotVerified(true);
      setBusy(false);
    }
  };

  const resend = async () => {
    setErr(""); setBusy(true);
    try {
      await api.resendVerify(email);
      setNotVerified(false);
      setInfo("Doğrulama e-postası yeniden gönderildi. Gelen kutunu (ve spam) kontrol et.");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Gönderilemedi, tekrar dene");
    }
    setBusy(false);
  };

  const go = (m: Mode) => { setMode(m); setErr(""); setInfo(""); setNotVerified(false); };
  const cta = mode === "login" ? "Giriş yap" : mode === "register" ? "Kayıt ol" : mode === "forgot" ? "Sıfırlama bağlantısı gönder" : "Şifreyi güncelle";
  /* Meşgul etiketi açık yazılır: anahtar türetme (600k PBKDF2) düşük donanımlı telefonda ~1 sn
     sürebiliyor ve bu bilinçli bir maliyet — "…" donmuş gibi görünüyordu. */
  const mesgul = mode === "login" ? "Giriş yapılıyor…" : mode === "register" ? "Hesap oluşturuluyor…" : mode === "reset" ? "Güncelleniyor…" : "…";
  const yeniParola = mode === "register" || mode === "reset";
  const canliSorun = yeniParola && password ? parolaSorunu(password, mode === "register" ? email : "") : null;

  return (
    /* boxSizing: min-height ve padding aynı kutuda — border-box olmadan yükseklik
       100dvh + 32px oluyordu, yani içerik rahat sığsa bile sayfa her zaman 32px
       kaydırılıyordu (telefonda adres çubuğu bunu zıplamaya çevirir). */
    <div style={{ minHeight: "100dvh", boxSizing: "border-box", background: T.bg, color: T.text, display: "grid", placeItems: "center", padding: 16 }}>
      <style>{themeCSS}</style>
      {/* Kart ve tanıtım TEK grid çocuğu: ayrı çocuk olsalar grid iki satıra bölünür ve
          aralarında ekran boyuna göre değişen bir boşluk açılırdı. */}
      <div style={{ width: "100%", maxWidth: 380 }}>
      {kurtarma ? <KurtarmaAdimi {...kurtarma} onBitti={onAuthed} /> : (
      <div style={{ ...css.card, width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 680, fontSize: 18, letterSpacing: "-0.02em", marginBottom: 4 }}>
          <span style={{ width: 30, height: 30, borderRadius: 9, background: T.acc, color: T.accInk, display: "grid", placeItems: "center", fontSize: 16, fontWeight: 800, fontFamily: T.mono }}>₺</span>
          finans
        </div>
        <div style={{ fontSize: 13, color: T.mut3, marginBottom: 18 }}>{SUBTITLE[mode]}</div>

        <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
          {mode !== "reset" && (
            <div>
              <div style={css.label}>E-posta</div>
              <input style={{ ...css.input, width: "100%" }} type="email" autoComplete="email" inputMode="email"
                value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ornek@eposta.com" autoFocus />
            </div>
          )}
          {mode === "reset" && resetBilgi?.sifreli && (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontSize: 13, color: T.mut, lineHeight: 1.55 }}>
                Verilerin şifreli ve yalnız senin anahtarınla açılıyor. Yeni parolayla verine ulaşmak için
                kurtarma kodun gerekiyor.
              </div>
              {resetBilgi.kurtarma_paketi && (
                <div style={{ display: "flex", gap: 6 }}>
                  {([["kod", "Kurtarma kodum var"], ["sil", "Kodum yok"]] as const).map(([k, ad]) => (
                    <button key={k} type="button" onClick={() => { setResetYol(k); setErr(""); }}
                      style={{ ...css.ghost, flex: 1, padding: "8px 10px", ...(resetYol === k ? { background: T.panel, color: T.acc, borderColor: T.acc, fontWeight: 640 } : {}) }}>
                      {ad}
                    </button>
                  ))}
                </div>
              )}
              {resetYol === "kod" ? (
                <div>
                  <div style={css.label}>Kurtarma kodu</div>
                  <input style={{ ...css.input, width: "100%", fontFamily: T.mono, textTransform: "uppercase" }} value={kod}
                    onChange={(e) => setKod(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-…" autoComplete="off" autoCapitalize="characters" autoFocus />
                </div>
              ) : (
                <div style={{ fontSize: 13, lineHeight: 1.55, padding: 12, borderRadius: 10, border: `1px solid ${T.neg}`, color: T.text }}>
                  Kurtarma kodun olmadan verilerin <b>açılamaz</b> — biz de açamayız. Yeni parola belirlersen
                  hesabın kalır ama tüm kayıtların (hesaplar, işlemler, portföy, asistan sohbetleri) <b>kalıcı olarak silinir</b>.
                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, cursor: "pointer" }}>
                    <input type="checkbox" checked={silOnay} onChange={(e) => setSilOnay(e.target.checked)} style={{ marginTop: 3 }} />
                    <span>Verilerimin kalıcı olarak silineceğini anlıyorum</span>
                  </label>
                </div>
              )}
            </div>
          )}
          {mode !== "forgot" && (
            <div>
              <div style={css.label}>{mode === "reset" ? "Yeni parola" : "Parola"}</div>
              <input style={{ ...css.input, width: "100%" }} type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "login" ? "••••••••" : `en az ${PAROLA_MIN} karakter`} autoFocus={mode === "reset" && !resetBilgi?.sifreli} />
              {/* Canlı ipucu yalnız YENİ parola belirlenirken; girişte gösterilmez (orada kural yok,
                  eski hesapların parolası kısa olabilir ve giriş yapabilmeleri gerekiyor). */}
              {/* gönderimde aynı sorun `err` olarak da basılıyordu — ikisi aynı anda görünmesin */}
              {canliSorun && canliSorun !== err && <div style={{ fontSize: 12, color: T.mut3, marginTop: 5 }}>{canliSorun}</div>}
            </div>
          )}
          {err && <div style={{ fontSize: 13, color: T.neg }}>{err}</div>}
          {notVerified && (
            <div style={{ fontSize: 13, color: T.mut }}>
              <button type="button" onClick={resend} disabled={busy} style={linkBtn}>Doğrulama e-postasını tekrar gönder</button>
            </div>
          )}
          {info && <div style={{ fontSize: 13, color: T.pos }}>{info}</div>}
          {(() => {
            const silYolu = mode === "reset" && resetBilgi?.sifreli && resetYol === "sil";
            const bekliyor = mode === "reset" && !resetBilgi; // bağlantının durumu henüz bilinmiyor
            const kapali = busy || bekliyor || (silYolu && !silOnay);
            return (
              <button type="submit" disabled={kapali}
                style={{ ...css.btn, width: "100%", padding: "11px 14px", opacity: kapali ? 0.6 : 1, ...(silYolu ? { background: T.neg } : {}) }}>
                {busy ? mesgul : silYolu ? "Verilerimi silerek şifreyi güncelle" : cta}
              </button>
            );
          })()}
        </form>

        <div style={{ fontSize: 13, color: T.mut, marginTop: 14, textAlign: "center", lineHeight: 1.9 }}>
          {mode === "login" && (
            <>
              <button onClick={() => go("forgot")} style={linkBtn}>Şifremi unuttum</button>
              <br />
              Hesabın yok mu? <button onClick={() => go("register")} style={linkBtn}>Kayıt ol</button>
            </>
          )}
          {mode === "register" && (<>Zaten hesabın var mı? <button onClick={() => go("login")} style={linkBtn}>Giriş yap</button></>)}
          {(mode === "forgot" || mode === "reset") && (<button onClick={() => go("login")} style={linkBtn}>← Girişe dön</button>)}
        </div>
      </div>
      )}

      {!kurtarma && <Tanitim />}
      </div>
    </div>
  );
}

/* Faz 28 — giriş ekranındaki herkese açık tanıtım. Google'ın OAuth marka doğrulaması üç şey
   istiyor ve üçü de burada karşılanıyor: ana sayfa (1) giriş duvarının ARKASINDA olmamalı,
   (2) uygulamanın ne yaptığını anlatmalı, (3) gizlilik politikası ile kullanım koşullarına
   link vermeli. Önceden `/` yalnız bir form olduğundan üçü de karşılanmıyordu.
   Kullanıcı için de kazanç: bağlantıyı ilk kez açan biri neye kaydolduğunu görüyor. */
function Tanitim() {
  return (
    <div style={{ marginTop: 22, color: T.mut, fontSize: 13, lineHeight: 1.65 }}>
      <div style={{ fontWeight: 650, color: T.text, fontSize: 14, marginBottom: 6 }}>Finans nedir?</div>
      <p style={{ margin: "0 0 12px" }}>
        Kişisel finans panelin. Banka hesaplarına <strong>bağlanmaz</strong>; kayıtlarını sen
        girersin, uygulama da onlardan bütün resmi çıkarır.
      </p>
      <ul style={{ margin: "0 0 14px", paddingLeft: 18, display: "grid", gap: 3 }}>
        <li>Nakit hesapları, gelir ve giderler</li>
        <li>Kredi taksitleri ve kredi kartı ekstreleri</li>
        <li>Günlük nakit akışı takvimi — hangi gün ne kadar kalıyor</li>
        <li>Canlı fiyatlı portföy: BIST, fonlar, altın, döviz, kripto, ETF</li>
      </ul>
      <div style={{ borderTop: `1px solid ${T.line}`, paddingTop: 12, fontSize: 12.5 }}>
        <a href="/gizlilik" style={legalLink}>Gizlilik Politikası</a>
        <span style={{ opacity: 0.5, margin: "0 7px" }}>·</span>
        <a href="/kosullar" style={legalLink}>Kullanım Koşulları</a>
      </div>
    </div>
  );
}

const legalLink: React.CSSProperties = { color: T.acc, textDecoration: "none", fontWeight: 600 };

const linkBtn: React.CSSProperties = { background: "none", border: "none", color: T.acc, cursor: "pointer", fontWeight: 600, fontSize: 13, fontFamily: T.disp };
