import React, { useState } from "react";
import { api } from "../../api";
import { T, css } from "../../theme";

/* ————— HESABIM (KULLANICI hesabı) —————
   Bu ekran "Hesaplar" sekmesinden AYRI ve bu bilinçli: orada "hesap" = banka/nakit/aracı
   kurum hesabı, burada "hesap" = giriş yaptığın kullanıcı. İkisi aynı sekmede durunca
   "Hesabı sil" düğmesi bir banka hesabını siliyormuş gibi okunuyordu — en yıkıcı eylemin
   yanlış anlaşılması kabul edilemez.

   Ana menüde yer almaz (menü zaten sekiz sekme): kenar çubuğundaki kullanıcı kartından ve
   mobildeki ⋯ menüsünden açılır — yani kullanıcı kimliğinin durduğu yerden. */
export function Profil({ user, onDeleted }: { user: { email: string }; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const download = async () => {
    try {
      const blob = await api.exportData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `finans-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(url);
    } catch { setErr("Dışa aktarılamadı"); }
  };
  const remove = async () => {
    setErr(""); setBusy(true);
    try { await api.deleteAccount(pw); onDeleted(); }
    catch { setErr("Parola hatalı"); setBusy(false); }
  };

  return (<>
    <div style={css.card}>
      <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
        <span style={{
          width: 44, height: 44, borderRadius: 14, background: T.accSoft, color: T.acc,
          display: "grid", placeItems: "center", fontWeight: 700, fontSize: 16, flexShrink: 0,
        }}>{user.email.slice(0, 2).toUpperCase()}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{user.email.split("@")[0]}</div>
          <div style={{ fontSize: 12.5, color: T.mut3, overflow: "hidden", textOverflow: "ellipsis" }}>{user.email}</div>
        </div>
      </div>
    </div>

    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Verilerini indir</div>
      <div style={{ fontSize: 12.5, color: T.mut, marginBottom: 12, lineHeight: 1.5 }}>
        Bütün kayıtların (hesaplar, işlemler, portföy, kartlar, plan) tek bir JSON dosyası olarak iner.
        Yedek almak ya da başka bir yere taşımak için.
      </div>
      <button style={css.ghost} onClick={download}>JSON olarak indir</button>
    </div>

    {/* Yıkıcı bölge en altta ve görsel olarak ayrı — yanlışlıkla tıklanacak yerde durmaz */}
    <div style={{ ...css.card, borderColor: T.neg }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, color: T.neg }}>Hesabı sil</div>
      <div style={{ fontSize: 12.5, color: T.mut, marginBottom: 12, lineHeight: 1.5 }}>
        <b>Kullanıcı hesabın</b> ve ona bağlı <b>tüm verilerin</b> kalıcı olarak silinir — banka hesapların,
        işlemlerin, portföyün, kart ve plan kayıtların dahil. Geri alınamaz.
        Silmeden önce yukarıdan bir yedek indirmek isteyebilirsin.
      </div>
      {!confirm
        ? <button style={{ ...css.ghost, color: T.neg, borderColor: T.neg }} onClick={() => setConfirm(true)}>Hesabımı silmek istiyorum</button>
        : (
          <div style={{ padding: 12, border: `1px solid ${T.neg}`, borderRadius: 12, background: T.negSoft }}>
            <div style={{ fontSize: 13, color: T.text, marginBottom: 8 }}>
              Onaylamak için parolanı gir.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input style={{ ...css.input, width: 200 }} type="password" placeholder="parola" value={pw}
                onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
              <button style={{ ...css.btn, background: T.neg }} disabled={busy || !pw} onClick={remove}>{busy ? "…" : "Kalıcı olarak sil"}</button>
              <button style={css.ghost} onClick={() => { setConfirm(false); setPw(""); setErr(""); }}>Vazgeç</button>
            </div>
            {err && <div style={{ fontSize: 13, color: T.neg, marginTop: 8 }}>{err}</div>}
          </div>
        )}
    </div>
  </>);
}
