# VERIFY — Schnell Variant + Ready Alert V5

## Variant adı

- Group variant ürününde `variant.name` varsa doğrudan kart adı olur.
- SKU yalnız sanal ürün kimliği için kullanılır.
- Grup Name yalnız fallback olarak kullanılır.
- `stripSchnellGroupPrefix` yeni kart adında çağrılmaz.
- Client katalog cache anahtarı `bb_schnell_catalog_v5` olur.

## Tekrar Fertig

- Order status API önceki durumu okur.
- Schnellbestellung siparişi non-ready durumdan ready durumuna geçtiğinde:
  - `readyEventSequence` artar.
  - `readyEventAt` yenilenir.
  - `readyEventId` yenilenir.
- Ready durumunun aynı polling cevabı yeni event oluşturmaz.
- Telefon status endpointi event alanlarını yalnız aynı cihaz oturumuna döner.
- Başarı ekranı son uyarılan event kimliğini bellekte tutar.
- Hazırdan geri alınıp yeniden hazır yapılınca yeni event yeniden ses çıkarır.

## Ses / titreşim

- Sipariş onayında HTMLAudioElement ve AudioContext hazırlanır.
- Başarı ekranı mevcut hazırlanmış media elementini tekrar kullanır.
- Media ve Web Audio tekrarları birlikte çalışır.
- Desteklenen cihazlarda vibration pattern yeniden tetiklenir.
- Görsel ready ekranı ses çalışmasa bile görünür.

## Otomatik GitHub kontrolleri

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

çalıştırır. Bir adım başarısız olursa commit oluşturmaz ve GitHub senkron
klasörünü yedekten geri yükler.
