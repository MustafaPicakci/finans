import React, { useEffect, useState } from "react";
import type { Bayt } from "@finans/crypto";
import { api, ApiError, type SessionUser } from "../../api";
import { T, css } from "../../theme";
import { kurtarmaHazirla, anahtariYerlestir } from "./e2ee";

/* ————— KURTARMA KODU ADIMI (E2EE aşama 6) —————
   Veri şifreli hâle geldiği an parola TEK anahtar olmamalı: unutulursa veri gider. Bu adım
   uygulama açılmadan önce, hesabın kurtarma paketi yoksa bir kez gösterilir (yeni kayıt da
   mevcut kullanıcı da aynı yoldan geçer).

   Kullanıcı son grubu elle YAZAR. Onay kutusu tek başına yetmezdi: "kaydettim" kutusu okunmadan
   işaretlenir ve kodun gerçekten kaydedildiğini hiçbir şey göstermez. Son dört karakteri yazmak
   kodu bir yere geçirmiş olmayı gerektirir — ekrandan okumak da mümkün ama en azından kodun
   VAR olduğu ve önemli olduğu fark edilir. Proton ve Bitwarden'ın kurtarma kodu akışı da
   benzer bir teyit ister.

   Sıra bilinçli: önce paket sunucuya, SONRA anahtar cihaza. Anahtar cihaza yazıldığı an uygulama
   şifreli yazmaya başlar; paket kaydedilmeden o ana gelinirse (sekme kapanırsa) kodsuz şifreli
   veri oluşurdu. Bu sırayla yarıda kalan akış bir sonraki açılışta baştan başlar. */
/* Numaralı adım — modül düzeyinde: render içinde tanımlansaydı her tuşta yeniden kurulur ve
   doğrulama kutusu odağı kaybederdi. */
const Adim = ({ no, baslik, children }: { no: number; baslik: string; children: React.ReactNode }) => (
  <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
    <span style={{ width: 26, height: 26, borderRadius: 13, background: T.accSoft, color: T.acc, fontWeight: 700, fontSize: 13.5, display: "grid", placeItems: "center", flexShrink: 0 }}>{no}</span>
    <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 8 }}>
      <b style={{ fontSize: 15.5 }}>{baslik}</b>
      {children}
    </div>
  </div>
);

