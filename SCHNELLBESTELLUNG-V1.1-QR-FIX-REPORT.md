# Schnellbestellung V1.1 — QR ekranı düzeltme raporu

## Görülen sorun

`/schnellbestellung/access-display` sayfasında QR alanı sürekli boş/gri görünüyordu.

## Kök neden

Schnellbestellung güvenlik nedeniyle varsayılan olarak kapalı başlıyordu. Token endpointi bu durumda `503 disabled` döndürüyordu; fakat ekran yalnız başarılı cevabı işlediği için hatayı göstermiyor ve sonsuza kadar yükleme kutusunda kalıyordu.

Aynı sessiz durum `SESSION_SECRET` eksikliği, DB/API hatası veya sistemin duraklatılması sırasında da oluşabiliyordu.

## Yapılan düzeltmeler

- Token endpointi kapalı, duraklatılmış ve yapılandırma eksikliği durumlarını açık JSON hata kodlarıyla döndürüyor.
- Token oluşturma hataları server tarafında güvenli şekilde loglanıyor.
- QR ekranı artık sonsuz boş kutuda kalmıyor.
- Almanca durum mesajları ve `Erneut versuchen` butonu eklendi.
- Ekran tokenı düzenli olarak yeniliyor.
- Localhost QR'ının başka telefonda açılamayacağı ekranda açıklanıyor.
- Admin ekranında ham anahtar adları yerine anlaşılır Türkçe etiketler kullanılıyor.
- Admin ekranına dükkân enlem/boylam alanları ve gerçek operasyon durumu eklendi.
- Henüz finalize akışına bağlanmamış Online-Zahlung ve Getrennt zahlen seçenekleri V1'de yanlışlıkla açılamayacak şekilde kilitlendi.
- Regression testi boş QR ekranının tekrar oluşmasını engelleyecek kontrollerle genişletildi.

## İlk kullanım

1. `/admin/schnellbestellung` açılır.
2. `Sistem aktif` ve `Barzahlung aktif` açılır.
3. Dükkân koordinatları doğrulanır.
4. Ayarlar kaydedilir.
5. QR ekranında `Erneut versuchen` seçilir.

## Local test notu

`localhost` içeren QR başka telefondan PC'ye ulaşamaz. Telefon ve GPS testi HTTPS preview/live domain üzerinden yapılmalıdır.
