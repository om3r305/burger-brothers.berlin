# Burger Brothers Schnellbestellung — iPhone konum düzeltmesi

Bu teslim yalnız iki proje dosyasını değiştirir:

- `app/schnellbestellung/enter/page.tsx`
- `middleware.ts`

## Bulunan iki ayrı sorun

1. iPhone/Safari konum izni daha önce reddedilmişse Safari aynı site için izin penceresini yeniden göstermeyebilir. Eski ekran bütün konum hatalarını tek bir genel mesaj altında topluyordu.
2. Schnellbestellung müşteri API yolları middleware içinde açıkça public olarak tanımlanmamıştı. Konum izni başarılı olsa bile telefondan gelen doğrulama isteği admin yetkisi bekleyerek `401` dönebilirdi.

## Yapılan düzeltmeler

- Konum isteği yalnız kullanıcı düğmeye bastığında başlatılır.
- Safari izin durumu desteklendiği ölçüde önceden kontrol edilir.
- `PERMISSION_DENIED`, `POSITION_UNAVAILABLE` ve `TIMEOUT` ayrı yönetilir.
- iPhone için ekranda doğrudan Safari konum izni adımları gösterilir.
- Tek ölçüm yerine en iyi GPS doğruluğunu bekleyen kısa süreli `watchPosition` akışı kullanılır.
- Düşük doğrulukta mevcut ve gerekli metre değerleri gösterilir.
- HTTPS, browser desteği, Permissions Policy, ağ zaman aşımı ve API hataları ayrı gösterilir.
- LocalStorage kapalıysa cihaz kimliği güvenli bir geçici fallback ile oluşturulur.
- Aşağıdaki müşteri API yolları middleware katmanında public yapılır; kendi route güvenlikleri korunur:
  - `POST /api/schnellbestellung/location/verify`
  - `GET /api/schnellbestellung/session`
  - `GET /api/schnellbestellung/catalog`
  - `POST /api/schnellbestellung/orders`
- `/api/schnellbestellung/access-token` public yapılmadı; QR ekranı için korumalı kaldı.

## Değiştirilmeyen dosyalar

`next.config.mjs` incelendi. Mevcut `Permissions-Policy: geolocation=(self)` başlığı doğru olduğu için değiştirilmedi.

Konum doğrulama route'u ve `lib/server/schnellbestellung.ts` incelendi; bu hata için değişiklik gerekmedi.

## Kurulum

ZIP içeriğini doğrudan şu klasöre çıkarın ve iki dosyanın üzerine yazılmasını onaylayın:

```text
C:\Web\burger
```

Sonra geliştirme sunucusunu yeniden başlatın:

```powershell
cd C:\Web\burger
npm.cmd run dev
```

## iPhone testi

1. Güncel dinamik QR kodunu Kamera ile okutun.
2. `Standort bestätigen` düğmesine basın.
3. İzin penceresi çıkarsa konuma izin verin ve `Genauer Standort` seçeneğini açık tutun.
4. Site daha önce reddedildiyse ekrandaki Safari adımlarını uygulayıp düğmeye yeniden basın.
5. Başarılı doğrulamada `/schnellbestellung` menüsüne yönlendirilmelidir.

Tarayıcı daha önce verilen bir `Deny/Nicht erlauben` kararını web sayfasının zorla sıfırlamasına izin vermez. Bu nedenle kod, izin penceresini zorlamak yerine doğru ayar adımlarını gösterir ve izin açıldıktan sonra tekrar dener.