export function KurtarmaAdimi({ user, dekHam, yeniKayit, onBitti }: {
  user: SessionUser; dekHam: Bayt; yeniKayit: boolean; onBitti: (u: SessionUser) => void;
}) {
  const [hazir, setHazir] = useState<{ kod: string; paket: string } | null>(null);
  const [teyit, setTeyit] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [kopyalandi, setKopyalandi] = useState(false);

  useEffect(() => {
    kurtarmaHazirla(dekHam).then(setHazir).catch((e) => setErr(`Kurtarma kodu üretilemedi: ${(e as Error).message}`));
  }, [dekHam]);

  const son = hazir?.kod.split("-").at(-1) ?? "";
  const teyitOk = !!son && teyit.trim().toUpperCase() === son;

  const kopyala = async () => {
    if (!hazir) return;
    try { await navigator.clipboard.writeText(hazir.kod); setKopyalandi(true); } catch { setErr("Kopyalanamadı — kodu elle yaz"); }
  };
  const indir = () => {
    if (!hazir) return;
    const metin = `Finans kurtarma kodu\n\nHesap: ${user.email}\nKod:   ${hazir.kod}\n\n` +
      `Parolanı unutursan verilerine bu kodla ulaşırsın. Kimseyle paylaşma;\n` +
      `kaybedersen ve parolanı da unutursan verilerin kurtarılamaz.\n`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([metin], { type: "text/plain;charset=utf-8" }));
    a.download = "finans-kurtarma-kodu.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const yedek = async () => {
    try {
      const blob = await api.exportData();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `finans-yedek-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Yedek indirilemedi"); }
  };

  const devam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hazir || !teyitOk) return;
    setBusy(true); setErr("");
    try {
      await api.e2eeKurtarma(hazir.paket);
    } catch (e) {
      /* Başka bir cihaz arada kod oluşturduysa BU kod geçersizdir — sessizce devam etmek
         kullanıcıyı işe yaramayan bir kodla bırakırdı. */
      if (e instanceof ApiError && e.status === 409) {
        setErr("Bu hesabın kurtarma kodu az önce başka bir cihazda oluşturulmuş. Buradaki kod GEÇERSİZ — o cihazda gösterilen kodu sakla.");
        await anahtariYerlestir(user, dekHam);
        setTimeout(() => onBitti(user), 4000);
        return;
      }
      setErr(e instanceof ApiError ? e.message : "Kaydedilemedi, tekrar dene");
      setBusy(false);
      return;
    }
    await anahtariYerlestir(user, dekHam);
    onBitti(user);
  };

  /* Yeniden tasarım (grup 8): içerik aynı, iki numaralı adım — 1 kodu sakla, 2 doğrula. Doğrulama
     dört kutu gibi görünür; altında tek bir gerçek `input` var (yapıştırma, silme, klavye aynen çalışır). */
  const harfler = teyit.toUpperCase().padEnd(4, " ").slice(0, 4).split("");
  return (
    <div style={{ ...css.card, width: "100%", display: "grid", gap: 16 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 19, marginBottom: 6 }}>Kurtarma kodun</div>
        <div style={{ fontSize: 14, color: T.mut, lineHeight: 1.55 }}>
          {yeniKayit ? "Verilerin" : "Verilerin artık"} yalnız senin anahtarınla açılabiliyor, <b style={{ color: T.text }}>biz bile göremiyoruz</b>.
          Parolanı unutursan verilerine ulaşmanın <b style={{ color: T.text }}>tek yolu</b> bu kod. Kaybedersen ve parolanı da
          unutursan verilerin kurtarılamaz.
        </div>
      </div>

      <Adim no={1} baslik="Kodu sakla">
        <div style={{
          fontFamily: T.mono, fontSize: 17, fontWeight: 650, letterSpacing: "0.04em", lineHeight: 1.7, textAlign: "center",
          padding: "14px 10px", borderRadius: 12, background: T.panel2, wordBreak: "break-word", userSelect: "all",
        }}>
          {/* Tireler METNİN parçası (girişte yok sayılır); iki yarı ayrı blok: dar ekranda 4+4 grup kırılır */}
          {hazir ? <><span style={{ display: "inline-block" }}>{hazir.kod.slice(0, 20)}</span><span style={{ display: "inline-block" }}>{hazir.kod.slice(20)}</span></> : "…"}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={kopyala} disabled={!hazir} style={{ ...css.ghost, flex: 1, height: 44 }}>{kopyalandi ? "Kopyalandı ✓" : "Kopyala"}</button>
          <button type="button" onClick={indir} disabled={!hazir} style={{ ...css.ghost, flex: 1, height: 44 }}>Dosya indir</button>
        </div>
      </Adim>

      <form onSubmit={devam} style={{ display: "grid", gap: 16 }}>
        <Adim no={2} baslik="Sakladığını doğrula">
          <span style={{ fontSize: 13.5, color: T.mut }}>Kodun son 4 karakterini yaz</span>
          <label style={{ position: "relative", display: "flex", gap: 8, cursor: "text" }}>
            {harfler.map((c, i) => (
              <span key={i} aria-hidden="true" style={{
                width: 48, height: 52, borderRadius: 11, display: "grid", placeItems: "center", boxSizing: "border-box",
                border: `1.5px solid ${i === Math.min(teyit.length, 3) ? T.acc : T.line}`, background: T.panel,
                fontFamily: T.mono, fontSize: 21, fontWeight: 600,
              }}>{c.trim()}</span>
            ))}
            <input aria-label="Kodun son 4 karakteri" value={teyit} onChange={(e) => setTeyit(e.target.value.replace(/[\s-]/g, ""))} maxLength={4}
              autoComplete="off" autoCapitalize="characters" spellCheck={false}
              style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", border: "none", minHeight: 0, fontSize: 16 }} />
          </label>
        </Adim>
        {err && <div style={{ fontSize: 13.5, color: T.neg }}>{err}</div>}
        <button type="submit" disabled={!teyitOk || busy} style={{ ...css.btn, width: "100%", height: 50, fontSize: 15.5, opacity: !teyitOk || busy ? 0.5 : 1 }}>
          {busy ? "Kaydediliyor…" : "Kaydettim, devam et"}
        </button>
      </form>

      {!yeniKayit && (
        <div style={{ fontSize: 13, color: T.mut, lineHeight: 1.55 }}>
          İstersen önce mevcut verilerini de yedekle:{" "}
          <button type="button" onClick={yedek} style={{ background: "none", border: "none", padding: 0, minHeight: 0, color: T.acc, fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
            verilerimi indir (.json)
          </button>
        </div>
      )}
    </div>
  );
}

