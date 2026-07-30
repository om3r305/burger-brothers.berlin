# Burger Brothers Schnellbestellung – Complete V2

Bu teslim yalnız Schnellbestellung, ilgili TV görünümü/sesi/pause ve mevcut sipariş liste/status uyumluluğu üzerinde çalışır. Normal Menü, Abholung, Lieferung, Stripe, Split Center ve driver akışına yeni bir işleyiş eklenmemiştir.

## Bu teslimde tamamlananlar

### Müşteri menüsü
- Kategori sırası ana menü ile aynı hale getirildi: Burger → Vegan / Vegetarisch → Extras → Soßen → Hot Dogs → Getränke → Donuts → Bubble Tea.
- DB kategorileri farklı yazılmış olsa da Schnellbestellung tarafında normalize edilir.
- Ürün kartlarında içerik/açıklama gösterilir.
- Alerjen kodları ürün kartında görünür; ürün penceresinde kodların Almanca açıklamaları ve ürüne özel alerjen notları gösterilir.
- Yalnız temel masa sosları olan `Ketchup`, `Mayo` ve `Mayonnaise` Schnellbestellung Soßen kategorisinden gizlenir. Chili-Mayo, Trüffel-Mayo gibi özel soslar gizlenmez.
- Sepet ve ürün penceresi mobile-first çalışır.
- `Bestellung abschließen` sonrasında özel onay penceresi çıkar; browser `confirm()` kullanılmaz.
- Aynı sepetin bağlantı kopması sonrası tekrar gönderiminde aynı idempotency key yeniden kullanılır.
- Başarı ekranına `Bestellung beenden` butonu eklendi. Tarayıcı sekmesi script tarafından kapatılamazsa ana sayfaya döner.

### Schnellbestellung kampanyaları
- Admin Schnellbestellung panelinde yalnız bu kanala özel kampanya bölümü vardır.
- Kategori yüzde indirimi, ürün yüzde indirimi ve ürün sabit Angebot fiyatı desteklenir.
- Başlangıç/bitiş tarihi, aktif/pasif ve rozet metni ayarlanabilir.
- Menü fiyatı ile server canonical sipariş fiyatı aynı kampanya motorunu kullanır.
- Normal Abholung/Lieferung kampanyaları otomatik olarak Schnellbestellung'a uygulanmaz.

### Statik ve dinamik QR
- `Statik baskı QR`: masa sticker/baskıları için süre aşımı olmayan, imzalı ve gerektiğinde iptal edilebilir QR.
- `Dinamik ekran QR`: belirlenen sürede otomatik yenilenen QR.
- Statik QR'da da GPS, oturum, rate-limit, server fiyatlandırma ve idempotency kontrolleri devam eder.
- QR ekranından PNG, SVG indirme ve yazdırma vardır.
- `Sabit QR'ı yenile` eski basılı QR'ı geçersiz kılar.
- `Tüm oturumları iptal et` mevcut müşteri oturumlarını ve dinamik QR neslini iptal eder; statik basılı QR ayrıca yenilenmedikçe kullanılmaya devam eder.

### TV
- Schnellbestellung siparişi artık `Lieferung` değil `VOR ORT` olarak sınıflandırılır.
- Kabul ekranında ETA/dakika seçimi gösterilmez ve dine-in siparişine sahte ETA yazılmaz.
- Büyük müşteri numarası, Berlin sipariş saati, ürünler, extras/notlar, toplam ve detaylar görünür.
- Status akışı: Neu → In Vorbereitung → Fertig → Ausgegeben.
- `out_for_delivery` dine-in için hem UI'da hem status API'de engellidir.
- Bestellübersicht/TV sidebar içinde Schnellbestellung'a özel ses aç/kapat ve test kontrolü vardır.
- Ayrı `dine-in.wav` sesi eklendi; bulunamazsa pickup sesi güvenli fallback olarak kalır.
- Lieferung ve Abholung pause kontrollerinin yanına Schnellbestellung pause eklendi.
- Driver listesi yalnız delivery siparişlerini almaya devam eder.

## DB durumu
Prisma şeması değiştirilmedi ve migration yoktur. QR modu, kampanyalar ve Schnellbestellung ayarları mevcut `Setting` JSON kaydında tutulur. Günlük müşteri numarası mevcut transaction tabanlı sayaç mantığını kullanır.

## Kurulum
ZIP içeriğini proje-relative yapıyı koruyarak doğrudan:

`C:\Web\burger`

klasörünün üzerine çıkarın ve dosyaların değiştirilmesini onaylayın. `.env`, `.env.local`, secret veya müşteri verisi bu teslimde bulunmaz.

Dev test için:

```powershell
cd C:\Web\burger
npm.cmd run dev
```

GitHub gönderimi için ZIP kökündeki `RUN-SCHNELLBESTELLUNG-COMPLETE-V2-GITHUB-PUSH.bat` dosyasına çift tıklayın veya PowerShell dosyasını `-File` ile çalıştırın. Script içeriğini terminale satır satır yapıştırmayın.

## Canlıya geçmeden önce
Ev koordinatıyla test bittikten sonra admin panelinde gerçek Burger Brothers konumunu ve operasyon değerlerini geri girin. Önerilen üretim başlangıcı: GPS yarıçapı 100 m, maksimum accuracy 75 m. Statik QR'ları ancak gerçek koordinatlar kaydedildikten sonra basın.
