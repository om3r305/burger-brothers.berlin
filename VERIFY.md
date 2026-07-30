# VERIFY — Schnellbestellung Location Fix

## Otomatik kontroller

Bu teslim hazırlanırken:

- Değiştirilen iki TypeScript/TSX dosyası TypeScript `transpileModule` ile syntax kontrolünden geçti.
- Middleware içinde dört müşteri API kuralının bulunduğu doğrulandı.
- `access-token` endpointinin public müşteri listesine eklenmediği doğrulandı.
- Paket içinde `.env`, secret, token veya müşteri verisi bulunmadığı doğrulandı.

## Projede çalıştırılacak kontroller

```powershell
cd C:\Web\burger
npm.cmd run typecheck
npm.cmd run schnell:test
npm.cmd run security:test
npm.cmd run build
```

GitHub PowerShell scripti bu kontrolleri commit ve push öncesinde otomatik çalıştırır.

## Manuel kabul testi

- Yeni kullanıcı: `Standort bestätigen` sonrasında iOS/Android izin penceresi görülür.
- Daha önce reddedilmiş kullanıcı: Genel hata yerine cihazına uygun izin adımları görünür.
- Düşük GPS doğruluğu: Mevcut ve izin verilen doğruluk metre olarak görünür.
- Süre aşımı: Tekrar deneme mesajı görünür; düğme kilitli kalmaz.
- Geçersiz QR: Güncel QR'ı yeniden tarama mesajı görünür.
- Dışarıdaki kullanıcı: Restaurant dışında sipariş verilemeyeceği mesajı görünür.
- Başarılı doğrulama: HttpOnly session cookie oluşturulur ve `/schnellbestellung` açılır.
- Menü katalog/session/order API istekleri telefonda middleware kaynaklı `401` almaz.
- Admin QR token endpointi public hale gelmez.
