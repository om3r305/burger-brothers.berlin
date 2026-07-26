# Burger Brothers Otomatik Web Push — Teslimat Notları

## Tamamlanan kapsam

- Mevcut Schnellbestellung VAPID yapılandırması yeniden kullanılır; yeni VAPID anahtarı üretilmez.
- `PushSubscription`, `NotificationPreference`, `NotificationCampaign`, `NotificationEvent` ve `NotificationDelivery` tabloları için güvenli, eklemeli Prisma migration'ları bulunur.
- Sipariş durumları müşteri cihazlarına otomatik bildirilir ve `sipariş + durum + cihaz` anahtarıyla tekrar gönderim engellenir.
- Kampanya, ürün/kategori Angebot, kişisel kupon ve admin duyurusu kendi kayıt akışından otomatik bildirim kuyruğuna bağlanır.
- İleri tarihli kampanyalar kalıcı olarak planlanır; bir kez gönderilen kayıt yalnız metin düzenlendi diye yeniden gönderilmez.
- Yakın teslimat sistemi aynı sokak, tanımlı sokak grubu, aynı PLZ, Brian rota kümesi ve yarıçap eşleşmesini destekler.
- Yakın teslimatta mevcut sipariş sahibi, aktif siparişi olanlar, izni kapalı olanlar ve cooldown süresindeki alıcılar dışarıda bırakılır. Bildirim yükünde müşteri adı, sipariş detayı veya açık adres bulunmaz.
- Pazarlama tercihleri varsayılan kapalıdır. Sipariş durumu izni ayrı tutulur.
- `/install` Android kurulum penceresi, iPhone Safari açıklaması, ana ekran modu, bildirim izni ve tercih yönetimini içerir.
- `/admin/notifications` manuel gönderim/test ekranı olarak korunur ve yakın teslimat ayarlarını yönetir.

## Veritabanı yayını

Production ortamında uygulama deploy edilmeden önce:

```powershell
npx prisma migrate deploy
```

Yeni migration mevcut bildirim migration'ını değiştirmez; yalnız gerekli yeni kolon ve indeksleri ekler.

## Gerekli doğrulama kapısı

```powershell
npm ci --no-audit --no-fund
npm run typecheck
npm run security:test
npm run schnell:test
npm run notifications:test
npm run build
```

Ayrı teslim edilen `burger-brothers-github-publish.ps1` bu adımları gerçek GitHub klonunda otomatik çalıştırır ve tamamı geçmeden commit/push onayı istemez.

## Planlı bildirim işleyicisi

Yetkili uç:

```text
GET /api/admin/cron/notifications
Authorization: Bearer <CRON_SECRET>
```

Vadesi gelen kayıtlar ayrıca ilgili admin/API trafiğinde ve mevcut günlük cron akışında işlenir. Kampanyanın başlangıç dakikasında kesin gönderim isteniyorsa bu uç, `CRON_SECRET` ile korunan sık çalışan bir scheduler tarafından çağrılmalıdır.

## Varsayılan güvenlik davranışı

- Kampanya, Angebot, kupon ve yakın teslimat izinleri kapalı başlar.
- Subscription endpoint'i yalnız aynı cihaz belirteciyle tercih günceller.
- Push URL'leri yalnız site içi güvenli yollar olarak kabul edilir.
- Geçersiz veya süresi dolmuş abonelikler pasif duruma alınır.
- Süresi dolan yakın teslimat fırsatları Service Worker tarafından gösterilmez.
