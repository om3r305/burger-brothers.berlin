# Burger Brothers — Showcase & Theme Engine v3

Tarih: 30 Temmuz 2026

## Yapılan güncellemeler

- `Schnell / Hediye / Masa QR` sahnesi genel duyuru tipinden tamamen ayrıldı.
- Schnell sahnesinin başlığı, metni, rozeti, rengi, süresi, yayın programı ve QR hedefi bağımsız yönetiliyor.
- Eski bir duyuru sahnesinin adı veya başlığı `Schnell` / `Schnellbestellung` içeriyorsa güvenli biçimde yeni tipe dönüştürülüyor.
- Google yorum sahnesinden hemen sonra otomatik bir yorum/fotoğraf çağrı ekranı geliyor; ayrıca playlist sahnesi eklemek gerekmiyor.
- Google değerlendirme QR adresi sipariş QR adresinden ayrıldı. Sahneye özel URL yoksa `Ayarlar > İletişim > Google yorum bağlantısı` kullanılıyor.
- Yorum döngüsü düzeltildi; aynı yorumun sürekli tekrarlanması yerine uygun yorumlar sırayla ilerliyor.
- Tema motoru 17 profesyonel profile çıkarıldı:
  - Classic
  - Neon Night
  - Frühling / Ostern
  - Berlin Sommer
  - Vatertag
  - Schulstart / Zeugnis
  - Vegan Week
  - Fan Sommer
  - Oktoberfest / Wiesn
  - Berlin Lights
  - Deutschland / Einheit
  - Halloween
  - Black Week
  - Christmas / Advent
  - Winter
  - Silvester / Neujahr
  - Valentine's
- Her temanın paleti, atmosferi, motifi ve birincil buton tıklama tepkisi birbirinden ayrıldı.
- Eski Christmas butonundaki yapay beyaz çizgi kaldırıldı.
- Karne/Zeugnis, Schulstart ve Vegan Week için hazır vitrin şablonları eklendi.
- Almanya takviminde Paskalya ve Vatertag tarihleri ilgili yıl için gerçek tarihten hesaplanıyor.
- Düşük güçlü cihazlarda motif yoğunluğu otomatik azalıyor. Hareket azaltma tercihi ve admin/TV/driver tema izolasyonu korunuyor.

## Yönetici tarafında kontrol edilecek iki işletme bağlantısı

1. `Ayarlar > İletişim > Google yorum bağlantısı`
2. Vitrin sahnesindeki `Schnell / masa QR hedefi`

Bu iki adres birbirinden bağımsızdır. Sistem Google URL'si eksikken sipariş QR adresini yanlışlıkla kullanmaz.

## Güvenli kapsam

Bu paket sipariş fiyatlandırması, ödeme kapatma, kasa akışı, rol/oturum yetkileri veya Stripe mantığını değiştirmez. Değişiklikler vitrin sahne motoru, tema görünümü, tema takvimi ve bunların yönetici kontrolleriyle sınırlıdır.

## Doğrulama

- TypeScript kontrolü: geçti
- Next.js production build: geçti
- Showcase/tema regresyonları: geçti
- Schnellbestellung regresyonları: geçti
- Sipariş fiyatlandırma ve ödeme güvenlik testleri: geçti
- Oturum, rol ve route erişim testleri: geçti
- Artifact/secret taraması: temiz
- `npm audit`: 0 açık

Gerçek sunucu sırları ZIP içine konmamıştır. Kurulumda `.env` değerleri mevcut güvenli deployment ortamından sağlanmalıdır.
