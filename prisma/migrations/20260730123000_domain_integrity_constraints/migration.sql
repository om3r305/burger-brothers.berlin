ALTER TABLE "IssuedCoupon"
ADD CONSTRAINT "IssuedCoupon_couponId_fkey"
FOREIGN KEY ("couponId") REFERENCES "Coupon"("id")
ON DELETE RESTRICT ON UPDATE CASCADE
NOT VALID;

ALTER TABLE "Order"
ADD CONSTRAINT "Order_status_domain_check"
CHECK (
  "status" IN (
    'new',
    'preparing',
    'ready',
    'out_for_delivery',
    'done',
    'cancelled'
  )
  OR LEFT("status", 8) = 'payment_'
) NOT VALID;

ALTER TABLE "Order"
ADD CONSTRAINT "Order_mode_domain_check"
CHECK (
  LOWER("mode") IN (
    'pickup',
    'delivery',
    'dine_in',
    'dine-in',
    'vor_ort',
    'vor ort',
    'salon',
    'schnellbestellung',
    'abholung'
  )
) NOT VALID;
