# VERIFY — Schnell Push + Sipariş Limiti V6

## Sipariş limiti

- Cihaz limiti sorgusu Order.status ve meta.statusManual alanlarını birlikte okur.
- Yalnız new/preparing/ready aktif sayılır.
- done/completed/issued/cancelled tekrar siparişi engellemez.
- Idempotency ve API rate-limit aynen korunur.

## Push aboneliği

- `Ja, bestellen` kullanıcı hareketinde Notification izni best-effort istenir.
- İzin işlemi hata verse bile sipariş oluşturma fonksiyonu durmaz.
- Service Worker `/sw.js` scope `/` ile kaydedilir.
- Push config endpointi yalnız geçerli Schnellbestellung oturumunda çalışır.
- POST abonelik kaydı trusted-origin, rate-limit, session ve device ownership
  kontrollerinden geçer.
- Private VAPID key client'a dönmez.

## Ready push

- Her non-ready → ready geçişi yeni readyEventId üretir.
- Status route cevabı beklemeden `after()` ile push gönderimini planlar.
- Empty Web Push VAPID ES256 JWT ile gönderilir.
- Push endpointi 404/410 dönerse abonelik temizlenir.
- Service Worker pending endpointinden yalnız aynı cihazın son ready-event'ini alır.
- Notification tag readyEventId içerir; `renotify`, `requireInteraction`, ses ve
  titreşim talep edilir.
- Açık sayfalara BB_SCHNELL_READY_PUSH mesajı gider.

## Gizlilik ve DB

- Prisma schema değişmedi.
- PushSubscription yalnız Order.meta içinde tutulur.
- `.env`, key, token ve secret teslimat ZIP'inde yoktur.

## GitHub scripti

Commit öncesinde:

```text
npx prisma generate
npm run typecheck
npm run schnell:test
npm run tv:refactor:test
npm run security:test
npm run build
git diff --cached --check
```

Bir aşama başarısız olursa commit oluşturulmaz ve `C:\Web\burger-github`
yedekten geri yüklenir.
