# Schnellbestellung iOS Push Prompt V7.1

Bu küçük düzeltme, V7 ana ekran akışında bildirim izninin görünmemesi sorununu
çözer.

## Sorunun nedeni

Safari adres çubuğu görünen ekran normal tarayıcıdır. iOS Web Push yalnız ana
ekrandan açılan standalone Burger Brothers web uygulamasında çalışır.

Önceki kod bildirim iznini yalnız son sipariş onay düğmesinde istiyor ve hata
durumunu kullanıcıya göstermiyordu.

## Yeni davranış

Ana ekrandaki Burger Brothers ikonundan açıldığında, session doğrulamasından
sonra özel bir ekran gösterilir:

```text
Fertig-Meldung aktivieren
[ Benachrichtigungen aktivieren ]
[ Ohne Benachrichtigung bestellen ]
```

Yeşil düğme doğrudan kullanıcı dokunuşunda:

1. iOS bildirim iznini ister.
2. Service Worker'ı hazırlar.
3. VAPID public key ile PushSubscription oluşturur.
4. Sonucu ekranda açıkça gösterir.
5. Başarıdan sonra menüyü açar.

Sipariş gönderildiğinde mevcut sistem aboneliği siparişe bağlar.

## Ek düzeltme

Push desteği kontrolünde yalnız `window.PushManager` globaline güvenilmez.
Service Worker registration üzerindeki gerçek `pushManager` kontrol edilir.
Bu, Safari/WebKit'te yanlış `desteklenmiyor` sonucunu engeller.

## Kurulum

ZIP içeriğini doğrudan:

```text
C:\Web\burger
```

üzerine çıkarın.

Yerel testten sonra yeni BAT dosyasını çalıştırın.

Prisma migration ve yeni environment variable yoktur.
V6'daki üç VAPID değişkeni kullanılmaya devam eder.
