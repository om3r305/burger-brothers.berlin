# Burger Brothers Berlin — Payment Center / Split Center

## Amaç

Bu teslimat, mevcut sipariş fiyatlama ve sipariş oluşturma zincirini koruyarak ödeme ekranlarını iki kesin alana ayırır:

- **Payment Center:** normal `Online-Zahlung`
- **Split Center:** `Getrennt zahlen`

Normal online ödeme ekranında WhatsApp veya pay paylaşımı bulunmaz. WhatsApp ve e-posta paylaşımı yalnız Split Center içindedir.

## Yeni akış

### Normal online ödeme

1. Checkout sunucu tarafında ürünleri, kampanyayı, kuponu, Pfand/surcharge değerlerini ve toplamı yeniden hesaplar.
2. Güvenli cihaz profiline bağlı kayıtlı Stripe PaymentMethod seçildiyse sunucu:
   - PaymentMethod’un doğru Stripe Customer’a ait olduğunu doğrular.
   - `PaymentIntent` oluşturur ve `confirm=true`, uygun kayıtlı ödeme kullanımı için `off_session=true` ile ödeme girişimi yapar.
3. Sonuç:
   - `succeeded`: hosted Stripe Checkout açılmadan Payment Center’a geçilir ve sipariş finalize edilir.
   - `processing`: Payment Center gerçek Stripe durumunu sorgulamaya devam eder.
   - `requires_action`: yalnız kısa `/payment/action` doğrulama ekranı açılır.
   - başarısız: Payment Center kayıtlı yöntemi yeniden deneme veya başka Stripe yöntemi seçme imkânı verir.
4. Kayıtlı yöntem yoksa veya kayıtlı yöntem artık kullanılamıyorsa güvenli Stripe Checkout fallback açılır.

### Split ödeme

- Organizatör `/payment/split` ekranında bütün kişileri ve ödeme durumlarını tek yerde görür.
- Her açık pay için `Jetzt bezahlen`, `Link kopieren`, WhatsApp ve e-posta işlemleri bulunur.
- Arkadaş linki `/pay/<token>` yalnız ilgili paya ödeme yetkisi verir; diğer kişilerin özel ödeme URL’leri dönmez.
- Kayıtlı yöntem varsa pay için doğrudan PaymentIntent denenir; gerektiğinde kısa doğrulama veya hosted Checkout fallback kullanılır.
- Ödenmiş pay tekrar başlatılamaz.
- Bütün paylar tamamlandığında sipariş yalnız bir kere finalize edilir ve tek sipariş olarak mutfak/TV zincirine gider.

## Güvenlik ve tutarlılık

- Başarı URL’si ödeme kanıtı olarak kullanılmaz.
- Stripe Checkout ve PaymentIntent durumları sunucudan okunur.
- Webhook imzası mevcut `STRIPE_WEBHOOK_SECRET` ile doğrulanır.
- `payment_intent.succeeded`, `payment_intent.processing`, `payment_intent.payment_failed` ve `payment_intent.canceled` olayları desteklenir.
- Aynı tarayıcı isteğinin ağ tekrarında ikinci pending ödeme yaratmaması için payment session kimliği request hash’inden deterministik üretilir.
- Aynı ödeme üzerinde eşzamanlı retry/double click işlemleri DB mutation lock ile engellenir.
- PaymentMethod’un Stripe Customer sahipliği doğrulanır.
- Stripe tutarı, para birimi (`eur`), session/order/share metadata değerleri finalize öncesi doğrulanır.
- 0,50 € altındaki pay Stripe’a sessizce 0,50 € olarak gönderilmez; işlem açık hata ile reddedilir.
- Stripe kaynağı gerçekten terminal duruma gelmeden checkout kilidi açılmaz.
- İptalde hosted Checkout expire edilir, açık PaymentIntent cancel edilmeye çalışılır ve terminal durum doğrulanır. Stripe hâlâ işlemi sonuçlandırıyorsa iptal tamamlanmış sayılmaz.
- Split oturumu süre dolduğunda daha önce tahsil edilmiş paylar otomatik iade akışına alınır.
- Tek bir başarısız/declined split denemesi, oturum hâlâ açıkken diğer kişilerin ödenmiş paylarını gereksiz yere iade etmez.
- Final sipariş idempotenttir; aynı Stripe olayı veya aynı ödeme session’ı ikinci sipariş oluşturmaz.
- Güvenli uzun tracking token müşteri takibi için kullanılır; kısa sipariş numarası tek başına erişim anahtarı değildir.

## Session ve geri dönüş

- Normal hosted/direkt ödeme dönüşü: `/payment/center`
- Split organizatör dönüşü: `/payment/split`
- Arkadaş payı dönüşü: `/pay/<token>`
- Kısa doğrulama: `/payment/action`
- Eski `/payment/return` sayfası yalnız doğru merkeze yönlendirme yapar.
- Payment recovery temel süresi mevcut ayarlarla, varsayılan olarak 30 dakikadır.
- Sayfa yenileme veya tarayıcı dönüşünde ekran DB + Stripe gerçek durumundan yeniden kurulur.
- `localStorage` yalnız recovery kolaylığı sağlar; ödeme gerçeğinin kaynağı değildir.

## Stripe ortam değişkenleri

Değerler ZIP veya GitHub paketine eklenmez. Gerçek projede/Vercel’de mevcut olmalıdır:

- `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` veya sunucu fallback’i olarak `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_BASE_URL` (canlıda `https://www.burger-brothers.berlin`)

Aynı deploy içinde test ve live anahtarları karıştırılmamalıdır. PayPal kayıtlı/gelecekte kullanım davranışı Stripe hesabının test ve live modlarındaki PayPal yetkilerine ayrı ayrı bağlıdır; canlıya geçmeden önce Stripe Dashboard’da live PayPal ve future/recurring kullanım uygunluğu kontrol edilmelidir.

## Kurulum

1. ZIP içeriğini klasör yapısını koruyarak doğrudan `C:\Web\burger` üzerine çıkarın.
2. `.env` veya `.env.local` dosyalarını ZIP’ten beklemeyin; mevcut gerçek proje dosyaları yerinde kalır.
3. Önce gerçek proje üzerinde normal test akışlarını çalıştırın.
4. GitHub gönderimi için `C:\Web\burger\PUSH-PAYMENT-CENTER-TO-GITHUB.ps1` dosyasını Windows PowerShell 5.1 ile çalıştırın.

Script ZIP/fix klasöründen değil, doğrudan `C:\Web\burger` içinden çalıştırılmalıdır.

## Veritabanı

Bu teslimatta `prisma/schema.prisma` veya migration değişikliği yoktur. Mevcut Order/meta tabanlı pending ödeme modeli korunmuştur.

## Önemli doğrulama

İnceleme ZIP’i bütün proje dosyalarını ve Prisma binary/client üretimini içermediği için burada tam production build çalıştırılamadı. Teslim edilen GitHub PowerShell gerçek `C:\Web\burger` projesinde aşağıdaki adımların tamamı başarılı olmadan commit veya push yapmaz:

1. `npx.cmd prisma generate`
2. `npm.cmd run typecheck`
3. `npm.cmd run security:test`
4. `npm.cmd run build`
