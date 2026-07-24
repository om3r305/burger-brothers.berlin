# VERIFY — Schnellbestellung V2.3

## TV
- Yeni veya eski Schnellbestellung siparişi VOR ORT görünür.
- Lieferung ETA düğmeleri Schnellbestellung kartında görünmez.
- Büyük müşteri numarası ve sipariş saati korunur.
- out_for_delivery geçişi server tarafında reddedilir.

## Katalog
- Burger/Vegan normal Product kayıtlarından gelir.
- Getränke bb_drink_groups_v1 Setting kaydından gelir.
- Extras bb_extra_groups_v1 Setting kaydından gelir.
- Pasif veya tarihi geçmiş grup/variant görünmez.
- Pfand fiyatı server ve müşteri ekranında aynıdır.
- Ketchup ve sade Mayo gizli kalır.
- Grup variantı siparişte DB/Setting kaynağından yeniden doğrulanır.

## Hız
- Menü açılırken ayrı /session isteği yapılmaz.
- Cihaz cache'i varsa ürünler anında görünür.
- Server memory cache kısa süreli çalışır.
- İlk görseller öncelikli, diğer görseller lazy yüklenir.
- Boş ekran yerine skeleton veya açıklayıcı mesaj görünür.

## QR
- Konum izni daha önce verilmişse QR sonrası otomatik menü açılır.
- İlk cihazda tarayıcının konum izin penceresi gösterilebilir.
- Konum/GPS güvenliği kaldırılmamıştır.
- Hata halinde “Erneut versuchen” düğmesi görünür.

## Test
GitHub scripti commit öncesinde:
- prisma generate
- npm run typecheck
- npm run schnell:test
- npm run security:test
- npm run build
çalıştırır. Herhangi biri başarısız olursa commit oluşturmaz.
