// components/CouponBox.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { readSettings } from "@/lib/settings";
import {
  canApply,
  findCouponByAnyCode,
  getAllCoupons,
  getAllIssued,
  syncCouponsFromServer,
  type CartItemForCoupon,
  type CheckResult,
  type CouponDef,
  type IssuedCoupon,
} from "@/lib/coupons";

const LS_ACTIVE = "bb_active_coupon_code";
const LS_META = "bb_active_coupon_meta";

type Status = {
  type: "none" | "ok" | "error";
  msg?: string;
};

type ActiveMeta = {
  kind: "static" | "issued" | "db";
  couponId: string;
  issuedId?: string | null;
  code: string;
  type: CouponDef["type"];
  value: number;
  title?: string;
  discountAmount?: number;
  message?: string;
};

type StaticCoupon = {
  code: string;
  active: boolean;
  type: CouponDef["type"];
  value: number;
  validFrom: number | null;
  validTo: number | null;
  minCartTotal?: number;
  title?: string;
};

type SuggestedCoupon = {
  def: CouponDef;
  issued: IssuedCoupon;
  check: CheckResult;
  validUntil: number | null;
};

type CouponBoxProps = {
  cartTotal?: number;
  cartItems?: CartItemForCoupon[];
  customerPhone?: string | null;
  className?: string;
};

function nowTs() {
  return Date.now();
}

function parseTs(value?: string | number | null) {
  if (!value) return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanCode(value: string) {
  return String(value || "")
    .replace(/[\s\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, "")
    .trim()
    .toUpperCase();
}

function normalizePhone(value?: string | null) {
  return String(value ?? "").replace(/[^\d+]/g, "").trim();
}

function samePhone(left?: string | null, right?: string | null) {
  const a = normalizePhone(left);
  const b = normalizePhone(right);

  return Boolean(a && b && a === b);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function formatDate(value?: number | null) {
  if (!value) return "ohne Ablaufdatum";

  try {
    return new Date(value).toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "ohne Ablaufdatum";
  }
}

function couponTitle(def: CouponDef) {
  if (def.title) return def.title;

  if (def.type === "percent") return `${Number(def.value || 0)}% Rabatt`;
  if (def.type === "fixed") return `${formatMoney(Number(def.value || 0))} Rabatt`;
  if (def.type === "free_item") return `Gratis ${def.meta?.freeItemName || "Artikel"}`;
  if (def.type === "bogo") return "Gratis-Aktion";

  return "Gutschein";
}

function couponDescription(def: CouponDef) {
  if (def.meta?.aboutText) return String(def.meta.aboutText);

  if (def.type === "percent") {
    return `${Number(def.value || 0)}% Rabatt auf Ihre nächste Bestellung.`;
  }

  if (def.type === "fixed") {
    return `${formatMoney(Number(def.value || 0))} Rabatt auf Ihre nächste Bestellung.`;
  }

  if (def.type === "free_item") {
    return `Gratis: ${def.meta?.freeItemName || "Artikel"}.`;
  }

  if (def.type === "bogo") {
    const bogo = def.meta?.bogo;

    if (bogo) {
      return `${bogo.buyQty} kaufen, ${bogo.freeQty} gratis.`;
    }

    return "Gratis-Aktion für Ihre Bestellung.";
  }

  return "Gutschein für Ihre Bestellung.";
}

function isBelowMin(check: CheckResult) {
  return check.ok === false && check.reason === "below_min";
}

function dispatchCouponChanged() {
  if (typeof window === "undefined") return;

  try {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: LS_ACTIVE,
        newValue: localStorage.getItem(LS_ACTIVE),
        storageArea: window.localStorage,
      }),
    );
  } catch {
    try {
      window.dispatchEvent(new Event("storage"));
    } catch {}
  }

  try {
    window.dispatchEvent(new CustomEvent("bb_coupon_changed"));
    window.dispatchEvent(new CustomEvent("bb:coupon-sync"));
  } catch {}
}

function clearActiveCoupon() {
  if (typeof window === "undefined") return;

  try {
    localStorage.removeItem(LS_ACTIVE);
    localStorage.removeItem(LS_META);
    dispatchCouponChanged();
  } catch {}
}

function persistActiveCoupon(code: string, meta: ActiveMeta) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(LS_ACTIVE, cleanCode(code));
    localStorage.setItem(LS_META, JSON.stringify(meta));
    dispatchCouponChanged();
  } catch {}
}

