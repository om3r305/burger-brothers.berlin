export type CanonicalSplitItem = {
  key: string;
  label: string;
};

export type CanonicalSplitShare = {
  index: number;
  label: string;
  baseAmountCents: number;
  serviceFeeCents: number;
  amountCents: number;
  items: CanonicalSplitItem[];
};

export type CanonicalSplitPlan = {
  shares: CanonicalSplitShare[];
  adjusted: boolean;
  submittedBaseTotalCents: number;
  canonicalBaseTotalCents: number;
  differenceCents: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown, fallback = 0) {
  const normalized =
    typeof value === "string" ? value.trim().replace(",", ".") : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toCents(value: unknown) {
  return Math.max(0, Math.round(toNumber(value, 0) * 100));
}

function allocateByWeight(weights: number[], totalCents: number) {
  const safeTotal = Math.max(0, Math.round(totalCents));
  const totalWeight = weights.reduce((sum, value) => sum + Math.max(0, value), 0);

  if (weights.length === 0 || totalWeight <= 0) {
    return weights.map(() => 0);
  }

  let allocated = 0;
  return weights.map((weight, index) => {
    const isLast = index === weights.length - 1;
    const amount = isLast
      ? Math.max(0, safeTotal - allocated)
      : Math.max(0, Math.floor((safeTotal * Math.max(0, weight)) / totalWeight));

    allocated += amount;
    return amount;
  });
}

/**
 * Rebuilds split amounts against the canonical server total while preserving
 * the customer's relative distribution and item ownership.
 *
 * The browser's submitted totals are never trusted as payment authority.
 * Invalid person counts, empty shares and amounts below Stripe's minimum are
 * still rejected. Only stale/rounded totals are rebalanced.
 */
export function canonicalizeSplitShares(params: {
  raw: unknown;
  payableCents: number;
  serviceFeeCents: number;
  maxPeople: number;
}): CanonicalSplitPlan {
  const input = Array.isArray(params.raw) ? params.raw : [];
  const count = input.length;
  const maxPeople = Math.max(2, Math.round(params.maxPeople));
  const canonicalBaseTotalCents = Math.max(0, Math.round(params.payableCents));
  const serviceFeeCents = Math.max(0, Math.round(params.serviceFeeCents));

  if (count < 2 || count > maxPeople) {
    throw new Error("SPLIT_PERSON_COUNT_INVALID");
  }

  const parsed = input.map((rawShare, index) => {
    const share = isRecord(rawShare) ? rawShare : {};
    const submittedBaseAmountCents = Math.max(
      0,
      Math.round(
        toNumber(
          share.baseAmountCents ??
            toCents(share.baseAmount ?? share.amount),
          0,
        ),
      ),
    );

    const items = Array.isArray(share.items)
      ? share.items.slice(0, 200).map((rawItem) => {
          const item = isRecord(rawItem) ? rawItem : {};
          return {
            key: String(item.key ?? "").slice(0, 120),
            label: String(item.label ?? "").slice(0, 160),
          };
        })
      : [];

    return {
      index,
      label: String(share.label ?? `Person ${index + 1}`).slice(0, 80),
      submittedBaseAmountCents,
      items,
    };
  });

  if (parsed.some((share) => share.submittedBaseAmountCents <= 0)) {
    throw new Error("SPLIT_EMPTY_PERSON");
  }

  const submittedBaseTotalCents = parsed.reduce(
    (sum, share) => sum + share.submittedBaseAmountCents,
    0,
  );
  const adjusted = submittedBaseTotalCents !== canonicalBaseTotalCents;
  const canonicalAmounts = adjusted
    ? allocateByWeight(
        parsed.map((share) => share.submittedBaseAmountCents),
        canonicalBaseTotalCents,
      )
    : parsed.map((share) => share.submittedBaseAmountCents);

  const shares = parsed.map((share, index): CanonicalSplitShare => {
    const baseAmountCents = canonicalAmounts[index] ?? 0;
    return {
      index: share.index,
      label: share.label,
      baseAmountCents,
      serviceFeeCents,
      amountCents: baseAmountCents + serviceFeeCents,
      items: share.items,
    };
  });

  if (shares.some((share) => share.baseAmountCents <= 0)) {
    throw new Error("SPLIT_EMPTY_PERSON");
  }

  if (shares.some((share) => share.amountCents < 50)) {
    throw new Error("PAYMENT_AMOUNT_TOO_LOW");
  }

  return {
    shares,
    adjusted,
    submittedBaseTotalCents,
    canonicalBaseTotalCents,
    differenceCents: canonicalBaseTotalCents - submittedBaseTotalCents,
  };
}
