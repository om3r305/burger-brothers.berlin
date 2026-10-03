import type { CheckoutOrderDraft } from "@/types/checkout";

// Exclude timestamps, refreshed SMS proofs and geocoding metadata: a network
// retry of the same customer intent must keep the same order request identity.
export function checkoutAttemptFingerprint(order: CheckoutOrderDraft) {
  return JSON.stringify({
    mode: order.mode, items: order.items, customer: order.customer,
    planned: order.planned, coupon: order.coupon, orderNote: order.orderNote,
    total: order.total, payment: order.meta?.payment,
    routeDeal: order.meta?.routeDeal, freebies: order.meta?.freebies,
  });
}