function mapErr(reason: string, fallback?: string) {
  if (fallback) return fallback;

  switch (reason) {
    case "used":
      return "Dieser Gutschein wurde bereits verwendet.";
    case "expired":
    case "issued_expired":
      return "Dieser Gutschein ist abgelaufen.";
    case "not_started":
      return "Dieser Gutschein ist noch nicht aktiv.";
    case "not_available_yet":
      return "Dieser Gutschein ist noch nicht freigeschaltet.";
    case "assigned_other":
      return "Dieser Gutschein gehört zu einer anderen Telefonnummer.";
    case "below_min":
      return "Der Mindestbestellwert wurde noch nicht erreicht.";
    case "per_customer_limit":
      return "Dieser Gutschein wurde für diese Telefonnummer bereits verwendet.";
    case "max_uses_reached":
      return "Dieser Gutschein wurde bereits zu oft verwendet.";
    case "cancelled":
      return "Dieser Gutschein wurde storniert.";
    case "not_found":
      return "Gutschein wurde nicht gefunden.";
    default:
      return "Gutschein kann nicht verwendet werden.";
  }
}

function lightweightCheck(params: {
  def: CouponDef;
  issued?: IssuedCoupon | null;
  customerPhone?: string | null;
}): CheckResult {
  const now = nowTs();
  const { def, issued } = params;
  const customerPhone = normalizePhone(params.customerPhone);

  if (def.validFrom && now < def.validFrom) {
    return {
      ok: false,
      reason: "not_started",
      message: "Dieser Gutschein ist noch nicht aktiv.",
    };
  }

  if (def.validUntil && now > def.validUntil) {
    return {
      ok: false,
      reason: "expired",
      message: "Dieser Gutschein ist abgelaufen.",
    };
  }

  if (issued) {
    if (issued.used) {
      return {
        ok: false,
        reason: "used",
        message: "Dieser Gutschein wurde bereits verwendet.",
      };
    }

    if (issued.expiresAt && issued.expiresAt < now) {
      return {
        ok: false,
        reason: "issued_expired",
        message: "Dieser Gutschein ist abgelaufen.",
      };
    }

    if (
      issued.assignedToPhone &&
      customerPhone &&
      normalizePhone(issued.assignedToPhone) !== customerPhone
    ) {
      return {
        ok: false,
        reason: "assigned_other",
        message: "Dieser Gutschein gehört zu einer anderen Telefonnummer.",
      };
    }

    if (issued.note === "scheduled" && issued.issuedAt > now) {
      return {
        ok: false,
        reason: "not_available_yet",
        message: "Dieser Gutschein ist noch nicht freigeschaltet.",
      };
    }

    if (issued.note === "cancelled") {
      return {
        ok: false,
        reason: "cancelled",
        message: "Dieser Gutschein wurde storniert.",
      };
    }
  }

  return {
    ok: true,
    discountAmount: 0,
    message: "Gutschein akzeptiert.",
  };
}

function validateStaticCoupon(
  found: StaticCoupon,
  cartTotal?: number,
): CheckResult {
  const now = nowTs();

  if (!found.active) {
    return {
      ok: false,
      reason: "inactive",
      message: "Dieser Gutschein ist nicht aktiv.",
    };
  }

  if (found.validFrom && found.validFrom > now) {
    return {
      ok: false,
      reason: "not_started",
      message: "Dieser Gutschein ist noch nicht aktiv.",
    };
  }

  if (found.validTo && found.validTo < now) {
    return {
      ok: false,
      reason: "expired",
      message: "Dieser Gutschein ist abgelaufen.",
    };
  }

  if (
    typeof cartTotal === "number" &&
    typeof found.minCartTotal === "number" &&
    cartTotal < found.minCartTotal
  ) {
    return {
      ok: false,
      reason: "below_min",
      message: `Mindestbestellwert: ${found.minCartTotal.toFixed(2)}€.`,
    };
  }

  const discountAmount =
    typeof cartTotal === "number"
      ? found.type === "fixed"
        ? Math.min(found.value, Math.max(0, cartTotal))
        : found.type === "percent"
          ? Math.max(0, cartTotal) * (found.value / 100)
          : 0
      : 0;

  return {
    ok: true,
    discountAmount: Math.round(discountAmount * 100) / 100,
    message: "Gutschein akzeptiert.",
  };
}

