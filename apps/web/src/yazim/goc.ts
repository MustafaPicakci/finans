/* ============================================================================
   Şifreleme göçü — düz zarflar (p1) → şifreli zarflar (v1) (E2EE aşama 6)
   ----------------------------------------------------------------------------
   Aşama 5'in göçü veriyi sunucuda düz metin zarflara topladı. Onları şifrelemeyi sunucu
   yapamaz (anahtar yok), yani iş kullanıcının tarayıcısında, girişten sonra yapılır:
   sunucudan "hâlâ düz" satırları al → şifrele → DOĞRULA → geri yaz → bitince "tamam".

   Güvenlik ağları:
   • Her satır göndermeden ÖNCE geri çözülüp düz hâliyle karşılaştırılır. Şifreleme yolunda
     bir hata varsa veri sunucuya bozuk yazılmaz — göç durur, düz zarf yerinde kalır.
   • Sunucu yalnız hâlâ düz olan satırın üzerine yazar (arada şifreli yazılmışsa dokunmaz).
   • Yarıda kesilirse sorun değil: okuma tarafı p1 ve v1'i yan yana açar, bir sonraki
     açılışta kalan satırlardan devam edilir. Yeniden çalıştırılabilir, idempotent.
   • "Bitti" kararını sunucu verir: düz satır kalmadığını kendisi sayar.
   ============================================================================ */

import { ZARF_DUZ } from "@finans/crypto/map";
import { api } from "../api";
import { aktifAnahtar } from "./anahtar";
import { zarfSifrele, zarfIci } from "./zarf";

/** Göçü sonuna kadar yürütür. `ilerleme(n)`: şimdiye kadar şifrelenen satır sayısı. */
export async function sifrelemeGocu(ilerleme?: (n: number) => void): Promise<{ sifrelenen: number }> {
  const a = aktifAnahtar();
  if (!a) throw new Error("veri anahtarı yok");
  let toplam = 0;
  for (let tur = 0; tur < 1000; tur++) {
    const { tamam, satirlar } = await api.e2eeBekleyen();
    if (!satirlar.length) {
      if (!tamam) await api.e2eeTamam();
      return { sifrelenen: toplam };
    }
    const paket = await Promise.all(satirlar.map(async (x) => {
      if (!x.enc.startsWith(ZARF_DUZ)) throw new Error(`beklenmeyen zarf: ${x.tablo}`);
      const duz = JSON.parse(x.enc.slice(ZARF_DUZ.length));
      const enc = await zarfSifrele(x.tablo, duz, a);
      const geri = await zarfIci(enc, x.tablo, a);
      if (JSON.stringify(geri) !== JSON.stringify(duz)) throw new Error(`doğrulama başarısız: ${x.tablo}`);
      return { tablo: x.tablo, anahtar: x.anahtar, enc };
    }));
    const { guncellenen } = await api.e2eeSatirlar(paket);
    /* Hiç ilerleme yoksa döngüye girme: her tur aynı satırlar gelip yazılamıyorsa bu bir
       hatadır ve sessizce 1000 tur dönmek yerine görünür olmalı. */
    if (!guncellenen) throw new Error("şifreleme göçü ilerlemiyor");
    toplam += guncellenen;
    ilerleme?.(toplam);
  }
  throw new Error("şifreleme göçü bitmedi");
}
