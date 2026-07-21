"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import PaymentTrustBadges from "@/components/PaymentTrustBadges";
import { rememberCustomerTracking } from "@/lib/customer-tracking";

type ShareState = {
  ok?: boolean;
  paymentSessionId?: string;
  finalOrderId?: string | null;
  trackingToken?: string | null;
  mode?: "pickup" | "delivery" | string | null;
  planned?: string | null;
  etaMin?: number | null;
  etaAdjustMin?: number | null;
  finalized?: boolean;
  sessionStatus?: string;
  paidCount?: number;
  totalCount?: number;
  share?: {
    index: number;
    label: string;
    amount: number;
    baseAmount: number;
    serviceFee: number;
    status: string;
    items?: Array<{ key?: string; label?: string }>;
    shareUrl?: string;
  };
  message?: string | null;
  error?: string | null;
};

const fmt = (value: number) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(Number(value || 0));

function cleanShareUrl() {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${window.location.pathname}`;
}

function normalizedOrderMode(value: any) {
  return String(value || "").toLowerCase() === "pickup"
    ? "pickup"
    : "delivery";
}

function plannedConfirmationLabel(mode: any) {
  return normalizedOrderMode(mode) === "pickup"
    ? "Geplante Abholung"
    : "Geplante Lieferung";
}

function etaConfirmationLabel(mode: any) {
  return normalizedOrderMode(mode) === "pickup"
    ? "Vorbereitungszeit"
    : "Voraussichtliche Lieferung";
}

function effectiveEtaMinutes(state: ShareState) {
  const base = Number(state.etaMin);
  const adjust = Number(state.etaAdjustMin);
  const safeBase = Number.isFinite(base) ? base : 0;
  const safeAdjust = Number.isFinite(adjust) ? adjust : 0;
  const value = Math.round(safeBase + safeAdjust);

  return value > 0 ? value : null;
}

export default function SharedPaymentPage() {
  const routeParams = useParams();
  const searchParams = useSearchParams();
  const token = useMemo(() => {
    const raw = routeParams?.token;
    return Array.isArray(raw) ? String(raw[0] || "") : String(raw || "");
  }, [routeParams]);
  const checkoutSessionId = String(
    searchParams.get("checkout_session_id") || "",
  ).trim();
  const paymentCancelled = searchParams.get("payment") === "cancelled";

  const [state, setState] = useState<ShareState>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rememberPayment, setRememberPayment] = useState(true);
  const [profileSaved, setProfileSaved] = useState(false);
  const [notice, setNotice] = useState(
    paymentCancelled ? "Die Zahlung wurde abgebrochen. Du kannst es erneut versuchen." : "",
  );
  const [refreshVersion, setRefreshVersion] = useState(0);
  const profileAttempted = useRef(false);

  useEffect(() => {
    if (!token) return;

    let active = true;
    let timer: number | null = null;

    const load = async () => {
      try {
        const response = await fetch(
          `/api/payments/share?token=${encodeURIComponent(token)}`,
          { cache: "no-store" },
        );
        const payload = await response.json().catch(() => ({}));

        if (!active) return;

        setState(payload);
        setLoading(false);

        const terminal =
          payload?.finalized ||
          payload?.share?.status === "paid" ||
          payload?.sessionStatus === "failed" ||
          payload?.sessionStatus === "expired" ||
          payload?.sessionStatus === "refunded";

        if (!terminal) {
          timer = window.setTimeout(load, 2200);
        }
      } catch (error: any) {
        if (!active) return;
        setState({
          ok: false,
          error: error?.message || "Zahlungsanteil konnte nicht geladen werden.",
        });
        setLoading(false);
      }
    };

    void load();

    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [token, refreshVersion]);

  useEffect(() => {
    const restore = () => {
      document.documentElement.classList.remove("bb-route-pending");
      document.body.classList.remove("bb-route-pending");
      setBusy(false);
      setLoading(true);
      setRefreshVersion((value) => value + 1);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") restore();
    };
    window.addEventListener("pageshow", restore);
    window.addEventListener("focus", restore);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pageshow", restore);
      window.removeEventListener("focus", restore);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    if (
      profileAttempted.current ||
      !checkoutSessionId ||
      !state.paymentSessionId ||
      !token
    ) {
      return;
    }

    profileAttempted.current = true;

    void fetch("/api/payments/profile", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        checkoutSessionId,
        paymentSessionId: state.paymentSessionId,
        shareToken: token,
      }),
      cache: "no-store",
    })
      .then((response) => response.json().catch(() => ({})))
      .then((payload) => {
        if (payload?.remembered) setProfileSaved(true);
      })
      .catch(() => null);
  }, [checkoutSessionId, state.paymentSessionId, token]);

  useEffect(() => {
    if (!state.finalized || !state.finalOrderId || !state.trackingToken) {
      return;
    }

    rememberCustomerTracking({
      trackingToken: state.trackingToken,
      orderId: state.finalOrderId,
    });
  }, [state.finalized, state.finalOrderId, state.trackingToken]);

  const share = state.share;
  const paid = share?.status === "paid";
  const failed =
    state.ok === false ||
    state.sessionStatus === "failed" ||
    state.sessionStatus === "expired" ||
    state.sessionStatus === "refunded";
  const finalEtaMinutes = effectiveEtaMinutes(state);
  const trackingHref = state.trackingToken
    ? `/track/${encodeURIComponent(state.trackingToken)}`
    : "/track";

  const startPayment = async () => {
    if (!token || busy) return;

    try {
      setBusy(true);
      setNotice("");

      const response = await fetch("/api/payments/share", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token,
          rememberPayment,
        }),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || payload?.ok === false) {
        throw new Error(
          payload?.message ||
            payload?.error ||
            "Die Zahlung konnte nicht gestartet werden.",
        );
      }

      if (payload?.paid) {
        window.location.reload();
        return;
      }

      if (!payload?.url) {
        throw new Error("Stripe-Zahlungsseite fehlt.");
      }

      window.location.assign(String(payload.url));
    } catch (error: any) {
      setNotice(
        error?.message || "Die Zahlung konnte nicht gestartet werden.",
      );
      setBusy(false);
    }
  };

  const sendWhatsApp = () => {
    if (!share) return;

    const url = share.shareUrl || cleanShareUrl();
    const message = [
      "Hallo 👋",
      "",
      "du wurdest zu einer gemeinsamen Bestellung bei Burger Brothers eingeladen.",
      "",
      `Dein Anteil: ${fmt(share.amount)}`,
      "",
      "Hier sicher bezahlen:",
      url,
      "",
      "Die Bestellung wird erst bestätigt, wenn alle Anteile bezahlt wurden.",
    ].join("\n");

    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    const standalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      Boolean((navigator as any).standalone);
    if (standalone || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "")) {
      window.location.href = whatsappUrl;
      return;
    }
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <main className="mx-auto min-h-[100dvh] max-w-xl px-4 py-8 text-stone-100 sm:px-6">
      <div className="rounded-3xl border border-stone-700/60 bg-stone-950/95 p-5 shadow-2xl sm:p-7">
        <div className="mb-6 flex items-center gap-3">
          <img
            src="/logo-burger-brothers.png"
            alt="Burger Brothers Berlin"
            className="h-12 w-12 rounded-full"
          />
          <div>
            <h1 className="text-2xl font-black">Burger Brothers</h1>
            <p className="text-sm text-stone-400">Gemeinsame Bestellung</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-3 rounded-2xl border border-stone-700/60 p-6 text-sm text-stone-300">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-stone-600 border-t-amber-300" />
            Zahlungsanteil wird geladen …
          </div>
        ) : state.finalized ? (
          <div className="rounded-2xl border border-emerald-500/50 bg-emerald-500/10 p-5">
            <div className="text-4xl">✅</div>
            <h2 className="mt-3 text-2xl font-black">Bestellung vollständig bezahlt</h2>
            <p className="mt-2 text-stone-300">
              Alle Anteile wurden bezahlt und die Bestellung wurde an die Küche gesendet.
            </p>
            {!!state.finalOrderId && (
              <div className="mt-4 rounded-xl bg-black/35 p-4">
                <div className="text-xs uppercase tracking-wide text-stone-400">
                  Bestellnummer
                </div>
                <div className="mt-1 text-3xl font-black text-amber-300">
                  #{state.finalOrderId}
                </div>
              </div>
            )}

            {(state.planned || finalEtaMinutes) && (
              <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-50">
                {state.planned ? (
                  <>
                    {plannedConfirmationLabel(state.mode)}:{" "}
                    <b>{state.planned} Uhr</b>
                  </>
                ) : (
                  <>
                    {etaConfirmationLabel(state.mode)}:{" "}
                    <b>{finalEtaMinutes} Min</b>
                  </>
                )}
              </div>
            )}

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Link
                href="/menu"
                className="block rounded-xl bg-amber-400 px-4 py-3 text-center font-black text-black"
              >
                Zur Speisekarte
              </Link>
              <Link
                href={trackingHref}
                className="block rounded-xl border border-emerald-400/60 bg-emerald-500/10 px-4 py-3 text-center font-black text-emerald-100"
              >
                Bestellung verfolgen
              </Link>
            </div>
          </div>
        ) : paid ? (
          <div className="rounded-2xl border border-emerald-500/50 bg-emerald-500/10 p-5">
            <div className="text-4xl">✅</div>
            <h2 className="mt-3 text-2xl font-black">Dein Anteil ist bezahlt</h2>
            <p className="mt-2 text-stone-300">
              {state.paidCount || 0} von {state.totalCount || 0} Personen haben bezahlt.
              Die Bestellung wird automatisch gesendet, sobald alle Anteile bezahlt sind.
            </p>
            {profileSaved && (
              <div className="mt-3 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-100">
                Deine Zahlungsart wurde auf diesem Gerät sicher gespeichert. Beim nächsten Mal zeigt Stripe sie direkt an.
              </div>
            )}
          </div>
        ) : failed ? (
          <div className="rounded-2xl border border-rose-500/50 bg-rose-500/10 p-5">
            <div className="text-4xl">⚠️</div>
            <h2 className="mt-3 text-xl font-black">Zahlungslink nicht verfügbar</h2>
            <p className="mt-2 text-sm text-rose-100">
              {state.message || state.error || "Dieser Zahlungslink kann nicht mehr verwendet werden."}
            </p>
          </div>
        ) : share ? (
          <>
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5">
              <div className="text-sm font-semibold uppercase tracking-wide text-amber-200">
                {share.label}
              </div>
              <div className="mt-2 text-4xl font-black text-amber-300">
                {fmt(share.amount)}
              </div>
              {share.serviceFee > 0 && (
                <div className="mt-1 text-xs text-stone-400">
                  inkl. {fmt(share.serviceFee)} Servicegebühr
                </div>
              )}

              {!!share.items?.length && (
                <div className="mt-4 rounded-xl bg-black/25 p-3 text-sm text-stone-300">
                  {share.items
                    .map((item) => String(item?.label || "").trim())
                    .filter(Boolean)
                    .join(", ")}
                </div>
              )}
            </div>

            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3">
              <input
                type="checkbox"
                checked={rememberPayment}
                onChange={(event) => setRememberPayment(event.target.checked)}
                className="mt-1 h-4 w-4"
              />
              <span>
                <span className="block text-sm font-semibold text-sky-100">
                  Zahlungsart für das nächste Mal merken
                </span>
                <span className="mt-1 block text-xs text-stone-400">
                  Stripe speichert kompatible Karten, Link oder PayPal sicher. Bei Bedarf kann eine erneute Bestätigung erforderlich sein.
                </span>
              </span>
            </label>

            {!!notice && (
              <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-100">
                {notice}
              </div>
            )}

            <button
              type="button"
              disabled={busy}
              onClick={startPayment}
              className="mt-5 w-full rounded-xl bg-amber-400 px-4 py-3 font-black text-black disabled:opacity-50"
            >
              {busy ? "Stripe wird geöffnet …" : `Jetzt sicher bezahlen • ${fmt(share.amount)}`}
            </button>

            <button
              type="button"
              onClick={sendWhatsApp}
              className="mt-3 w-full rounded-xl border border-emerald-500/50 bg-emerald-500/10 px-4 py-3 font-bold text-emerald-100"
            >
              Per WhatsApp weiterleiten
            </button>
          </>
        ) : null}

        <div className="mt-6 text-center text-xs text-stone-500">
          Sichere Zahlungsabwicklung über Stripe. Zahlungsdaten werden nicht auf dem Burger-Brothers-Server gespeichert.
        </div>

        <Link
          href="/menu"
          className="mt-4 block text-center text-sm text-stone-400 underline decoration-stone-600 underline-offset-4"
        >
          Zur Speisekarte
        </Link>
      </div>
    <PaymentTrustBadges className="mt-4" />
</main>
  );
}
