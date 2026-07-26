# Burger Brothers – Schnellbestellung QR Scanner + TV Lock V8

## Yeni müşteri akışı

### İlk iPhone ziyareti

1. Müşteri dükkândaki QR kodunu Safari ile okutur.
2. İster doğrudan tarayıcıdan sipariş verir, ister Burger Brothers'ı ana ekrana ekler.
3. Kurulum ekranı Safari Paylaş → Zum Home-Bildschirm → Hinzufügen adımlarını açıkça gösterir.
4. Müşteri Burger Brothers ana ekran simgesini açar.
5. Uygulamadaki **QR-Code scannen** butonuna basıp restoran QR kodunu tekrar okutur.
6. Sunucu QR tokenini doğrular.
7. Admin ayarında konum kontrolü açıksa GPS doğrulaması yapılır.
8. Bildirim izni yoksa Fertig bildirimi için izin ekranı gösterilir.
9. Menü açılır.

### Sonraki ziyaretler

1. Burger Brothers ana ekran simgesi açılır.
2. Aktif bir sipariş varsa doğrudan sipariş durum ekranı açılır.
3. Aktif sipariş yoksa uygulama içi QR tarayıcı açılır.
4. Her yeni sipariş oturumu için güncel restoran QR kodu zorunludur.

## QR güvenliği

- GPS tek başına yeni sipariş oturumu açmaz.
- Home Screen/PWA modu token zorunluluğunu atlamaz.
- Statik ve dinamik QR tokenleri aynı sunucu doğrulamasından geçer.
- Gelecekte dinamik QR açıldığında uygulama içi tarayıcı değişmeden çalışır.
- Yalnız Burger Brothers Schnellbestellung adresi ve izin verilen resmi domainler kabul edilir.
- Konum kontrolü aktifse QR + GPS birlikte gereklidir.

## Kamera

- `Permissions-Policy` artık yalnız aynı origin için `camera=(self)` izni verir.
- Arka kamera tercih edilir.
- Canlı tarama başarısızsa “Foto des QR-Codes aufnehmen” yedeği bulunur.
- QR çözümleme `qr-scanner` 1.4.2 ile yapılır; iOS'ta BarcodeDetector olmasa da worker fallback kullanır.

## Aktif sipariş devamı

- Sipariş oluşturulunca cihazda yalnız order id, müşteri numarası ve kayıt zamanı saklanır.
- Ana ekran uygulaması tekrar açılırsa geçerli oturum üzerinden siparişin gerçekten aynı cihaza ait olduğu sunucuda doğrulanır.
- Doğrulanan aktif sipariş doğrudan status ekranına döner.
- Sipariş “Bestellung beenden” ile kapatıldığında geçici aktif sipariş işareti temizlenir.

## Bestellung beenden

Eski `Seite schließen` / `window.close()` akışı kaldırıldı. iOS'un engellediği otomatik kapatma artık denenmez ve Safari hata mesajı gösterilmez.

Butona basıldığında:

- polling durur,
- Wake Lock bırakılır,
- tekrar eden sesler durur,
- titreşim durdurulur,
- geçici aktif sipariş verisi temizlenir,
- temiz bir “Bestellung abgeschlossen” ekranı ve yukarı kaydırma yönlendirmesi gösterilir.

Yeni sipariş butonu eklenmemiştir.

## TV tamamlanmış sipariş kilidi

- `done / Ausgegeben` siparişi ilk 10 dakika içinde TV'den geri alınabilir.
- 10 dakika sonra `Neu`, `In Vorbereitung`, `Fertig` veya `Unterwegs` durumuna dönemez.
- Kural Lieferung, Abholung ve VOR ORT siparişlerinin tamamına uygulanır.
- Kontrol yalnız UI'da değildir; `/api/orders/status` sunucu tarafında da 409 `completed_order_locked` döndürür.
- Admin oturumu acil durum override yetkisini korur.
- Eski ve tamamlanma zamanı güvenilir biçimde bulunamayan terminal siparişler kilitli kabul edilir.

## Korunan mevcut özellikler

- Çalışan iOS Home Screen Web Push ve VAPID akışı korunmuştur.
- Fertig → geri alma → tekrar Fertig yeni readyEventId üretmeye devam eder.
- Android normal QR tarayıcı akışı otomatik devam eder.
- Admin statik/dinamik QR seçenekleri korunur.
- Sipariş fiyatlandırma, menü, ödeme ve TV işleyişine gereksiz değişiklik yapılmamıştır.
