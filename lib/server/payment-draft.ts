/** Payment session rows must never become kitchen or driver orders. */
export const PAYMENT_DRAFT_STATUSES = [
  "payment_pending", "payment_completed", "payment_failed", "payment_expired",
  "payment_cancelled", "payment_refunded", "refund_pending", "refund_failed",
];
export function isPaymentDraft(row: any): boolean {
  const status = String(row?.status ?? "").trim().toLowerCase();
  return status.startsWith("payment_") ||
    status === "refund_pending" || status === "refund_failed" ||
    Boolean(row?.meta?.paymentSession);
}