function findSuggestedCouponForPhone(params: {
  customerPhone?: string | null;
  cartTotal?: number;
  cartItems?: CartItemForCoupon[];
}): SuggestedCoupon | null {
  const phone = normalizePhone(params.customerPhone);

  if (!phone || phone.length < 6) return null;

  const now = nowTs();
  const coupons = getAllCoupons();
  const issuedCoupons = getAllIssued();

  const candidates = issuedCoupons
    .filter((issued) => {
      if (!samePhone(issued.assignedToPhone, phone)) return false;
      if (issued.used) return false;
      if (issued.note === "cancelled") return false;
      if (issued.note === "scheduled" && issued.issuedAt > now) return false;
      if (issued.expiresAt && issued.expiresAt < now) return false;

      return true;
    })
    .sort((a, b) => {
      const aExpires = a.expiresAt || Number.MAX_SAFE_INTEGER;
      const bExpires = b.expiresAt || Number.MAX_SAFE_INTEGER;

      if (aExpires !== bExpires) return aExpires - bExpires;

      return (b.issuedAt || 0) - (a.issuedAt || 0);
    });

  for (const issued of candidates) {
    const def = coupons.find((coupon) => coupon.id === issued.couponId) || null;

    if (!def) continue;
    if (def.validFrom && now < def.validFrom) continue;
    if (def.validUntil && now > def.validUntil) continue;

    const check =
      typeof params.cartTotal === "number"
        ? canApply({
            def,
            issued,
            cartTotal: params.cartTotal,
            cartItems: params.cartItems || [],
            customerPhone: phone,
            now,
          })
        : lightweightCheck({
            def,
            issued,
            customerPhone: phone,
          });

    if (check.ok || isBelowMin(check)) {
      return {
        def,
        issued,
        check,
        validUntil: issued.expiresAt ?? def.validUntil ?? null,
      };
    }
  }

  return null;
}

