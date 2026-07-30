# Burger Brothers V4 — Hava, Kazanan, Mobil Admin ve Performans

Tarih: 30 Temmuz 2026

Bu paket önceki Showcase + Theme Engine v3 sürümünün tamamını içerir. Sipariş,
fiyatlandırma, ödeme, kampanya uygunluğu ve mutfak/TV durum akışları
değiştirilmeden aşağıdaki görsel, kullanım ve performans geliştirmeleri
uygulanmıştır.

## Canlı hava deneyimi

- Open-Meteo kaynağı artık WMO kodu, sıcaklık, hissedilen sıcaklık, nem, yağış,
  yağmur, sağanak, kar, rüzgâr, rüzgâr hamlesi, gün/gece, günlük en yüksek/en
  düşük sıcaklık ve gün doğumu/batımı alanlarını okur.
- Açık, parçalı bulutlu, bulutlu, sis, çiseleme, yağmur, fırtına ve kar için
  birbirinden ayrılmış canlı sahneler bulunur.
- Sahne; CSS/SVG ile çözünürlükten bağımsız çizilir. Yağış ve kar animasyonları
  `transform`/`opacity` tabanlıdır, parçacık sayısı 18 ile sınırlıdır.
- `prefers-reduced-motion`, düşük maliyetli animasyon, container query ve
  gün/gece görünümü desteği vardır.
- Almanca hava mesajları koşula ve günün saatine göre doğal, esprili ve
  deterministik biçimde çeşitlenir. Admin tarafından girilen özel metinler
  önceliğini korur.
- Hava isteği 10 dakika önbelleklenir; geçici ağ sorununda son sağlam veri
  kullanılır.

## Şanslı Sipariş / kazanan kutlaması

- TV ve müşteri ekranı aynı premium `RewardStage` sahnesini kullanır.
- Eski emoji, ping ve yapay havai fişek görünümü kaldırıldı; logo, hediye
  simgesi, metalik konfeti, ödül kartı, müşteri numarası ve fotoğraf alanı
  profesyonel bir düzene taşındı.
- Animasyon 24 parçacıkla sınırlı, katman izole ve azaltılmış hareket tercihine
  duyarlıdır.
- Kutlama sesi kısa, stereo 44.1 kHz PCM olarak yeniden üretildi. Kaynak üretim
  aracı `npm run reward:audio` komutudur.
- Ödül kararı, kota, tekrar güvenliği, fotoğraf onayı ve Showcase canlı etkinlik
  akışı değiştirilmedi.

## Mobil admin

- Bildirim sayfası telefonda `Gönder`, `Otomasyon` ve `Geçmiş` sekmelerine
  ayrıldı.
- Gönder/test aksiyonları mobilde erişilebilir sabit bara taşındı.
- Gelişmiş bağlantı/görsel alanları ve telefon önizlemesi açılır bölümlere
  alındı.
- Geniş geçmiş tablosuna ek olarak mobil geçmiş kartları eklendi.
- Global geri bildirim mesajları kaydetme/gönderme sonrasında görünür kalır.
- Admin kabuğuna Ürünler, Sipariş, Bildirim, Vitrin ve tam Menü erişimli mobil
  hızlı navigasyon eklendi.
- API çağrıları, gönderim/otomasyon kayıt mantığı ve yetki kontrolleri
  değiştirilmedi.

## Performans

- Checkout'un tüm sayfayı her saniye yeniden çizmesine neden olan sayaç
  kaldırıldı; saniyelik sayaç yalnızca aktif rota kampanyası varken çalışır.
- Ayar/kampanya kontrolü görünürlük duyarlı 15 saniyelik aralığa alındı.
- Kupon ve takip yardımcıları ayrı istemci parçaları olarak yüklenir.
- Yerel PNG ürün, badge ve logo dosyaları için WebP kopyaları üretildi; eski
  PNG dosyaları güvenli fallback olarak korundu. Kaynak PNG toplamı yaklaşık
  81.3 MiB, kullanılan WebP karşılıkları yaklaşık 7.1 MiB'dir.
- Ürün şeffaflık/kadraj analizi daha küçük örnekle, tarayıcının boş zamanında
  ve oturum önbelleğiyle çalışır.
- Admin, TV, Showcase, sürücü ve Schnell gibi operasyon ekranlarında genel site
  footer'ı, dış ses yüklemesi ve gereksiz dinleyiciler çalıştırılmaz.
- Showcase saati saniyede bir yerine dakika sınırına hizalanır.

## Kurulum

1. `npm ci`
2. Deployment ortam değişkenlerini mevcut güvenli üretim değerleriyle tanımla.
3. `npm run verify`
4. Veritabanı migration sürecini mevcut deployment prosedürüyle çalıştır.
5. `npm run build` ve ardından `npm start`

Üretim sırları ZIP'e bilinçli olarak eklenmemiştir. Özellikle `DATABASE_URL`,
`ADMIN_USER`, `ADMIN_PASS`, `TV_PIN`, `SESSION_SECRET`,
`BOOTSTRAP_MIGRATION_TOKEN`, `CRON_SECRET` ve `ANALYTICS_IP_SECRET` deployment
ortamından sağlanmalıdır.

## Doğrulama sonucu

- TypeScript ve Next.js production build: geçti
- Hardening, oturum/rol, güvenlik ve artifact taramaları: geçti
- Sipariş, canonical pricing, checkout, ödeme merkezi ve ödeme kapatma
  regresyonları: geçti
- Showcase, hava, tema, Schnell, Şanslı Sipariş, bildirim ve Brian regresyonları:
  geçti
- `npm audit --audit-level=high`: 0 güvenlik açığı
