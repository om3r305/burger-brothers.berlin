# Burger Brothers Berlin — Checkout Güvenli Refactor

## Amaç

Checkout ödeme, fiyatlama ve sipariş davranışını değiştirmeden tip güvenliğini,
hata görünürlüğünü ve mobil erişilebilirliği güçlendirmek.

## Yapılanlar

### 1. Zustand store gerçek tipleri

`components/store.ts` artık aşağıdaki sözleşmeleri export eder:

- `CartState`
- `CartItemFixed`
- `AddPayload`
- `OrderMode`
- `CartPricing`

Checkout içindeki `state: any` selector zinciri kaldırıldı. `add`, `addItem`,
`addCartItem`, `push` gibi belirsiz fallback'ler yerine store'un gerçek
`addToCart` fonksiyonu kullanılır.

### 2. Kritik `any` temizliği

`app/checkout/page.tsx` ve `components/store.ts` içindeki açık `any`
kullanımı sıfıra indirildi. Dış kaynaklar önce `unknown` kabul edilir:

- API JSON cevapları
- localStorage verileri
- kayıtlı ödeme recovery bilgisi
- katalog/settings uyumluluk verileri
- sipariş oluşturma cevabı

Veri ancak runtime doğrulamasından sonra uygulama tiplerine çevrilir.

### 3. Ödeme ve sipariş response doğrulaması

Yeni `lib/checkout/runtime.ts` katmanı:

- `ActivePaymentRecovery`
- Payment Profile
- Payment Prepare
- Payment Session
- Order Create

cevaplarını güvenli şekilde normalize eder.

Ödeme yönlendirmesi korunmuştur; Stripe/PayPal için tam sayfa yönlendirme
kasıtlı olarak `window.location.assign()` ile devam eder. Yönlendirme öncesi
URL'nin güvenli bir HTTPS veya aynı-origin adres olduğu doğrulanır.

### 4. Checkout order draft tipi

`types/checkout.ts` içinde ödeme ve sipariş taslağının kritik alanları
tiplendirildi. Fiyat, kupon, Pfand, route deal ve ödeme meta şekli korunur.

### 5. Alert yerine mobil toast

Native `alert()` tamamen kaldırıldı. Yeni
`CheckoutToastViewport` aşağıdaki mesajları sayfayı bloklamadan gösterir:

- ödeme başlatma hatası
- sipariş gönderme hatası
- kayıtlı ödeme yöntemini silme sonucu
- müşteri profilini silme sonucu

### 6. Hata yönetimi

Kritik ağ ve ödeme hataları scope bilgisiyle loglanır. Storage işlemleri gibi
best-effort alanlar siparişi engellemez ve bu durum kodda açıkça belgelenir.

### 7. Slot dependency güvenliği

Her render'da yeniden oluşan `buildSlotConfig` fonksiyonu kaldırıldı.
Aynı değerleri taşıyan memoize `slotConfig` kullanılır. Planlı sipariş
hesaplamasının davranışı ve `useLayoutEffect` korunmuştur; kapalı saatlerde
yanlış ekranın kısa süre görünmesi engellenmeye devam eder.

### 8. Form erişilebilirliği

`Field` artık tüm içeriği tek bir `<label>` içine koymaz:

- Her input için sabit `id` + `htmlFor`
- E-posta pazarlama checkbox'ı için ayrı label
- Planlı zaman alanları için `<fieldset>` + `<legend>`
- İsim, telefon, adres ve e-posta autocomplete özellikleri

## Bilerek değiştirilmeyenler

- Cash / Online / Getrennt zahlen akışı
- Kayıtlı kart ve PayPal hızlı ödeme
- Başka ödeme yöntemi seçimi
- Payment Center / Split Center
- Stripe Checkout ve requires_action dönüşleri
- Payment recovery kilidi ve sayaç
- Sipariş retry / Telegram emergency fallback
- Fiyatlama, kupon, kampanya, route deal, Pfand ve ücretsiz ürün formülleri
- Split dağılımındaki `0.01` uyumluluk ağırlığı
- DB, Prisma schema ve migration
- `collectCatalog()` memoizasyon davranışı
- Route-deal saniyelik sayaç davranışı

## Split 0 € notu

`Math.max(0.01, ...)` gerçek ürün fiyatına 0,01 € eklemez. Bu yalnız split pay
oranını hesaplayan iç ağırlıktır. Gerçek tahsilat, server doğrulamalı toplam
üzerinden dağıtılmaya devam eder. Bu davranış testsiz değiştirilmedi.

## V2 TypeScript düzeltmesi

İlk teslimattaki `readPaymentEnabled` fonksiyonunda opsiyonel
`payments[key]` alanı doğrudan ara değişkenden okunuyordu. Gerçek proje
`noUncheckedIndexedAccess` kontrolünde bu değer `undefined` kabul edildi.

Yeni kod:

```ts
const selectedValue: unknown = payments[key];
const direct = isRecord(selectedValue)
  ? selectedValue.enabled
  : undefined;
```

Bu değişiklik yalnız tip daraltmasını düzeltir. Ödeme ayarlarının çalışma
mantığını değiştirmez.