export default function CouponBox({
  cartTotal,
  cartItems,
  customerPhone,
  className = "",
}: CouponBoxProps) {
  const { toast, ToastNode } = useToast();

  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status>({ type: "none" });
  const [loading, setLoading] = useState(false);
  const [couponTick, setCouponTick] = useState(0);
  const [settingsTick, setSettingsTick] = useState(0);
  const [suggested, setSuggested] = useState<SuggestedCoupon | null>(null);

  const staticCoupons = useMemo<StaticCoupon[]>(() => {
    const settings: any = readSettings() || {};
    const list: any[] = Array.isArray(settings?.coupons) ? settings.coupons : [];

    return list
      .filter((item) => item && (item.code || item.kod || item.name))
      .map((item) => ({
        code: cleanCode(String(item.code ?? item.kod ?? item.name ?? "")),
        active: item.active !== false,
        type: (item.type ?? "percent") as CouponDef["type"],
        value: Number(item.value ?? item.rate ?? 0),
        validFrom: parseTs(item.validFrom ?? item.start),
        validTo: parseTs(item.validTo ?? item.end),
        minCartTotal:
          item.minCartTotal != null || item.minSubtotal != null
            ? Number(item.minCartTotal ?? item.minSubtotal)
            : undefined,
        title: item.title ?? item.label ?? "",
      }));
  }, [settingsTick]);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      setLoading(true);

      try {
        await syncCouponsFromServer();
      } catch {}

      if (cancelled) return;

      setCouponTick((x) => x + 1);
      setLoading(false);

      try {
        const previous = cleanCode(localStorage.getItem(LS_ACTIVE) || "");
        if (previous) {
          await validateAndPersist(previous, {
            silent: true,
            skipConfirm: true,
          });
        }
      } catch {}
    }

    boot();

    const onCoupons = () => setCouponTick((x) => x + 1);
    const onSettings = () => setSettingsTick((x) => x + 1);
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === LS_ACTIVE || event.key === LS_META) {
        const active = cleanCode(localStorage.getItem(LS_ACTIVE) || "");
        setCode(active);
      }

      setCouponTick((x) => x + 1);
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("bb_coupons_changed", onCoupons as EventListener);
    window.addEventListener("bb:coupons-sync", onCoupons as EventListener);
    window.addEventListener("bb_settings_changed", onSettings as EventListener);
    window.addEventListener("bb:settings-sync", onSettings as EventListener);

    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("bb_coupons_changed", onCoupons as EventListener);
      window.removeEventListener("bb:coupons-sync", onCoupons as EventListener);
      window.removeEventListener("bb_settings_changed", onSettings as EventListener);
      window.removeEventListener("bb:settings-sync", onSettings as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeCode = useMemo(() => {
    try {
      return cleanCode(localStorage.getItem(LS_ACTIVE) || "");
    } catch {
      return "";
    }
  }, [couponTick]);

  useEffect(() => {
    let cancelled = false;

    async function refreshSuggestedCoupon() {
      const phone = normalizePhone(customerPhone);

      if (!phone || phone.length < 6) {
        setSuggested(null);
        return;
      }

      try {
        await syncCouponsFromServer();
      } catch {}

      if (cancelled) return;

      const found = findSuggestedCouponForPhone({
        customerPhone: phone,
        cartTotal,
        cartItems,
      });

      setSuggested(found);
      setCouponTick((x) => x + 1);
    }

    refreshSuggestedCoupon();

    return () => {
      cancelled = true;
    };
  }, [customerPhone, cartTotal, cartItems]);

  const inputClass =
    status.type === "ok"
      ? "border-emerald-500/70 bg-emerald-950/30 ring-1 ring-emerald-500/30"
      : status.type === "error"
        ? "border-rose-500/70 bg-rose-950/20 ring-1 ring-rose-500/20"
        : "border-stone-700/60 bg-stone-800/60";

  const suggestedCode = cleanCode(suggested?.issued?.code || "");
  const suggestedIsActive = Boolean(activeCode && suggestedCode && activeCode === suggestedCode);
  const suggestedBelowMin = suggested ? isBelowMin(suggested.check) : false;

  const onApply = () => {
    void validateAndPersist(code.trim(), {
      silent: false,
      skipConfirm: false,
    });
  };

  const onApplySuggested = () => {
    if (!suggestedCode) return;

    setCode(suggestedCode);

    void validateAndPersist(suggestedCode, {
      silent: false,
      skipConfirm: false,
    });
  };

  const onClear = () => {
    clearActiveCoupon();
    setStatus({ type: "none" });
    setCode("");
    toast?.("Gutschein entfernt");
  };

  return (
    <>
      {ToastNode}

      <div
        className={`rounded-xl border border-stone-700/60 bg-stone-900/60 p-3 space-y-3 ${className}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">Gutschein</div>

          {activeCode && (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">
              Aktiv: {activeCode}
            </span>
          )}
        </div>

        {suggested && !suggestedIsActive && (
          <div className="rounded-xl border border-amber-400/50 bg-amber-500/10 p-3 text-sm text-amber-50">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-400 text-xl text-black">
                🎁
              </div>

              <div className="min-w-0 flex-1">
                <div className="font-semibold text-amber-100">
                  Gutschein für Ihre Telefonnummer verfügbar!
                </div>

                <div className="mt-1 text-stone-100">
                  <b>{couponTitle(suggested.def)}</b>
                </div>

                <div className="mt-1 text-xs text-stone-200/90">
                  {couponDescription(suggested.def)}
                </div>

                <div className="mt-2 grid gap-1 text-xs text-stone-200/85 sm:grid-cols-2">
                  <div>
                    Code:{" "}
                    <b className="tracking-wider text-amber-100">
                      {suggestedCode}
                    </b>
                  </div>

                  <div>
                    Gültig bis:{" "}
                    <b className="text-amber-100">
                      {formatDate(suggested.validUntil)}
                    </b>
                  </div>

                  {typeof suggested.def.minCartTotal === "number" && (
                    <div className="sm:col-span-2">
                      Mindestbestellwert:{" "}
                      <b className="text-amber-100">
                        {formatMoney(suggested.def.minCartTotal)}
                      </b>
                    </div>
                  )}
                </div>

                {suggestedBelowMin && suggested.check.ok === false && (
                  <div className="mt-2 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-xs text-amber-100">
                    {suggested.check.message}
                  </div>
                )}

                <button
                  type="button"
                  onClick={onApplySuggested}
                  disabled={loading}
                  className="mt-3 rounded-full bg-amber-400 px-4 py-2 text-xs font-bold text-black hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Gutschein anwenden
                </button>
              </div>
            </div>
          </div>
        )}

        {suggested && suggestedIsActive && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
            🎁 Ihr persönlicher Gutschein ist aktiv:{" "}
            <b className="tracking-wider">{suggestedCode}</b>
            <div className="mt-1 text-xs text-emerald-100/80">
              Gültig bis: {formatDate(suggested.validUntil)}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <input
            value={code}
            onChange={(event) => {
              setCode(cleanCode(event.target.value));
              if (status.type !== "none") setStatus({ type: "none" });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onApply();
              }
            }}
            placeholder="CODE"
            className={`w-full rounded-md border p-2 uppercase tracking-widest outline-none transition ${inputClass}`}
            disabled={loading}
          />

          <button
            onClick={onApply}
            disabled={loading}
            className="rounded-md bg-emerald-500 px-3 py-2 font-semibold text-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "..." : "Prüfen"}
          </button>

          <button
            onClick={onClear}
            className="rounded-md bg-stone-700 px-3 py-2 font-semibold hover:bg-stone-600"
            title="Code entfernen"
          >
            ✕
          </button>
        </div>

        {status.type !== "none" && (
          <div
            className={`text-sm ${
              status.type === "ok" ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {status.msg}
          </div>
        )}
      </div>
    </>
  );

  async function validateAndPersist(
    rawInput: string,
    opts: {
      silent: boolean;
      skipConfirm: boolean;
    },
  ) {
    const input = cleanCode(rawInput);

    if (!input) {
      if (!opts.silent) {
        setStatus({ type: "error", msg: "Bitte Code eingeben." });
      }
      return;
    }

    const currentActive = cleanCode(localStorage.getItem(LS_ACTIVE) || "");

    if (
      currentActive &&
      currentActive !== input &&
      !opts.silent &&
      !opts.skipConfirm
    ) {
      const ok = window.confirm(
        "Es ist bereits ein Gutschein aktiv. Möchten Sie den aktuellen Gutschein ersetzen?",
      );

      if (!ok) return;
    }

    setLoading(true);

    try {
      await syncCouponsFromServer();
      setCouponTick((x) => x + 1);
    } catch {}

    try {
      const found = findCouponByAnyCode(input);

      if (found.def) {
        const check =
          typeof cartTotal === "number"
            ? canApply({
                def: found.def,
                issued: found.issued,
                cartTotal,
                cartItems: cartItems || [],
                customerPhone,
              })
            : lightweightCheck({
                def: found.def,
                issued: found.issued,
                customerPhone,
              });

        if (!check.ok) {
          const msg = mapErr(check.reason, check.message);

          if (!opts.silent) {
            setStatus({ type: "error", msg });
            toast?.(msg);
          } else {
            clearActiveCoupon();
          }

          setLoading(false);
          return;
        }

        const meta: ActiveMeta = {
          kind: found.issued ? "issued" : "db",
          couponId: found.def.id,
          issuedId: found.issued?.id ?? null,
          code: input,
          type: found.def.type,
          value: Number(found.def.value || 0),
          title: found.def.title,
          discountAmount: check.discountAmount,
          message: check.message,
        };

        persistActiveCoupon(input, meta);
        setCode(input);
        setStatus({ type: "ok", msg: check.message || "Gutschein akzeptiert." });

        if (!opts.silent) {
          toast?.("Gutschein akzeptiert");
        }

        setLoading(false);
        return;
      }

      const staticCoupon = staticCoupons.find(
        (item) => item.active && item.code === input,
      );

      if (!staticCoupon) {
        const msg = "Ungültiger Gutschein.";

        if (!opts.silent) {
          setStatus({ type: "error", msg });
          toast?.(msg);
        } else {
          clearActiveCoupon();
        }

        setLoading(false);
        return;
      }

      const staticCheck = validateStaticCoupon(staticCoupon, cartTotal);

      if (!staticCheck.ok) {
        const msg = mapErr(staticCheck.reason, staticCheck.message);

        if (!opts.silent) {
          setStatus({ type: "error", msg });
          toast?.(msg);
        } else {
          clearActiveCoupon();
        }

        setLoading(false);
        return;
      }

      persistActiveCoupon(input, {
        kind: "static",
        couponId: "static:" + staticCoupon.code,
        code: input,
        type: staticCoupon.type,
        value: Number(staticCoupon.value || 0),
        title: staticCoupon.title,
        discountAmount: staticCheck.discountAmount,
        message: staticCheck.message,
      });

      setCode(input);
      setStatus({ type: "ok", msg: staticCheck.message || "Gutschein akzeptiert." });

      if (!opts.silent) {
        toast?.("Gutschein akzeptiert");
      }
    } finally {
      setLoading(false);
    }
  }
}