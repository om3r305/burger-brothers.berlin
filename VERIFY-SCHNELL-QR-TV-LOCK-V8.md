# V8 Doğrulama Listesi

## Otomatik kontroller

```powershell
npm ci
npm run typecheck
npm run schnell:test
npm run tv:refactor:test
npm run security:test
npm run build
```

GitHub push scripti bu kontrolleri commit ve push öncesinde çalıştırır.

## iPhone cihaz testi

1. Vercel deployment `Ready` olsun.
2. Ana ekrandaki eski Burger Brothers simgesini yalnız manifest/cache testi gerekiyorsa silip yeniden ekleyin.
3. Burger Brothers simgesini açın.
4. `QR-Code scannen` ekranının açıldığını doğrulayın.
5. Kamera iznini verin.
6. Restoran dışı bir QR okutun: reddedilmelidir.
7. Burger Brothers restoran QR kodunu okutun.
8. Konum kontrolü açıksa GPS izni ve doğrulamasından sonra menü açılmalıdır.
9. Sipariş verin ve uygulamayı kapatıp tekrar açın: aktif sipariş ekranı geri gelmelidir.
10. TV'de `Fertig` yapın; kilit ekranı bildirimi gelmelidir.
11. `Bestellung beenden` butonuna basın.
12. Safari kapatma hatası görünmemeli; ses/titreşim/polling durmalı ve yukarı kaydırma ekranı açılmalıdır.
13. Uygulamayı tekrar açın: eski sipariş yerine QR tarayıcı görünmelidir.

## Statik / dinamik QR testi

- Statik baskı QR çalışmalıdır.
- Dinamik QR aktif edildiğinde güncel token çalışmalıdır.
- Süresi dolmuş dinamik QR `invalid_qr` ile reddedilmelidir.
- GPS açıksa geçerli QR fakat restoran dışı konum reddedilmelidir.
- Ana ekran uygulaması token olmadan GPS ile doğrudan menü açmamalıdır.

## TV kilit testi

1. Bir Lieferung siparişini `done / Ausgegeben` yapın.
2. İlk 10 dakika içinde geri alma butonlarının açık olduğunu doğrulayın.
3. 10 dakika geçince butonların kilitlendiğini doğrulayın.
4. Aynı testi `VOR ORT` Schnellbestellung siparişiyle yapın.
5. Tarayıcıdan elle API isteği gönderilse bile TV oturumunda sunucu 409 `completed_order_locked` dönmelidir.
6. Admin oturumunun acil durum override yetkisi korunmalıdır.

## Not

Bu paket hazırlanırken kaynak dosyalar için TypeScript syntax transpile kontrolü, Schnellbestellung regression testi ve TV refactor regression testi çalıştırılmıştır. Gerçek iPhone kamera/GPS/push testi ve Vercel production build'i deployment sonrasında cihaz üzerinde doğrulanmalıdır.
