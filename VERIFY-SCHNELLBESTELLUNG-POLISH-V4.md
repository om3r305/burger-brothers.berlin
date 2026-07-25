# VERIFY — Schnellbestellung Polish V4

## Menü adları

- `Coca Cola` grup başlığı Fanta/Sprite ürünlerinin önünde görünmez.
- `Fries` grup başlığı extra ürünlerinin önünde görünmez.
- `Jarritos (Mexico)` iki kez görünmez.
- Normal internet menüsündeki DB ürün adı değiştirilmez.

## Angebot

- Aktif kampanyalı ürün kendi kategorisinde ilk sıradadır.
- Kampanyasız kategorilerin mevcut alfabetik sırası korunur.
- Rozet `🔥 ... 🔥` biçiminde görünür.
- İndirimli ve eski fiyatlar korunur.

## Kategori gizleme

- Admin'de sekiz kategori ayrı ayrı açılıp kapatılabilir.
- Seçim `visibleCategories` üzerinden server tarafından uygulanır.
- Kategori gizleme yalnız Schnellbestellung kataloğunu etkiler.
- Son kategori kapatılamaz.
- Eski boş ayar bütün kategorileri görünür kabul eder.

## TV

- Dine-in `ready` kartı Neu sekmesinde kalmaz.
- `Fertig` basılınca TV anında Fertig sekmesine geçer.
- Fertig sekme sayısı dine-in ready siparişini içerir.
- Sol özet paneli aynı sayımı kullanır.
- Server hata verirse optimistic durum refresh ile geri düzeltilir.

## Telefon uyarısı

- Hazır durumunda ses yalnız bir defa tetiklenir fakat dört tur planlanır.
- Ses compressor ve yüksek gain kullanır.
- Desteklenen cihazda uzun vibration pattern çalışır.
- Wake Lock ve açık bekleme ekranı mevcut davranışını korur.

## Hız

- Client cache anahtarı `bb_schnell_catalog_v4` olur.
- İlk kategori ve sonraki kategori görselleri preload edilir.
- İlk ürün görselleri eager/high priority yüklenir.
- Kırık görsel placeholder'a dönüşür.
- Server response cache'i ayar değişikliğinde cache key ile geçersiz olur.

## Otomatik GitHub doğrulaması

Gönderim scripti commit öncesinde:

```text
npx prisma generate
npm run typecheck
npm run schnell:test
npm run tv:refactor:test
npm run security:test
npm run build
git diff --cached --check
```

çalıştırır.

Bir adım başarısız olursa commit oluşturulmaz ve
`C:\Web\burger-github` yedekten geri yüklenir.
