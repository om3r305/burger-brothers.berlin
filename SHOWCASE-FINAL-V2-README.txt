BURGER BROTHERS BERLIN — SHOWCASE FINAL V2
================================================

KURULUM
1. Bu ZIP içindeki dosyaları C:\Web\burger klasörüne çıkar.
2. Açık "npm run dev" penceresini kapat.
3. PowerShell ile çalıştır:

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Web\burger\APPLY-BUILD-AND-PUSH-SHOWCASE-FINAL-V2.ps1"

SCRIPT NE YAPAR?
- Yalnız bu teslimata ait dosyaları kendi içindeki doğrulanmış paketten uygular.
- Dosyalar kaynak ZIP alındıktan sonra değişmişse üzerine yazmadan durur.
- Değişecek kaynak dosyalarını önce yedekler.
- Showcase regresyon testlerini çalıştırır.
- TypeScript typecheck ve temiz production build çalıştırır.
- Bir test veya build başarısız olursa C:\Web\burger dosyalarını otomatik geri alır.
- Build başarılıysa yalnız bu teslimatta değişen dosyaları C:\Web\burger-github içine kopyalar.
- git init çalıştırmaz.
- Yalnız seçili dosyaları git add yapar, main branch'e commit ve push eder.

BU TESLİMATTA TAMAMLANANLAR
- Görünen sahne türleri 15'ten 11'e sadeleştirildi.
- QR + Google yorum QR tek sahnede varyant oldu.
- Video + sosyal video tek sahnede varyant oldu.
- Kampanya + geri sayım tek sahnede varyant oldu.
- Duyuru + özel gün tek sahnede varyant oldu.
- Kampanya seçilince başlık, rozet, oran ve tarihler DB'den otomatik gelir.
- Ürün akışı ürün sayısı ve toplam süreyle sınırlandırıldı.
- Menü kategorisi boş bırakılırsa tüm aktif kategoriler gösterilir.
- window.confirm tamamen kaldırıldı; özel onay modalı eklendi.
- validateDraft saf fonksiyon oldu.
- Ekran değiştirme race condition AbortController ve request-id ile kapatıldı.
- Undo/Redo seçili sahneyle birlikte atomik çalışır; yazı girişleri 750 ms içinde gruplanır.
- Ctrl+S, Ctrl+Z, Ctrl+Y, Delete kısayolları eklendi.
- Medya yükleme, yüklemeyi başlatan sahneye güvenli şekilde atanır.
- Admin dosyası 865 satıra indirildi ve 10 bileşen + hook/modüllere bölündü.
- Admin ve TV özel günleri aynı ortak preset dosyasından okur.
- Halloween, Weihnachten, Silvester, Ostern, Advent, Nikolaus, St. Martin,
  Alman Birliği Günü, 1 Mayıs, Dünya Kadınlar Günü Berlin, Muttertag,
  Vatertag, Oktoberfest, Berlin ve kış tasarımları eklendi.
- Özel günlerde manuel emoji, Cloudinary logo/görsel URL, başlık, alt başlık,
  rozet, metin, vurgu rengi ve manuel/otomatik tarih desteği eklendi.
- Hava durumu Open-Meteo Berlin-Tegel'den canlı gelir; 10 dakika cache ve
  son sağlam veri fallback'i kullanır; 0°C sahte fallback kaldırıldı.
- Hava ve saate göre düzenlenebilir hazır Almanca esprili metinler eklendi.
- Bestseller kaynağı/dönemi/ürün adetleri admin panelinde görünür.
- Google yorumlarında yalnız onaylı, minimum yıldız ve fotoğraf filtresi uygulanır.
- Countdown süresi bitince otomatik atlama veya "AKTION BEENDET" davranışı vardır.
- TV hafif sürüm polling'i, 5 dakikalık canlı veri yenilemesi ve ekran bazlı fallback kullanır.
- Admin ve player error boundary ile korunur.

GÜVENLİK
- .env, API anahtarı, token, Cloudinary secret, Google bilgileri, video, ses,
  node_modules, .next, .git veya DB dosyaları pakette yoktur.
- /dashboard dosyalarına dokunulmaz.
