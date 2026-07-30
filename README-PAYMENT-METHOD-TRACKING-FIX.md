# Burger Brothers Berlin — Payment Method + Tracking Fix

Tarih: 22.07.2026

## Amaç

Bu teslimat iki sorunu birlikte düzeltir:

1. Daha önce kaydedilmiş kart seçiliyken müşterinin gerektiğinde PayPal, Klarna, Apple Pay, Google Pay veya Stripe hesabında etkin başka bir yönteme geçebilmesi.
2. Başarılı online ödeme sonrasında Payment Center tarafından verilen uzun takip bağlantısının `Bestellung nicht gefunden` göstermesi.

## Yapılan düzenlemeler

### 1. Başka ödeme yöntemi seçimi

Checkout içindeki kayıtlı yöntem alanına açık bir seçenek eklendi:

- `Andere Zahlungsart wählen`
- Alt açıklama: `PayPal, Klarna, Wallet oder neue Karte`

Davranış:

- Kayıtlı kart seçiliyse mevcut güvenli doğrudan PaymentIntent akışı korunur.
- `Andere Zahlungsart wählen` seçilirse `savedPaymentMethodId` boş gönderilir.
- Sunucu mevcut Stripe Customer bağlantısını koruyarak Stripe Checkout açar.
- Müşteri Stripe üzerinde etkin PayPal/Klarna/Wallet/yeni kart seçeneklerinden birini seçebilir.
- `Zahlungsart für zukünftige Bestellungen merken` açıksa uyumlu yeni yöntem Stripe Customer altında kaydedilebilir.
- Burger Brothers kart numarası, CVC veya PayPal şifresi saklamaz.

### 2. Takip tokeni sorgusu

Takip endpointi daha önce yalnız Prisma JSON-path sorgusuna bağlıydı. Yeni akış:

- Önce mevcut Prisma sorgusu kullanılır.
- Prisma JSON sorgusu sonuç vermez veya sağlayıcı uyumsuzluğu nedeniyle hata verirse parametreli PostgreSQL JSONB sorgusu çalışır.
- Hem `meta.trackingToken` hem eski kayıtlar için `meta.publicTrackingToken` desteklenir.
- Bulunan kayıt ayrıca zaman sabitli `matchesTrackingToken` kontrolünden geçirilir.
- Takip tokeni veya sorgu ayrıntısı loglara yazılmaz.

Payment finalize daha önce tamamlanmış bir oturumu tekrar okuduğunda gerçek final siparişin `trackingToken` değeri artık açıkça response içine de eklenir.

## Değişmeyen alanlar

- Fiyatlama
- Kampanya ve kupon hesapları
- Pfand
- ETA ve planlanan saat
- Stripe webhook doğrulaması
- PaymentIntent sahiplik kontrolü
- Split Center
- Siparişin tek sefer finalize edilmesi
- TV ve mutfak akışı
- Prisma schema ve migrationlar

## Kurulum

ZIP içeriğini klasör yapısını koruyarak doğrudan aşağıdaki klasörün üzerine çıkarın:

```text
C:\Web\burger
```

`.env`, `.env.local`, `node_modules`, `.next` veya DB dosyası bu pakette bulunmaz.

Önce canlıya göndermeden local çalışma klasöründe kontrol edin. Ardından ZIP içindeki:

```text
PUSH-PAYMENT-METHOD-TRACKING-FIX-TO-GITHUB.ps1
```

scriptini doğrudan `C:\Web\burger` içinden çalıştırın. Script tam typecheck, güvenlik testleri ve production build başarılı olmadan commit/push yapmaz.

## Beklenen müşteri deneyimi

- Kayıtlı kart varsayılan olarak seçili kalır.
- Müşteri isterse `Andere Zahlungsart wählen` seçer.
- Stripe ekranında PayPal veya etkin başka yöntemi kullanır.
- Başarılı ödeme sonrasında `Bestellung verfolgen` gerçek uzun tracking token ile siparişi açar.
