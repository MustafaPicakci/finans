import React, { useState } from "react";
import { api, ApiError, type SessionUser } from "../../api";
import { T, css, themeCSS } from "../../theme";

/* Faz 5.1 — giriş / kayıt ekranı. Auth kapısı App.tsx'te: oturum yoksa bu ekran gösterilir.
   Kayıt yalnız ilk kullanıcıya (owner) açık; sonrası 403 döner (çok kullanıcı Faz 5.2'de). */
export function Auth({ onAuthed }: { onAuthed: (u: SessionUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const { user } = mode === "login" ? await api.login(email, password) : await api.register(email, password);
      onAuthed(user);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Bir hata oldu, tekrar dene");
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100dvh", background: T.bg, color: T.text, display: "grid", placeItems: "center", padding: 16 }}>
      <style>{themeCSS}</style>
      <div style={{ ...css.card, width: "100%", maxWidth: 380 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 680, fontSize: 18, letterSpacing: "-0.02em", marginBottom: 4 }}>
          <span style={{ width: 30, height: 30, borderRadius: 9, background: T.acc, color: T.accInk, display: "grid", placeItems: "center", fontSize: 16, fontWeight: 800 }}>₺</span>
          finans
        </div>
        <div style={{ fontSize: 13, color: T.mut3, marginBottom: 18 }}>
          {mode === "login" ? "Devam etmek için giriş yap." : "İlk hesabı oluştur (owner)."}
        </div>

        <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
          <div>
            <div style={css.label}>E-posta</div>
            <input style={{ ...css.input, width: "100%" }} type="email" autoComplete="email" inputMode="email"
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ornek@eposta.com" autoFocus />
          </div>
          <div>
            <div style={css.label}>Parola</div>
            <input style={{ ...css.input, width: "100%" }} type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "register" ? "en az 8 karakter" : "••••••••"} />
          </div>
          {err && <div style={{ fontSize: 13, color: T.neg }}>{err}</div>}
          <button type="submit" disabled={busy} style={{ ...css.btn, width: "100%", padding: "11px 14px", opacity: busy ? 0.6 : 1 }}>
            {busy ? "…" : mode === "login" ? "Giriş yap" : "Kayıt ol"}
          </button>
        </form>

        <div style={{ fontSize: 13, color: T.mut, marginTop: 14, textAlign: "center" }}>
          {mode === "login" ? "İlk kez mi kuruyorsun? " : "Zaten hesabın var mı? "}
          <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(""); }}
            style={{ background: "none", border: "none", color: T.acc, cursor: "pointer", fontWeight: 600, fontSize: 13, fontFamily: T.disp }}>
            {mode === "login" ? "Kayıt ol" : "Giriş yap"}
          </button>
        </div>
      </div>
    </div>
  );
}
