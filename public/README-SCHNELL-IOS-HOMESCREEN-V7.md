# Burger Brothers Schnellbestellung — iOS Home Screen V7

Bu teslimat, mevcut Android Web Push akışını değiştirmeden iPhone/iPad için
ücretsiz Home Screen web uygulaması akışını ekler.

## Admin parametresi

Admin → Schnellbestellung alanına şu parametre eklendi:

```text
iPhone ana ekran yönlendirmesi aktif
```

Varsayılan değer `kapalı`dır.

### Parametre kapalıyken

- iPhone/iPad QR okutunca eski akış doğrudan devam eder.
- Kurulum veya yönlendirme ekranı görünmez.
- Android davranışı değişmez.
- Mevcut açık sayfa sesi ve Android Web Push aynen çalışır.

### Parametre açıkken

Yalnız iPhone/iPad normal tarayıcı sekmesinde iki seçenek görünür:

```text
Direkt bestellen

Fertig-Benachrichtigung aktivieren
```

`Direkt bestellen` seçilirse müşteri mevcut Safari/Chrome akışından devam eder.

`Fertig-Benachrichtigung aktivieren` seçilirse geçerli QR ve gerekiyorsa konum
önce doğrulanır; ardından Almanca Home Screen kurulum adımları gösterilir.

## Ayrı Schnellbestellung manifesti

Schnellbestellung için ana site, kurye ve TV manifestlerinden bağımsız manifest
hazırlandı:

```text
/manifest-schnellbestellung.webmanifest
/api/schnellbestellung/manifest
```

Özellikler:

```text
display: standalone
scope: /schnellbestellung/
id: /schnellbestellung/?app=schnellbestellung
```

QR sayfası server tarafında QR tokenini içeren dinamik manifest bağlantısı
üretir. Bu sayede Home Screen ikonu ilk açılışta aynı geçerli QR yetkisini
kullanabilir.

Statik QR kullanılıyorsa kayıtlı başlangıç bağlantısı, admin sabit QR'ı
yenileyene kadar sonraki ziyaretlerde de geçerlidir.

Dinamik QR kullanılıyorsa token normal süresinde sona erer. Konum kontrolü
aktifse Home Screen uygulaması restoranda GPS doğrulaması yaparak yeni session
açabilir. Konum kontrolü kapalıysa süresi dolan dinamik QR sonrasında QR'ın
yeniden okutulması gerekir.

## Sonraki ziyaret akışı

iOS, QR bağlantısından Home Screen web uygulamasını otomatik açmaya izin
vermediği için QR yine tarayıcıda açılır.

Daha önce kurulum yönlendirmesini kullanan cihazda şu bilgi gösterilir:

```text
Burger Brothers bereits eingerichtet?
Schließen Sie den Browser und öffnen Sie das
Burger-Brothers-Symbol auf Ihrem Home-Bildschirm.
```

Müşteri ikona dokunduğunda:

- Geçerli Schnellbestellung session varsa doğrudan menü açılır.
- Session yenilemesi gerekiyorsa ve konum kontrolü açıksa GPS doğrulanır.
- Konum kontrolü kapalıysa manifestte saklanan geçerli statik QR tokeni kullanılır.
- Token geçersizse güncel QR'ın yeniden okutulması istenir.

## Push bildirimi

Yeni bir push sistemi kurulmadı; V6'daki standart Web Push altyapısı kullanılır.

Home Screen uygulamasında müşteri siparişi gönderirken tarayıcının gerçek
bildirim izni istenir. İzin verilirse:

```text
Home Screen uygulaması kapalı
Başka uygulama açık
Telefon kilitli
→ Fertig Web Push bildirimi
```

çalışabilir.

Aynı sipariş `Fertig → Neu/In Vorbereitung → tekrar Fertig` yapılırsa mevcut
`readyEventId` sistemi yeni olay üretir ve tekrar bildirim gönderir.

Gerekli mevcut Vercel değişkenleri:

```text
NEXT_PUBLIC_VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
```

V6 kurulmuşsa yeni environment variable gerekmez.

## İkonlar

Kullanıcının mevcut:

```text
public/apple-touch-icon.png
```

görseli kaynak alınarak oluşturuldu:

```text
public/schnell-icon-180.png
public/schnell-icon-192.png
public/schnell-icon-512.png
```

Ana site, kurye ve mevcut `apple-touch-icon.png` dosyası değiştirilmedi.

## Güvenlik

- Admin parametresi mevcut `Setting` JSON kaydında saklanır.
- Prisma şeması ve DB migration yoktur.
- Normal browser akışı imzalı QR tokeni istemeye devam eder.
- Tokensız Home Screen yenilemesi yalnız parametre ve GPS kontrolü aktifken,
  Apple mobil user-agent ile ve mevcut yarıçap/doğruluk kontrollerinden geçerek
  yapılabilir.
- Konum kontrolü kapalıyken tokensız Home Screen session açılamaz.
- Canonical fiyat, rate limit, idempotency ve order güvenliği değiştirilmedi.
- Secret veya VAPID private key pakete eklenmedi.

## Kurulum

1. Çalışan development terminalini `Ctrl + C` ile durdurun.
2. ZIP içeriğini doğrudan `C:\Web\burger` üzerine çıkarın.
3. Dosya değiştirme sorusuna onay verin.
4. Yerel kontrol:

```powershell
cd C:\Web\burger
npm.cmd run dev
```

5. Admin → Schnellbestellung ekranına girin.
6. `iPhone ana ekran yönlendirmesi aktif` parametresini açıp kaydedin.
7. Gerçek iPhone ile QR akışını test edin.
8. Kontrol tamamlanınca:

```text
RUN-SCHNELL-IOS-HOMESCREEN-V7-GITHUB-PUSH.bat
```

dosyasına çift tıklayın.

PowerShell içeriğini terminale yapıştırmayın; BAT dosyasını çalıştırın.
