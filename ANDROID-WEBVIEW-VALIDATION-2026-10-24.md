# Android WebView test sonucu — 24.10.2026

## Durum

Üç uygulama için yerel Android WebView test kabuğu ve ayrı test APK'ları hazır. Chrome/TWA açılışı kullanılmıyor. Play veya üretim web dağıtımı yapılmadı. Tam geçiş henüz yayına hazır değil; aşağıdaki engeller korunuyor.

Çalışma: `codex/android-webview-suite`, taban `2963ea9feaaddd49b6f2a6513d0032368f438594`, klasör `C:\Web\burger-webview`. Eski `C:\Web\burger-github` çalışma ağacındaki kaydedilmemiş değişikliklere dokunulmadı.

## Yapılanlar

- `mobile/android/webview-suite/`: üç flavor, native Activity/WebView, güvenli origin yönlendirmesi, klavye/sistem çubuğu insets, geri tuşu, kamera/konum izinleri, hata ekranı, Gradle wrapper, derleme/test betikleri.
- `lib/client/native-android.ts`, `pwa-compat.ts`, CustomerAppBootstrap ve Schnell entry/client/install bileşenleri: Android native kurulum algılama; desteklenmeyen Web Push aktivasyon teklifinin önlenmesi. Bu bir yetkilendirme mekanizması değildir.
- URL politikası JVM regresyonu, native algılama testi, derlenmiş manifest izolasyon testi, Android WebView üzerinde görünüm/scroll/hit-test betikleri.
- Mevcut Bubblewrap betikleri, Play sertifikaları ve assetlinks bu branch'te değiştirilmedi. Release paket kimlikleri korunuyor; AAB adayları imzasız ve sürüm kodu geçici 1.

## Geçen kontroller

| Kontrol | Sonuç |
|---|---|
| Üç debug APK + üç imzasız release AAB derlemesi | PASS |
| Android lint customer/driver/schnell | 0 hata; varyant raporlarında uyarılar var (customer: 12) |
| URL/origin politikası | PASS, 27 JVM vaka |
| Debug paket izolasyonu / release ID / customer link kapsamı | PASS, üç varyant |
| Native Android algılama, tarayıcı fallback ve SSR | PASS |
| Modal viewport / klavye simülasyonu / cleanup / swipe regresyonları | PASS |
| Checkout güvenlik / ödeme hata regresyonları | PASS |
| Schnell regresyonları | PASS |
| TypeScript | PASS |
| Next.js üretim derlemesi | PASS (yerel, dağıtım yapılmadı) |

## BlueStacks Android 13 gözlemleri

- Main, Driver ve Schnell ayrı `.webviewdebug` paketleriyle kuruldu; mevcut Play uygulamaları değiştirilmedi.
- Main ve Driver kendi Activity/WebView pencerelerinde açıldı; Chrome adres çubuğu, çeviri paneli veya Running in Chrome görünmedi. Driver giriş ekranına ulaştı; giriş bilgisi kullanılmadı.
- Main sipariş türü modalı 360x640 / 360x800 / 390x844 CDP görünüm boyutlarında geçti; alt butonların ölçülen sınırları ekranda kaldı. Canlı Lieferung/Abholung butonları işletme tarafından pausiert durumundaydı.
- Main All American ürün modalı aynı üç boyutta geçti: içerik kendi alanında kayıyor; not alanı erişilebilir; iki alt işlem butonu görünür ve hit-test ile örtülmemiş. Käse seçilip test uygulamasının yerel sepetine 1 ürün eklendi (7,50 EUR); sipariş gönderilmedi.
- Android geri tuşu sipariş türü modalını kapatıp /menu sayfasında kaldı; body scroll lock kalktı (`overflow: hidden auto`, y:auto).
- Schnell canlı web sürümü native işaretçiyi henüz tanımadığından /schnellbestellung/install sayfasına yönlendi. Kod düzeltmesi branch'te, canlıya verilmedi; düzeldiği uçtan uca doğrulanmadı.
- İlk Main açılışında emülatörün libhwui RenderThread katmanında `!grContext.get()` çökmesi görüldü; ikinci açılış çalıştı. Tekrar açılış başarısını kararlı fiziksel cihaz testi olarak sunmuyoruz.

## Yayın öncesi kalanlar

- Native Android push entegrasyonu; Driver arka plan işlevleri/bildirimleri. WebView'e geçiş bu yetenekleri kendiliğinden korumaz.
- Web uyumluluk değişikliklerini uygun ortamda dağıtıp Schnell kurulum döngüsü, QR ve erişim kontrolünü doğrulamak.
- Gerçek cihazda kamera/konum izinleri (kabul ve ret), klavye açık adres/telefon ve alt butonlar, uygulama kapanıp açılınca oturum, üç uygulama birlikteyken ödeme/3DS dönüşü.
- İşletme normalde sipariş alırken kontrollü test ortamında Abholung/Lieferung → checkout akışını doğrulamak. Canlı ödeme veya mutfağa düşecek sipariş oluşturulmadı; ayarlar değiştirilmedi.
- Gerçek Play sürüm kodlarını kontrol etmek, mevcut upload key ile güvenli imzalamak, app-signing/rotasyon sertifikalarıyla internal track doğrulaması ve son yayın onayı.

APK'lar: `mobile/android/webview-suite/build/artifacts/app-{customer,driver,schnell}-debug.apk`.
Ölçüm ve ekran görüntüleri: `mobile/android/webview-suite/build/emulator-evidence/`.
Bu geçiş için yeni Android AAB/Play güncellemesi gerekir; yalnızca web dağıtımı mevcut TWA'yı WebView'e dönüştürmez.
