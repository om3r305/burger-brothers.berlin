# VERIFY — Schnellbestellung iOS Home Screen V7

## Parametre kapalı testi

1. Admin parametresini kapatıp kaydedin.
2. iPhone kamerasıyla QR okutun.
3. Kurulum seçeneği görünmeden mevcut menü akışı açılmalıdır.
4. Android QR ve Web Push davranışı önceki sürümle aynı kalmalıdır.

## Parametre açık testi

1. Admin parametresini açıp kaydedin.
2. iPhone/iPad normal Safari veya Chrome sekmesinden QR okutun.
3. Şu iki seçenek görünmelidir:

```text
Direkt bestellen
Fertig-Benachrichtigung aktivieren
```

4. `Direkt bestellen` mevcut QR/session akışını açmalıdır.
5. Kurulum seçeneği, QR ve gerekiyorsa GPS doğrulamasından sonra Almanca dört
   adımlı Home Screen rehberini göstermelidir.

## Manifest ve ikon

Tarayıcıda şu adresler 200 dönmelidir:

```text
/manifest-schnellbestellung.webmanifest
/api/schnellbestellung/manifest
/schnell-icon-180.png
/schnell-icon-192.png
/schnell-icon-512.png
```

Boyutlar:

```text
180×180
192×192
512×512
```

Home Screen ikonu mevcut koyu Burger Brothers `apple-touch-icon` tasarımı
olmalıdır.

## Home Screen testi

1. Kurulum rehberinden `Zum Home-Bildschirm` seçin.
2. Burger Brothers ikonunu açın.
3. Geçerli session veya QR tokeni varsa menü açılmalıdır.
4. Konum kontrolü aktif ve session süresi dolmuşsa GPS yeniden doğrulanmalıdır.
5. Konum kontrolü kapalı ve token geçersizse güncel QR'ın yeniden okutulması
   istenmelidir.

## Bildirim testi

1. Siparişi Home Screen ikonundan açılan standalone uygulamada verin.
2. `Ja, bestellen` dokunuşundan sonra iOS bildirim iznini kabul edin.
3. Uygulamayı arka plana alın ve telefonu kilitleyin.
4. TV'de siparişi `Fertig` yapın.
5. Kilit ekranında sistem bildirimi görünmelidir.
6. Siparişi geri alıp tekrar `Fertig` yapın.
7. Yeni `readyEventId` nedeniyle ikinci bildirim de gelmelidir.

Not: iPhone'un sessiz anahtarı, Focus veya kullanıcı bildirim ayarları web
uygulaması tarafından zorla değiştirilemez.

## Otomatik kontroller

Teslimat hazırlanırken geçen kontroller:

```text
Targeted TypeScript/TSX syntax validation
Schnellbestellung regression tests
TV refactor regression tests
Middleware access matrix and CSP tests
Security regression tests
Session security tests
Manifest JSON validation
Icon dimension validation
Service Worker syntax check
Secret scan
ZIP content/checksum validation
```

Gerçek production `typecheck` ve `next build`, eksiksiz npm dependency ortamı
gerektirdiğinden teslimat container'ında tamamlanmadı. GitHub gönderim scripti
gerçek `C:\Web\burger-github` klasöründe typecheck, bütün güvenlik testleri ve
production build başarılı olmadan commit veya push oluşturmaz.

## DB

Prisma migration yoktur.
