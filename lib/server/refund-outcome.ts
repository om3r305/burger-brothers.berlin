export type RefundRecord = {
  status?: string | null;
  error?: unknown;
};

export function refundOutcome(refunds: RefundRecord[]) {
  if (!refunds.length || refunds.some((refund) =>
    refund.error || !["succeeded", "pending"].includes(String(refund.status)),
  )) {
    return { state: "refund_failed", status: "failed", error: "AUTO_REFUND_FAILED" } as const;
  }
  if (refunds.some((refund) => refund.status === "pending")) {
    return { state: "refund_pending", status: "refund_pending", error: "AUTO_REFUND_PENDING" } as const;
  }
  return { state: "refunded", status: "refunded", error: undefined } as const;
}
