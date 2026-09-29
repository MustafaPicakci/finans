import React, { useEffect, useState } from "react";
import { T, css } from "../../theme";
import { Row, SilDugmesi } from "../../ui";
import { api, type PushDurum } from "../../api";
import { pushDestekli, iosSekmede, buCihaz, pushDurum, bildirimAc, bildirimKapat, denemeGonder, durumuTazele } from "../../bildirim";

/* ————— Bildirimler (Faz 44) —————
   Hesabım'da, çünkü bildirim bir CİHAZ ayarıdır ve cihaz listesi (kaldır) kullanıcının hesabına
   aittir. Cihaz listesi şart: tutarlar bildirimde görünüyor, satılan ya da başkasına verilen bir
   telefona bildirim gitmeye devam etmemeli (çıkış yapınca o cihaz zaten kendiliğinden düşer). */
export function BildirimKarti() {
  const [durum, setDurum] = useState<PushDurum | null>(null);
  const [buUc, setBuUc] = useState<string | null>(null); // bu cihazın abonelik adresi
  const [mesgul, setMesgul] = useState(false);
  const [mesaj, setMesaj] = useState<{ ok: boolean; mesaj: string } | null>(null);
  const destek = pushDestekli();
  const izinEngelli = destek && Notification.permission === "denied";

  const yukle = async () => {
    try {
      setDurum(await pushDurum(true));
      setBuUc((await buCihaz())?.endpoint ?? null);
    } catch { setDurum({ acik: false, publicKey: null, abonelikler: [] }); }
  };
  useEffect(() => { yukle(); }, []);
  const yap = async (fn: () => Promise<{ ok: boolean; mesaj: string } | void>) => {
    setMesgul(true); setMesaj(null);
    try { const r = await fn(); if (r) setMesaj(r); } catch (e) { setMesaj({ ok: false, mesaj: e instanceof Error ? e.message : String(e) }); }
    finally { setMesgul(false); await yukle(); }
  };

  const buCihazAcik = !!durum?.abonelikler.some((a) => a.endpoint === buUc);
  const tarih = (s: string | null) => (s ? s.slice(0, 10).split("-").reverse().join(".") : "—");

  return (
    <div style={css.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Bildirimler</div>
      <div style={{ fontSize: 12.5, color: T.mut, marginBottom: 12, lineHeight: 1.5 }}>
        Düzenli giderler, kredi taksitleri, ekstre kesimi ve son ödemesinden <b>3 gün önce</b>, tutarıyla haber verir.
        Bildirimin içeriği bu cihazda şifrelenir; sunucu okuyamaz, yalnız zamanı gelince iletir.
      </div>

      {!destek ? (
        <div style={{ fontSize: 13, color: T.mut }}>
          {iosSekmede()
            ? <>iPhone'da bildirim yalnız ana ekrana eklenmiş uygulamada çalışır: Safari'de <b>Paylaş → Ana Ekrana Ekle</b>, sonra uygulamayı oradan aç.</>
            : "Bu tarayıcı bildirim desteklemiyor."}
        </div>
      ) : durum && !durum.acik ? (
        <div style={{ fontSize: 13, color: T.mut }}>Bildirimler sunucuda henüz yapılandırılmamış.</div>
      ) : izinEngelli && !buCihazAcik ? (
        <div style={{ fontSize: 13, color: T.mut }}>Bu tarayıcıda bildirim izni engelli. Tarayıcının site ayarlarından bu site için bildirim iznini açabilirsin.</div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {buCihazAcik ? (<>
            {/* durum kendi satırında: yanında iki düğmeyle 390px'te ikinci düğme rastgele alta kırılıyordu */}
            <span style={{ fontSize: 13, color: T.pos, fontWeight: 600, width: "100%" }}>Bu cihazda açık</span>
            <button style={css.ghost} disabled={mesgul} onClick={() => yap(denemeGonder)}>Deneme gönder</button>
            <button style={css.ghost} disabled={mesgul} onClick={() => yap(async () => { await bildirimKapat(); return { ok: true, mesaj: "Bu cihazda kapatıldı." }; })}>Bu cihazda kapat</button>
          </>) : (
            <button style={css.btn} disabled={mesgul || !durum} onClick={() => yap(bildirimAc)}>{mesgul ? "…" : "Bu cihazda aç"}</button>
          )}
        </div>
      )}
      {mesaj && <div style={{ fontSize: 12.5, color: mesaj.ok ? T.mut : T.neg, marginTop: 8 }}>{mesaj.mesaj}</div>}

      {!!durum?.abonelikler.length && (
        <div style={{ marginTop: 14 }}>
          <div style={{ ...css.label, marginBottom: 2 }}>Bildirim alan cihazlar</div>
          {durum.abonelikler.map((a, i) => (
            <Row key={a.id} last={i === durum.abonelikler.length - 1}>
              <span className="row-title" style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>
                {a.cihaz ?? "Cihaz"}{a.endpoint === buUc && <span style={{ color: T.acc, fontSize: 12 }}> · bu cihaz</span>}
                <span style={{ display: "block", fontSize: 11.5, color: T.mut3 }}>eklendi {tarih(a.created_at)} · son bildirim {tarih(a.son_basari)}</span>
              </span>
              <SilDugmesi ad={a.cihaz ?? "Cihaz"} title="Cihazı kaldır"
                onSil={async () => { await api.pushAboneSil(a.id); durumuTazele(); await yukle(); }}
                sonuc="Bu cihaza bir daha bildirim gitmez. Cihazın kendisinde yeniden açılabilir." />
            </Row>
          ))}
        </div>
      )}
    </div>
  );
}
