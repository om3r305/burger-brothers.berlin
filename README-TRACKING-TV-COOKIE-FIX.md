# Burger Brothers Berlin — Tracking / TV Cookie Fix

## Sorunun gerçek nedeni

`app/track/[id]/page.tsx` içindeki müşteri takip sayfası doğru biçimde uzun kişisel token ile şu iki isteği gönderiyordu:

- `/api/track/lookup?trackingToken=<token>`
- `/api/track/by-order/<token>?trackingToken=<token>`

Ancak aynı Opera/Chrome profilinde `/tv` oturumu açıksa API isteklerinde TV cookie de gidiyordu. Backend önce TV/admin yetkisini kontrol ettiği için müşteri tokenini kullanmak yerine **operasyonel sipariş-ID aramasına** geçiyordu. Uzun tracking token, `Order.id` sanılarak aranıyor ve sipariş TV ekranında mevcut olduğu halde müşteri sayfası `Bestellung nicht gefunden` gösteriyordu.

## Uygulanan düzeltme

1. Açık bir kişisel tracking token varsa token araması artık admin/TV/driver cookie’lerinden önce gelir.
2. Token ile yapılan istek her zaman public DTO döndürür; TV cookie mevcut olsa bile müşteri sayfasına operasyonel müşteri/sipariş ayrıntıları sızmaz.
3. TV/admin doğrudan kısa sipariş numarasıyla yaptığı mevcut operasyonel aramaya devam eder.
4. Canlı sürücü konumu endpointi de aynı kurala bağlandı.
5. Prisma JSON-path sorgusu sonuç vermezse güvenli, parametreli PostgreSQL JSONB fallback kullanılır.
6. Eski `publicTrackingToken` kayıtları desteklenmeye devam eder.
7. Aynı tarayıcıda TV oturumu + müşteri tracking tokeni senaryosu için regresyon testi eklendi.

## Değiştirilmeyen işleyiş

- `app/track/[id]/page.tsx` değiştirilmedi; sorun bu sayfanın görsel/React akışında değildi.
- Sipariş oluşturma, ödeme finalize, ETA, TV statüleri, sürücü ataması ve tracking token üretimi değiştirilmedi.
- Kısa sipariş numarası public erişim anahtarı yapılmadı.
- Tracking token güvenlik kontrolü ve timing-safe karşılaştırma korunmuştur.
- Prisma schema ve migration değiştirilmedi.

## Kurulum

ZIP içeriğini klasör yapısını koruyarak doğrudan:

`C:\Web\burger`

üzerine çıkarın.

Sonra `PUSH-TRACKING-TV-COOKIE-FIX-TO-GITHUB.ps1` dosyasını yine doğrudan `C:\Web\burger` içinden çalıştırın.

## Doğrulama

Bu teslimatta aşağıdaki kontroller başarılı oldu:

- Tracking token/session-role regresyon testi
- Payment Center mimari regresyon testi
- Değişen iki route için TypeScript sözdizimi/transpile kontrolü
- package.json JSON doğrulaması

İnceleme ZIP’i tam proje içermediği için production build burada çalıştırılmadı. GitHub PowerShell gerçek `C:\Web\burger-github` repository’sinde Prisma generate, typecheck, güvenlik testleri ve production build başarılı olmadan commit/push yapmaz.
