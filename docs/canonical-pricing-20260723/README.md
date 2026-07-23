# Burger Brothers Berlin — Canonical Pricing Kök Düzeltmesi

## Kök neden

Checkout ve sunucu aynı final tutara ulaşsa bile kampanya/indirim muhasebesini
farklı kalemlerde gösterebiliyordu:

- Checkout: ham ürün tutarı + ayrı indirim satırı
- Sunucu: kampanyalı ürün fiyatı + kalan indirimler

Eski kontrol hem final toplamı hem de `merchandise` kalemini birebir
karşılaştırdığı için final tutar doğru olsa dahi `ORDER_PRICE_CHANGED` hatası
oluşabiliyordu.

İkinci problem, split paylarının tarayıcıdaki eski toplamdan oluşturulmasıydı.
Sunucu canonical toplamı birkaç cent veya daha fazla değiştirdiğinde payların
toplamı yeni sipariş tutarıyla eşleşmiyordu.

## Yeni güvenli davranış

1. Client fiyatı ödeme veya sipariş otoritesi değildir.
2. Sunucu ürünleri, extraları, kampanyaları, indirimleri, kuponu, Pfand'ı,
   delivery surcharge'ı, route deal'i ve bahşişi DB/settings üzerinden yeniden
   hesaplar.
3. Stripe tutarı ve DB sipariş tutarı yalnız bu canonical hesaplamadan gelir.
4. Client kalem dağılımı veya toplamı farklıysa teknik hata verilmez.
5. Final tutar gerçekten değişmişse checkout kısa bir bilgi mesajı gösterir:
   `Der Gesamtbetrag wurde sicher auf ... aktualisiert.`
6. Split payları, ürün sahipliği ve oransal dağılım korunarak canonical toplamla
   otomatik dengelenir.
7. Geçersiz ürün, sahte extra, geçersiz kupon, kapalı ürün, minimum tutar ve
   yetki kontrolleri hata vermeye devam eder.

## Ödenmiş sipariş fiyat kilidi

Ödeme hazırlama sırasında oluşturulan canonical sipariş snapshot'ı pending
payment row içinde saklanır. Stripe ödeme yaptıktan sonra final sipariş bu
sunucu tarafından hazırlanmış ve HMAC ile doğrulanmış snapshot'tan oluşturulur.

Böylece ödeme ile finalizasyon arasındaki birkaç saniyede:

- kampanya sona erse,
- ürün fiyatı değişse,
- ayar güncellense,

Stripe'ın tahsil ettiği tutar ile final sipariş tutarı birbirinden ayrılmaz.

## Değişmeyen işleyiş

- Barzahlung
- Online-Zahlung
- Kayıtlı kart / PayPal hızlı ödeme
- requires_action
- Payment Center
- Getrennt zahlen / Split Center
- Payment recovery lock
- Kupon, freebie, Pfand, route deal ve bahşiş
- Sipariş retry ve emergency fallback
- Tracking, TV ve yazdırma
- Prisma şeması ve migrationlar

## DB değişikliği

Prisma schema veya migration değişikliği yoktur.

## V2 TypeScript sözleşme düzeltmesi

`parseOrderCreateEnvelope()` fonksiyonu `pricingAdjustment` ve
`canonicalPricing` alanlarını runtime parser ile zaten güvenli tiplere
dönüştürüyordu. Ancak `OrderCreateEnvelope` tipinde bu iki alan yanlışlıkla
`unknown` bırakılmıştı.

V2 yalnız şu tipleri düzeltti:

```ts
pricingAdjustment?: PricingAdjustment;
canonicalPricing?: CanonicalPricingSnapshot;
```

Canonical fiyat hesaplaması, Stripe tutarı, DB kaydı ve sipariş işleyişi
değiştirilmedi.

## V3 security-test uyumluluk düzeltmesi

Eski `tools/security-tests.mjs` testi, fiyat güvenliğini yalnız
`ORDER_PRICE_CHANGED` hatasıyla eşleştiriyordu. Yeni mimaride güvenlik,
client toplamını reddetmeye değil tamamen yok sayıp fiyatı DB kataloğundan
yeniden kurmaya dayanır.

V3, mevcut security test dosyasındaki yalnız eski kontrolü hedefli biçimde
günceller. Yeni kontroller şunları doğrular:

- `rebuildOrderPricingFromDatabase` kullanılıyor.
- Browser tarafından gönderilen toplam Stripe tutarı olarak kullanılmıyor.
- Canonical DB ürünleri pending siparişe yazılıyor.
- Stripe tutarı `rebuiltPricing.payableCents` değerinden geliyor.
- Canonical toplam pending siparişe yazılıyor.
- Canonical pricing snapshot saklanıyor.
- Fiyat değişimi audit amacıyla `pricingAdjustment` içinde izleniyor.

Ürün, extra, kupon, minimum tutar ve ödeme doğrulamaları gevşetilmez.
