# Burger Brothers Berlin — Checkout Online-Zahlung alan düzeni

## Yapılan değişiklik

Yalnız checkout ödeme alanındaki görsel sıralama değiştirildi.

Eski sıra:

1. Barzahlung
2. Online-Zahlung ve güven logoları
3. Getrennt zahlen
4. Kayıtlı ödeme yöntemi
5. Başka ödeme yöntemi
6. Gelecek siparişler için kaydetme

Yeni sıra:

1. Barzahlung
2. Online-Zahlung
3. Online seçiliyse hemen altında:
   - Gespeicherte Zahlungsart
   - Andere Zahlungsart wählen
   - Zahlungsart für zukünftige Bestellungen merken
   - Sichere Zahlung logoları
4. Getrennt zahlen
5. Diğer aktif ödeme seçenekleri

## Korunan işleyiş

Aşağıdaki davranışlara dokunulmadı:

- `paymentMethod` state değerleri
- Kayıtlı PaymentMethod seçimi
- `selectedSavedPaymentMethodId`
- Başka ödeme yöntemi seçimi
- Stripe Checkout ve doğrudan PaymentIntent akışı
- PayPal, Klarna, kart ve wallet yöntemleri
- Split ödeme akışı
- Açık ödeme recovery kilidi
- Ödeme yöntemi kaydetme/silme
- Sipariş oluşturma ve fiyatlama
- Payment Center ve Split Center
- `PaymentTrustBadges` component içeriği
- Zustand sepet store'u

`PaymentTrustBadges.tsx` ve `components/store.ts` değiştirilmedi.
