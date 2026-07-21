"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useCart } from "@/components/store";
import PaymentTrustBadges from "@/components/PaymentTrustBadges";
import { rememberCustomerTracking } from "@/lib/customer-tracking";

type PaymentState = {
  ok?: boolean;
  paymentKind?: string;
  status?: string;
  finalized?: boolean;
  finalOrderId?: string;
  trackingToken?: string | null;
  mode?: string | null;
  planned?: string | null;
  etaMin?: number | null;
  etaAdjustMin?: number | null;
  recoveryExpiresAt?: string | null;
  actionRequired?: boolean;
  actionUrl?: string | null;
  paymentMethodType?: string | null;
  paymentError?: string | null;
  message?: string | null;
  error?: string | null;
};

function clearRecovery() {
  try {
    localStorage.removeItem("bb_active_payment_recovery_v1");
    sessionStorage.removeItem("bb_active_payment_session");
    window.dispatchEvent(new CustomEvent("bb:payment-recovery-changed"));
  } catch {}
}

function countdown(expiresAt: any, nowMs: number) {
  const end = Date.parse(String(expiresAt || ""));
  if (!Number.isFinite(end)) return "";
  const seconds = Math.max(0, Math.ceil((end - nowMs) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function etaLabel(state: PaymentState) {
  if (state.planned) {
    return `${state.mode === "pickup" ? "Geplante Abholung" : "Geplante Lieferung"}: ${state.planned}`;
  }
  const eta = Math.max(
    0,
    Number(state.etaMin || 0) + Number(state.etaAdjustMin || 0),
  );
  return eta > 0 ? `Voraussichtliche Zeit: ca. ${eta} Minuten` : "";
}

function methodLabel(type: any) {
  const value = String(type || "").toLowerCase();
  if (value === "paypal") return "PayPal";
  if (value === "card") return "Karte";
  if (value === "link") return "Link";
  return "Online-Zahlung";
}

function PaymentCenterContent() {
  const params = useSearchParams();
  const paymentSessionId = String(params.get("paymentSession") || "").trim();
  const recoveryToken = String(params.get("recovery") || "").trim();
  const checkoutSessionId = String(
    params.get("checkout_session_id") || "",
  ).trim();
  const { clear } = useCart() as any;
  const [state, setState] = useState<PaymentState>({ status: "loading" });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busy, setBusy] = useState("");
  const [refresh, setRefresh] = useState(0);
  const profileAttempted = useRef(false);

  const sessionUrl = useMemo(
    () =>
      `/api/payments/session?id=${encodeURIComponent(paymentSessionId)}&recovery=${encodeURIComponent(recoveryToken)}`,
    [paymentSessionId, recoveryToken],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!paymentSessionId || !recoveryToken) {
      setState({
        status: "failed",
        error: "PAYMENT_ACCESS_MISSING",
        message: "Der Zahlungszugriff fehlt.",
      });
      return;
    }
    let active = true;
    let timer = 0;
    const load = async () => {
      try {
        const response = await fetch(sessionUrl, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!active) return;
        setState(payload);
        if (payload?.paymentKind === "split_contactless") {
          const url = new URL("/payment/split", window.location.origin);
          url.searchParams.set("paymentSession", paymentSessionId);
          url.searchParams.set("recovery", recoveryToken);
          window.location.replace(url.toString());
          return;
        }
        if (payload?.finalized) {
          try {
            clear?.();
            localStorage.removeItem("bb_active_coupon_code");
            localStorage.removeItem("bb_active_coupon_meta");
            clearRecovery();
            if (payload.trackingToken) {
              rememberCustomerTracking({
                trackingToken: payload.trackingToken,
                orderId: payload.finalOrderId,
              });
            }
          } catch {}
          return;
        }
        if (
          ["expired", "refunded", "cancelled"].includes(
            String(payload?.status || ""),
          ) ||
          [
            "PAYMENT_INTEGRITY_INVALID",
            "PAYMENT_SHARES_MISSING",
            "FINAL_ORDER_PAYLOAD_MISSING",
            "INVALID_PAYMENT_SESSION",
          ].includes(String(payload?.error || ""))
        ) {
          clearRecovery();
          return;
        }
        if (
          ["pending", "processing", "paid"].includes(
            String(payload?.status || ""),
          )
        ) {
          timer = window.setTimeout(load, 2200);
        }
      } catch (error: any) {
        if (active)
          setState({
            status: "failed",
            message:
              error?.message || "Zahlungsstatus konnte nicht geladen werden.",
          });
      }
    };
    void load();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [sessionUrl, paymentSessionId, recoveryToken, refresh, clear]);

  useEffect(() => {
    if (profileAttempted.current || !checkoutSessionId || !paymentSessionId)
      return;
    profileAttempted.current = true;
    void fetch("/api/payments/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkoutSessionId, paymentSessionId }),
      cache: "no-store",
      credentials: "same-origin",
    }).catch(() => null);
  }, [checkoutSessionId, paymentSessionId]);

  async function mutate(action: string) {
    if (busy) return;
    try {
      setBusy(action);
      const response = await fetch("/api/payments/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, paymentSessionId, recoveryToken }),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (payload?.url) {
        window.location.assign(String(payload.url));
        return;
      }
      if (action === "cancel" && payload?.cancelled) {
        clearRecovery();
        window.location.assign("/checkout?payment=cancelled");
        return;
      }
      setState((current) => ({ ...current, ...payload }));
      setRefresh((value) => value + 1);
    } catch (error: any) {
      setState((current) => ({
        ...current,
        message:
          error?.message || "Die Zahlung konnte nicht bearbeitet werden.",
      }));
    } finally {
      setBusy("");
    }
  }

  const finalized = state.finalized === true;
  const terminal =
    ["expired", "refunded", "cancelled"].includes(String(state.status || "")) ||
    [
      "PAYMENT_INTEGRITY_INVALID",
      "PAYMENT_SHARES_MISSING",
      "FINAL_ORDER_PAYLOAD_MISSING",
      "INVALID_PAYMENT_SESSION",
    ].includes(String(state.error || ""));
  const failed =
    state.status === "failed" ||
    state.ok === false ||
    Boolean(state.paymentError);
  const remaining = countdown(state.recoveryExpiresAt, nowMs);
  const trackHref = state.trackingToken
    ? `/track/${encodeURIComponent(state.trackingToken)}`
    : "/track";

  return (
    <main className="mx-auto min-h-[100dvh] max-w-2xl px-4 py-8 text-stone-100 sm:px-6">
      <div className="rounded-3xl border border-stone-700/60 bg-stone-950/90 p-5 shadow-2xl sm:p-7">
        <div className="text-xs font-black uppercase tracking-[0.24em] text-amber-300">
          Payment Center
        </div>

        {state.status === "loading" ? (
          <div className="mt-6 flex items-center justify-center gap-3 text-stone-300">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-stone-600 border-t-amber-300" />
            Zahlung wird geprüft …
          </div>
        ) : finalized ? (
          <>
            <h1 className="mt-3 text-3xl font-black text-emerald-300">
              Zahlung erfolgreich ✅
            </h1>
            <div className="mt-5 space-y-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <div>
                <span className="text-stone-400">Bestellnummer:</span>{" "}
                <strong>{state.finalOrderId}</strong>
              </div>
              <div>
                <span className="text-stone-400">Zahlungsart:</span>{" "}
                <strong>{methodLabel(state.paymentMethodType)}</strong>
              </div>
              {etaLabel(state) && (
                <div className="font-semibold text-amber-100">
                  {etaLabel(state)}
                </div>
              )}
            </div>
            <Link
              href={trackHref}
              className="mt-5 block rounded-xl bg-emerald-400 px-4 py-3 text-center font-black text-black"
            >
              Bestellung verfolgen
            </Link>
            <Link
              href="/menu"
              className="mt-3 block rounded-xl border border-stone-700 px-4 py-3 text-center font-bold"
            >
              Zur Speisekarte
            </Link>
          </>
        ) : terminal ? (
          <>
            <h1 className="mt-3 text-2xl font-black text-rose-200">
              Zahlung nicht abgeschlossen
            </h1>
            <p className="mt-3 text-stone-300">
              {state.message ||
                "Die Zahlungssitzung ist beendet. Es wurde keine neue Bestellung erstellt."}
            </p>
            <Link
              href="/checkout"
              className="mt-5 block rounded-xl bg-amber-400 px-4 py-3 text-center font-black text-black"
            >
              Zurück zum Checkout
            </Link>
          </>
        ) : (
          <>
            <h1
              className={`mt-3 text-2xl font-black ${failed ? "text-rose-200" : "text-amber-100"}`}
            >
              {failed ? "Zahlung nicht abgeschlossen" : "Zahlung noch offen"}
            </h1>
            {remaining && (
              <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                Verbleibende Zeit: <strong>{remaining}</strong>
              </div>
            )}
            <p className="mt-4 text-sm leading-6 text-stone-300">
              {state.paymentError ||
                state.message ||
                (state.actionRequired
                  ? "Deine Bank oder dein Zahlungsanbieter benötigt noch eine kurze Bestätigung."
                  : "Die Zahlung wurde noch nicht vollständig bestätigt.")}
            </p>

            <div className="mt-5 grid gap-3">
              <button
                onClick={() => void mutate("resume")}
                disabled={Boolean(busy)}
                className="rounded-xl bg-amber-400 px-4 py-3 font-black text-black disabled:opacity-50"
              >
                {busy === "resume"
                  ? "Wird geöffnet …"
                  : state.actionRequired
                    ? "Zahlung bestätigen"
                    : "Zahlung fortsetzen"}
              </button>
              {state.paymentMethodType && (
                <button
                  onClick={() => void mutate("retry_saved")}
                  disabled={Boolean(busy)}
                  className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 font-bold text-emerald-100 disabled:opacity-50"
                >
                  {busy === "retry_saved"
                    ? "Wird versucht …"
                    : "Erneut mit gespeicherter Zahlungsart versuchen"}
                </button>
              )}
              <button
                onClick={() => void mutate("other_method")}
                disabled={Boolean(busy)}
                className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-3 font-bold text-sky-100 disabled:opacity-50"
              >
                {busy === "other_method"
                  ? "Stripe wird geöffnet …"
                  : "Andere Zahlungsart"}
              </button>
              <button
                onClick={() => void mutate("cancel")}
                disabled={Boolean(busy)}
                className="rounded-xl border border-rose-500/50 bg-rose-500/10 px-4 py-3 font-bold text-rose-100 disabled:opacity-50"
              >
                {busy === "cancel" ? "Wird abgebrochen …" : "Zahlung abbrechen"}
              </button>
            </div>
          </>
        )}
      </div>
      <PaymentTrustBadges className="mt-4" />
    </main>
  );
}

export default function PaymentCenterPage() {
  return (
    <Suspense
      fallback={
        <main className="p-8 text-center text-stone-200">
          Payment Center wird geladen …
        </main>
      }
    >
      <PaymentCenterContent />
    </Suspense>
  );
}
