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

  return (
    <div style={{ ...css.card, width: "100%" }}>
      <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>Kurtarma kodun</div>
      <div style={{ fontSize: 13, color: T.mut, lineHeight: 1.6, marginBottom: 14 }}>
        {yeniKayit ? "Verilerin" : "Verilerin artık"} yalnız senin anahtarınla açılabiliyor, <b>biz bile göremiyoruz</b>.
        Parolanı unutursan verilerine ulaşmanın <b>tek yolu</b> bu kod. Kaybedersen ve parolanı da
        unutursan verilerin kurtarılamaz.
      </div>

      <div style={{
        fontFamily: T.mono, fontSize: 17, fontWeight: 650, letterSpacing: "0.04em", lineHeight: 1.7, textAlign: "center",
        padding: "14px 10px", borderRadius: 10, background: T.panel2, border: `1px solid ${T.line}`, wordBreak: "break-word",
        userSelect: "all",
      }}>
        {/* Tireler METNİN parçası: seçip kopyalayan da indirilen dosyadaki biçimi alır
            (girişte tire ve boşluk yok sayılır, yani biçim kodu bozmaz). */}
        {/* İki yarı ayrı satır içi blok: dar ekranda 4+4 grup kırılır (tek metin 5+3 kırılıyordu) */}
        {hazir ? <><span style={{ display: "inline-block" }}>{hazir.kod.slice(0, 20)}</span><span style={{ display: "inline-block" }}>{hazir.kod.slice(20)}</span></> : "…"}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="button" onClick={kopyala} disabled={!hazir} style={{ ...css.ghost, flex: 1 }}>{kopyalandi ? "Kopyalandı ✓" : "Kopyala"}</button>
        <button type="button" onClick={indir} disabled={!hazir} style={{ ...css.ghost, flex: 1 }}>Dosya olarak indir</button>
      </div>

      <form onSubmit={devam} style={{ marginTop: 16, display: "grid", gap: 10 }}>
        <div>
          <div style={css.label}>Kaydettiğini doğrula — kodun son 4 karakteri</div>
          <input style={{ ...css.input, width: "100%", fontFamily: T.mono, letterSpacing: "0.1em", textTransform: "uppercase" }}
            value={teyit} onChange={(e) => setTeyit(e.target.value)} maxLength={4} autoComplete="off" autoCapitalize="characters"
            placeholder="····" />
        </div>
        {err && <div style={{ fontSize: 13, color: T.neg }}>{err}</div>}
        <button type="submit" disabled={!teyitOk || busy} style={{ ...css.btn, width: "100%", padding: "11px 14px", opacity: !teyitOk || busy ? 0.55 : 1 }}>
          {busy ? "Kaydediliyor…" : "Kaydettim, devam et"}
        </button>
      </form>

      {!yeniKayit && (
        <div style={{ fontSize: 12.5, color: T.mut3, marginTop: 12, lineHeight: 1.55 }}>
          İstersen önce mevcut verilerini de yedekle:{" "}
          <button type="button" onClick={yedek} style={{ background: "none", border: "none", padding: 0, color: T.acc, fontWeight: 600, cursor: "pointer", fontSize: 12.5 }}>
            verilerimi indir (.json)
          </button>
        </div>
      )}
    </div>
  );
}
