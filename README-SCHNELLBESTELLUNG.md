# Burger Brothers Schnellbestellung

## Eklenenler
- `/schnellbestellung/access-display`: dinamik QR ekranı
- `/schnellbestellung/enter`: QR + GPS doğrulama
- `/schnellbestellung`: mobil iki sütun DB-first menü ve kalıcı cihaz sepeti
- Cash siparişlerinde server-side ürün/extra fiyat kontrolü
- Berlin tarihine göre transaction içinde günlük müşteri numarası
- HttpOnly imzalı kısa süreli salon oturumu
- QR generation ile tüm oturumları anında iptal etme
- Cihaz/session rate limit ve idempotency
- `mode=dine_in`, `channel=schnellbestellung`, `source=qr_quick_order`
- TV kartında büyük müşteri numarası ve VOR ORT etiketi
- Driver ekranından mevcut delivery filtresi sayesinde tam ayrım
- Print job ve print-proxy içinde büyük numara, SALONBESTELLUNG ve BAR OFFEN
- Ayrı Türkçe admin ekranı

## Migration
Prisma migration eklenmedi. Mevcut `Order`, `Setting`, `Product` modelleri kullanıldı. Günlük sayaç `Setting` anahtarında Berlin business-date ile tutulur.

## İlk açılış
1. Admin > Schnellbestellung sayfasını açın.
2. Dükkân koordinatlarını `.env` içinde `SCHNELLBESTELLUNG_SHOP_LAT` ve `SCHNELLBESTELLUNG_SHOP_LNG` olarak tanımlayın veya varsayılan koordinatları koddan doğrulayın.
3. `SESSION_SECRET` / `AUTH_SECRET` değerlerinden en az biri Vercel'de bulunmalıdır.
4. Sistemi ve Barzahlung seçeneğini açıp kaydedin.
5. QR ekranını açın.

## Ödeme kapsamı
Bu teslimde canlı finalize edilen ödeme yöntemi **Barzahlung**dır. Admin veri modeli online/split ayrımını saklar; ancak online veya split toggle açılması müşteri akışında ödeme başlatmaz. Mevcut Stripe Payment Center'a güvenli bağlama, ödeme başarısından sonra numara üretme ve webhook idempotency ayrı bir ikinci aşama olarak bırakılmıştır. Bu sınırlama kasıtlıdır; ödeme tamamlanmadan sipariş/numara/fiş oluşmaması şartını bozacak yarım bir entegrasyon eklenmemiştir.

## QR ekranı V1.1 düzeltmesi

QR alanının boş görünmesine neden olan sessiz bekleme kaldırıldı. Sistem kapalı,
duraklatılmış, güvenli oturum anahtarı eksik veya API geçici olarak erişilemez
olduğunda QR ekranı artık gerçek nedeni Almanca olarak gösterir ve yeniden deneme
butonu sunar.

Sistem güvenlik nedeniyle ilk kurulumda otomatik açılmaz:

1. `/admin/schnellbestellung` sayfasını açın.
2. **Sistem aktif** ve **Barzahlung aktif** seçeneklerini açın.
3. Dükkân enlem/boylam değerlerini doğrulayın.
4. Ayarları kaydedin.
5. `/schnellbestellung/access-display` sayfasında **Erneut versuchen** butonuna basın veya en fazla 60 saniye bekleyin.

`SESSION_SECRET`, `NEXTAUTH_SECRET` veya `AUTH_SECRET` değerlerinden en az biri
yerel `.env.local` ve Vercel ortamında tanımlı olmalıdır.

### Localhost uyarısı

Yerel QR ekranı `http://localhost:3000` adresinden açılmışsa üretilen QR da
`localhost` içerir. Başka bir telefon için `localhost` o telefonun kendisi
demektir ve PC'deki projeye bağlanamaz. Gerçek telefon testi güvenli preview/live
domain üzerinden yapılmalıdır. GPS API'si de telefonlarda güvenli HTTPS bağlantısı
ister.

## Admin kayıt yetkisi V1.2 düzeltmesi

Admin ayar ekranında veriler okunabildiği halde **Ayarları kaydet** işleminin
`401 Unauthorized` dönmesine neden olan rol parametresi düzeltildi.
`requireMutationRole` yardımcı fonksiyonu rol listesi beklediği için artık
`["admin"]` ile çağrılır. Böylece geçerli admin oturumu bulunan aynı sekmede
PUT isteği kabul edilir ve Schnellbestellung ayarları DB'ye kaydedilir.

## V1.3 TV sound compatibility

`dine_in` artık TV ses türlerinde eksiksiz desteklenir. Ayrı salon ses dosyası sağlanana kadar restoran içi siparişler mevcut pickup sesini kullanır; ancak ayrı audio ref ve ayrı sound kind sayesinde daha sonra salon sesine geçiş hook refactor gerektirmez.
