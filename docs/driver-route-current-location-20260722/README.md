# Burger Brothers Berlin — Driver route current-location fix

## Amaç

Driver ekranındaki çok duraklı Google Maps rotası artık zorunlu olarak
Burger Brothers Berlin adresinden başlamaz.

Yeni rota:

- Şoförün güncel cihaz konumu
- Seçilen ilk teslimat
- Seçilen sonraki teslimatlar
- Son teslimat

## Değişiklik

Google Maps Directions URL içindeki sabit `origin` parametresi kaldırıldı.

Hem tek teslimat hem çok duraklı rota için:

- `api=1`
- `travelmode=driving`
- `dir_action=navigate`

kullanılır.

Google Maps, `origin` verilmediğinde ve cihaz konumu kullanılabildiğinde
başlangıç noktası olarak güncel cihaz konumunu kullanır.

## Korunan işleyiş

- PLZ önceliğine göre teslimat sırası
- Seçilen siparişler
- Tek ve çok duraklı rota
- iPhone, Android, PWA ve masaüstü açılışı
- Driver GPS tracking
- Sipariş claim/finish
- DB, Prisma, ödeme, TV ve tracking API'leri

değiştirilmemiştir.

## Değişmeyen ayarlar

`storeOrigin` ayarı settings yapısında geriye uyumluluk için kalabilir.
Driver rota URL'sine artık zorunlu başlangıç olarak gönderilmez.

## Konum izni kapalıysa

Google Maps cihaz konumuna erişemezse rota önizlemesi veya başlangıç
noktası seçme ekranı gösterebilir. Sistem bu durumda dükkânı sessizce
zorunlu başlangıç yapmaz.
