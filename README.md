# Burger Brothers — Saved Payment Fast Checkout

Bu paket mevcut Stripe-hosted Checkout akışını korur ve kayıtlı ödeme
yöntemlerinin sonraki siparişte güvenli şekilde yeniden kullanılmasını
iyileştirir.

## Değişen davranış

- İlk siparişte checkbox açıksa Stripe Customer oluşturulur.
- Ödeme tamamlanınca imzalı HttpOnly cihaz profili oluşturulur.
- Sonraki siparişte aynı cihaz ve telefon eşleşmesiyle Stripe Customer yeniden kullanılır.
- Müşteri bu siparişte yeni yöntemi kaydetmek istemese bile mevcut kayıtlı yöntem Stripe Checkout'ta gösterilebilir.
- Checkout ekranında kayıtlı kart/PayPal/Link bilgisi maskeli biçimde gösterilir.
- Burger Brothers ham kart, CVC veya PayPal şifresi tutmaz.
- Split payment, açık ödeme kurtarma, fiyatlandırma, sipariş oluşturma ve TV/Driver akışları değiştirilmez.

## Önemli

Bu paket Express Checkout Element'i site içine gömmez. Bu profesyonel geçişin
1. aşamasıdır. Hosted Stripe sayfası korunur; ancak dönen müşteri kayıtlı
yöntemini daha hızlı seçer. Express Checkout ayrı ve daha büyük 2. aşamadır.
