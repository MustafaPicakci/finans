import React, { useState, useEffect } from "react";
import { api, ApiError, type SessionUser } from "../../api";
import { T, css, themeCSS } from "../../theme";

/* Faz 5.1 giriş/kayıt + Faz 6 şifre sıfırlama & hesap aktivasyonu.
   Auth kapısı App.tsx'te: oturum yoksa (veya URL'de reset/verify token'ı varsa) bu ekran gösterilir.
   Kayıt yalnız ilk kullanıcıya (owner) açık; sonrası 403 döner. */
export type UrlAuth = { kind: "reset" | "verify"; token: string } | null;
type Mode = "login" | "register" | "forgot" | "reset";

const SUBTITLE: Record<Mode, string> = {
  login: "Devam etmek için giriş yap.",
  register: "İlk hesabı oluştur (owner).",
  forgot: "Şifreni sıfırlamak için e-postanı gir.",
  reset: "Yeni şifreni belirle.",
};

const cleanUrl = () => window.history.replaceState(null, "", window.location.pathname);

export function Auth({ onAuthed, urlAuth }: {
  onAuthed: (u: SessionUser) => void;
  urlAuth?: UrlAuth;
}) {
  const [mode, setMode] = useState<Mode>(urlAuth?.kind === "reset" ? "reset" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

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
    setErr(""); setInfo(""); setBusy(true);
    try {
      if (mode === "login" || mode === "register") {
        const { user } = mode === "login" ? await api.login(email, password) : await api.register(email, password);
        onAuthed(user);
        return; // onAuthed yönlendirir; busy'yi bırakmaya gerek yok
      }
      if (mode === "forgot") {
        await api.forgot(email);
        setInfo("Bu e-posta kayıtlıysa sıfırlama bağlantısı gönderildi. Gelen kutunu (ve spam) kontrol et.");
      } else if (mode === "reset" && urlAuth) {
        await api.reset(urlAuth.token, password);
        setInfo("Şifren güncellendi. Yeni şifrenle giriş yapabilirsin.");
        setPassword(""); setMode("login"); cleanUrl();
      }
      setBusy(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Bir hata oldu, tekrar dene");
      setBusy(false);
    }
  };

  const go = (m: Mode) => { setMode(m); setErr(""); setInfo(""); };
  const cta = mode === "login" ? "Giriş yap" : mode === "register" ? "Kayıt ol" : mode === "forgot" ? "Sıfırlama bağlantısı gönder" : "Şifreyi güncelle";

  return (
    <div style={{ minHeight: "100dvh", background: T.bg, color: T.text, display: "grid", placeItems: "center", padding: 16 }}>
      <style>{themeCSS}</style>
      <div style={{ ...css.card, width: "100%", maxWidth: 380 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 680, fontSize: 18, letterSpacing: "-0.02em", marginBottom: 4 }}>
          <span style={{ width: 30, height: 30, borderRadius: 9, background: T.acc, color: T.accInk, display: "grid", placeItems: "center", fontSize: 16, fontWeight: 800 }}>₺</span>
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
          {mode !== "forgot" && (
            <div>
              <div style={css.label}>{mode === "reset" ? "Yeni parola" : "Parola"}</div>
              <input style={{ ...css.input, width: "100%" }} type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "login" ? "••••••••" : "en az 8 karakter"} autoFocus={mode === "reset"} />
            </div>
          )}
          {err && <div style={{ fontSize: 13, color: T.neg }}>{err}</div>}
          {info && <div style={{ fontSize: 13, color: T.pos }}>{info}</div>}
          <button type="submit" disabled={busy} style={{ ...css.btn, width: "100%", padding: "11px 14px", opacity: busy ? 0.6 : 1 }}>
            {busy ? "…" : cta}
          </button>
        </form>

        <div style={{ fontSize: 13, color: T.mut, marginTop: 14, textAlign: "center", lineHeight: 1.9 }}>
          {mode === "login" && (
            <>
              <button onClick={() => go("forgot")} style={linkBtn}>Şifremi unuttum</button>
              <br />
              İlk kez mi kuruyorsun? <button onClick={() => go("register")} style={linkBtn}>Kayıt ol</button>
            </>
          )}
          {mode === "register" && (<>Zaten hesabın var mı? <button onClick={() => go("login")} style={linkBtn}>Giriş yap</button></>)}
          {(mode === "forgot" || mode === "reset") && (<button onClick={() => go("login")} style={linkBtn}>← Girişe dön</button>)}
        </div>
      </div>
    </div>
  );
}

const linkBtn: React.CSSProperties = { background: "none", border: "none", color: T.acc, cursor: "pointer", fontWeight: 600, fontSize: 13, fontFamily: T.disp };
