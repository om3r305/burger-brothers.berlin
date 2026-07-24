# Burger Brothers Schnellbestellung V2.3

Bu hedefli teslimat dört sorunu birlikte düzeltir:

1. TV'de Schnellbestellung siparişlerinin Lieferung görünmesi
2. Getränke ve Extras kategorilerinin Schnellbestellung menüsünde görünmemesi
3. QR okutulduktan sonra ayrıca “Standort bestätigen” butonuna basılması
4. Menü kataloğunun yavaş/boş görünmesi

## Temel değişiklikler

- TV sipariş türü yalnız Order.mode alanına bağlı değildir. channel,
  meta.source ve customerNumber sinyalleriyle Schnellbestellung güvenli biçimde
  VOR ORT olarak normalize edilir.
- Getränke ve Extras, mevcut bb_drink_groups_v1 / bb_extra_groups_v1
  Setting kayıtlarından okunur.
- Grup variantları güvenli sanal ürün kimliğiyle kataloğa eklenir ve sipariş
  sırasında server tarafından tekrar doğrulanıp fiyatlandırılır.
- İçecek Pfand tutarı canonical fiyata dahil edilir ve açıklamada gösterilir.
- QR giriş sayfası izin daha önce verilmişse GPS'i otomatik doğrular ve menüyü
  doğrudan açar. İlk cihazda yalnız tarayıcının doğal konum izin penceresi kalır.
- Ayrı session isteği kaldırılmıştır; katalog endpointi session'ı zaten doğrular.
- Son sağlam katalog cihazda kısa süreli saklanır ve hemen gösterilir.
- Server tarafında 12 saniyelik güvenli katalog memory cache kullanılır.
- İlk ürün görselleri eager, kalanlar lazy yüklenir.
- Eski visibleCategories kaydı, admin ekranından yönetilemediği için yeni
  Getränke/Extras kategorilerini kalıcı biçimde saklamaz.

## DB

Prisma migration yoktur. Mevcut Product, Setting ve Order altyapısı kullanılır.

## Kurulum

ZIP içeriğini doğrudan C:\Web\burger klasörünün üzerine çıkarın.

Yerel kontrol:
    cd C:\Web\burger
    npm.cmd run dev

GitHub gönderimi:
    RUN-SCHNELLBESTELLUNG-V2.3-GITHUB-PUSH.bat

PowerShell içeriğini terminale yapıştırmayın; BAT dosyasını çalıştırın.
