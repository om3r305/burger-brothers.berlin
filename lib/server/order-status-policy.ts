export type OperationalOrderStatus =
  | "new"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "done"
  | "cancelled";

export type OrderActorRole = "admin" | "tv" | "driver";
export type OrderFulfilmentMode = "pickup" | "delivery" | "dine_in";

type TransitionDecision = {
  allowed: boolean;
  requiresOverrideReason: boolean;
  error?: string;
};

const TV_TRANSITIONS: Record<
  OperationalOrderStatus,
  ReadonlySet<OperationalOrderStatus>
> = {
  // TV'deki operasyon kartları bu durumlar arasında düzeltme yapılmasına izin
  // veriyor. Matris istemci davranışını korurken final/iptal sınırını sunucuda
  // açık ve test edilebilir hale getirir.
  new: new Set(["new", "preparing", "ready", "out_for_delivery", "done"]),
  preparing: new Set(["new", "preparing", "ready", "out_for_delivery", "done"]),
  ready: new Set(["new", "preparing", "ready", "out_for_delivery", "done"]),
  out_for_delivery: new Set(["preparing", "out_for_delivery", "done"]),
  done: new Set(["new", "preparing", "ready", "out_for_delivery", "done"]),
  cancelled: new Set(),
};

function modeAllows(
  mode: OrderFulfilmentMode,
  next: OperationalOrderStatus,
) {
  if (mode === "dine_in" || mode === "pickup") {
    return next !== "out_for_delivery";
  }

  return true;
}

export function decideOrderStatusTransition(params: {
  current: OperationalOrderStatus;
  next: OperationalOrderStatus;
  role: OrderActorRole;
  mode: OrderFulfilmentMode;
  overrideReason?: string;
}): TransitionDecision {
  const { current, next, role, mode } = params;
  const overrideReason = String(params.overrideReason || "").trim();

  if (current === next) {
    return { allowed: true, requiresOverrideReason: false };
  }

  if (!modeAllows(mode, next)) {
    return {
      allowed: false,
      requiresOverrideReason: false,
      error: "status_not_allowed_for_order_mode",
    };
  }

  if (role !== "admin" && (current === "cancelled" || next === "cancelled")) {
    return {
      allowed: false,
      requiresOverrideReason: false,
      error: "order_cancellation_requires_admin",
    };
  }

  if (role === "driver") {
    const startsDelivery =
      ["new", "preparing", "ready"].includes(current) &&
      next === "out_for_delivery";
    const finishesOrReleases =
      current === "out_for_delivery" &&
      (next === "done" || next === "preparing");
    const allowed = startsDelivery || finishesOrReleases;

    return {
      allowed,
      requiresOverrideReason: false,
      error: allowed ? undefined : "driver_status_transition_not_allowed",
    };
  }

  if (role === "tv") {
    const allowed = TV_TRANSITIONS[current].has(next);
    return {
      allowed,
      requiresOverrideReason: false,
      error: allowed ? undefined : "status_transition_not_allowed",
    };
  }

  // Admin iptal edebilir ve normal operasyon durumlarını yönetebilir. İptal
  // edilmiş bir siparişi diriltmek kasıtlı bir override'dır; audit için neden
  // olmadan kabul edilmez.
  const requiresOverrideReason =
    current === "cancelled" && next !== "cancelled";

  if (requiresOverrideReason && overrideReason.length < 8) {
    return {
      allowed: false,
      requiresOverrideReason: true,
      error: "status_override_reason_required",
    };
  }

  return {
    allowed: true,
    requiresOverrideReason,
  };
}
