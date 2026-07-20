"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useCart } from "@/components/store";
import PaymentTrustBadges from "@/components/PaymentTrustBadges";

type ShareItem = {
  key?: string;
  label?: string;
};

type Share = {
  index: number;
  label: string;
  amount: number;
  baseAmount: number;
  serviceFee: number;
  status: string;
  shareUrl?: string | null;
  items?: ShareItem[];
};

type PaymentState = {
  ok?: boolean;
  status?: string;
  finalized?: boolean;
  finalOrderId?: string;
  paidCount?: number;
  totalCount?: number;
  nextUrl?: string | null;
  nextShareIndex?: number | null;
  whatsappShareEnabled?: boolean;
  shares?: Share[];
  message?: string;
  error?: string;
};

const fmt = (value: number) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(Number(value || 0));

function whatsappMessage(share: Share) {
  return [
    "Hallo 👋",
    "",
    "du wurdest zu einer gemeinsamen Bestellung bei Burger Brothers eingeladen.",
    "",
    `Dein Anteil: ${fmt(share.amount)}`,
    "",
    "Hier sicher bezahlen:",
    String(share.shareUrl || ""),
    "",
    "Die Bestellung wird erst bestätigt, wenn alle Anteile bezahlt wurden.",
  ].join("\n");
}

function shareStatusLabel(status: string) {
  if (status === "paid") return "Bezahlt";
  if (status === "processing") return "Wird bestätigt";
  if (status === "expired") return "Abgelaufen";
  if (status === "failed") return "Fehlgeschlagen";
  if (status === "refunded") return "Erstattet";
  return "Offen";
}

function shareStatusClass(status: string) {
  if (status === "paid") return "text-emerald-300";
  if (status === "processing") return "text-sky-300";
  if (status === "failed" || status === "expired" || status === "refunded") {
    return "text-rose-300";
  }
  return "text-amber-300";
}

function PaymentReturnContent() {
  const params = useSearchParams();
  const clear = useCart((state: any) => state.clear);
  const paymentSessionId = useMemo(
    () => String(params.get("paymentSession") || "").trim(),
    [params],
  );
  const checkoutSessionId = useMemo(
    () => String(params.get("checkout_session_id") || "").trim(),
    [params],
  );
  const recoveryToken = useMemo(
    () => String(params.get("recovery") || "").trim(),
    [params],
  );
  const paymentCancelled = params.get("payment") === "cancelled";

  const [state, setState] = useState<PaymentState>({
    status: "loading",
  });
  const [busyShare, setBusyShare] = useState<number | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [resumeBusy, setResumeBusy] = useState(false);
  const profileAttempted = useRef(false);

  useEffect(() => {
    if (!paymentSessionId) {
      setState({
        ok: false,
        status: "failed",
        error: "Zahlungssitzung fehlt.",
      });
      return;
    }

    let active = true;
    let timer: number | null = null;

    const load = async () => {
      try {
        const response = await fetch(
          `/api/payments/session?id=${encodeURIComponent(paymentSessionId)}&recovery=${encodeURIComponent(recoveryToken)}`,
          {
            cache: "no-store",
          },
        );
        const payload = await response.json().catch(() => ({}));

        if (!active) return;

        setState(payload);

        if (payload?.finalized && payload?.finalOrderId) {
          try {
            clear?.();
            localStorage.removeItem("bb_active_coupon_code");
            localStorage.removeItem("bb_active_coupon_meta");
            localStorage.removeItem("bb_active_payment_recovery_v1");
            localStorage.setItem(
              "bb_last_track_order_id",
              String(payload.finalOrderId),
            );
            localStorage.setItem(
              "bb_last_tracking_order_id",
              String(payload.finalOrderId),
            );
            window.dispatchEvent(
              new CustomEvent("bb:last-track-order-updated", {
                detail: {
                  id: String(payload.finalOrderId),
                },
              }),
            );
          } catch {}

          return;
        }

        if (
          payload?.status === "pending" ||
          payload?.status === "processing" ||
          payload?.status === "paid"
        ) {
          timer = window.setTimeout(load, 2200);
        }
      } catch (error: any) {
        if (!active) return;

        setState({
          ok: false,
          status: "failed",
          error: error?.message || "Zahlungsstatus konnte nicht geladen werden.",
        });
      }
    };

    void load();

    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [paymentSessionId, recoveryToken, clear, refreshVersion]);

  useEffect(() => {
    const resumeView = () => {
      document.documentElement.classList.remove("bb-route-pending");
      document.body.classList.remove("bb-route-pending");
      setBusyShare(null);
      setResumeBusy(false);
      setRefreshVersion((value) => value + 1);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") resumeView();
    };
    window.addEventListener("pageshow", resumeView);
    window.addEventListener("focus", resumeView);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pageshow", resumeView);
      window.removeEventListener("focus", resumeView);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  /*
   * Normal online ödeme sonrası Stripe Customer profili bu cihazda güvenli
   * HttpOnly cookie ile hatırlanır. Sunucu, müşterinin onay vermediği oturumda
   * profili kaydetmez.
   */
  useEffect(() => {
    if (
      profileAttempted.current ||
      !checkoutSessionId ||
      !paymentSessionId
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
        paymentSessionId,
      }),
      cache: "no-store",
    })
      .then((response) => response.json().catch(() => ({})))
      .then((payload) => {
        if (payload?.remembered) setProfileSaved(true);
      })
      .catch(() => null);
  }, [checkoutSessionId, paymentSessionId]);

  const shares = Array.isArray(state.shares) ? state.shares : [];
  const finalized = state.finalized === true;
  const failed =
    state.status === "failed" ||
    state.status === "expired" ||
    state.status === "refunded" ||
    state.ok === false;
  const isSplit = Number(state.totalCount || shares.length) > 1;

  const openShare = (share: Share) => {
    if (!share.shareUrl) return;
    setBusyShare(share.index);
    window.location.assign(share.shareUrl);
  };

  const sendShareViaWhatsApp = (share: Share) => {
    if (!share.shareUrl) return;

    const url = `https://wa.me/?text=${encodeURIComponent(whatsappMessage(share))}`;
    const standalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      Boolean((navigator as any).standalone);
    if (standalone || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "")) {
      window.location.href = url;
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const resumePayment = async () => {
    if (!paymentSessionId || !recoveryToken || resumeBusy) return;
    try {
      setResumeBusy(true);
      const response = await fetch("/api/payments/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resume",
          paymentSessionId,
          recoveryToken,
        }),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(
          payload?.message ||
            payload?.error ||
            "Die Zahlung konnte nicht fortgesetzt werden.",
        );
      }
      if (payload?.url) {
        window.location.assign(String(payload.url));
        return;
      }
      setState(payload);
      setRefreshVersion((value) => value + 1);
    } catch (error: any) {
      setState((current) => ({
        ...current,
        message:
          error?.message || "Die Zahlung konnte nicht fortgesetzt werden.",
      }));
    } finally {
      setResumeBusy(false);
    }
  };

  return (
    <main className="mx-auto min-h-[100dvh] max-w-2xl px-4 py-8 text-stone-100 sm:px-6">
      <div className="rounded-3xl border border-stone-700/60 bg-stone-950/90 p-5 shadow-2xl sm:p-7">
        <div className="mb-6 flex items-center gap-3">
          <img
            src="/logo-burger-brothers.png"
            alt="Burger Brothers Berlin"
            className="h-12 w-12 rounded-full"
          />
          <div>
            <h1 className="text-2xl font-black">Burger Brothers</h1>
            <p className="text-sm text-stone-400">Sichere Online-Zahlung</p>
          </div>
        </div>

        {finalized ? (
          <div className="rounded-2xl border border-emerald-500/50 bg-emerald-500/10 p-5">
            <div className="text-4xl">✅</div>
            <h2 className="mt-3 text-2xl font-black">
              Zahlung erfolgreich
            </h2>
            <p className="mt-2 text-stone-300">
              Deine Bestellung wurde an Burger Brothers übermittelt.
            </p>
            {profileSaved && (
              <div className="mt-3 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-100">
                Deine Zahlungsart wurde auf diesem Gerät sicher gespeichert. Stripe zeigt sie beim nächsten Mal direkt an.
              </div>
            )}
            <div className="mt-4 rounded-xl bg-black/35 p-4">
              <div className="text-xs uppercase tracking-wide text-stone-400">
                Bestellnummer
              </div>
              <div className="mt-1 text-3xl font-black text-amber-300">
                #{state.finalOrderId}
              </div>
            </div>
            <Link
              href="/menu"
              className="mt-5 block rounded-xl bg-amber-400 px-4 py-3 text-center font-black text-black"
            >
              Zurück zur Speisekarte
            </Link>
          </div>
        ) : failed ? (
          <div className="rounded-2xl border border-rose-500/50 bg-rose-500/10 p-5">
            <div className="text-4xl">⚠️</div>
            <h2 className="mt-3 text-xl font-black">
              Zahlung nicht abgeschlossen
            </h2>
            <p className="mt-2 text-sm text-rose-100">
              {state.message ||
                state.error ||
                "Die Zahlung konnte nicht abgeschlossen werden."}
            </p>
            {state.status === "refunded" && (
              <p className="mt-3 text-sm text-stone-300">
                Bereits eingezogene Beträge wurden automatisch zurückerstattet.
              </p>
            )}
            {state.status === "expired" && (
              <p className="mt-3 text-sm text-stone-300">
                Die Zahlungssitzung ist abgelaufen. Es wurde nichts berechnet.
              </p>
            )}
            {recoveryToken && state.status === "expired" && (
              <button
                type="button"
                disabled={resumeBusy}
                onClick={resumePayment}
                className="mt-5 w-full rounded-xl bg-amber-400 px-4 py-3 font-black text-black disabled:opacity-50"
              >
                {resumeBusy
                  ? "Zahlung wird vorbereitet …"
                  : "Neue sichere Zahlungssitzung öffnen"}
              </button>
            )}
            <Link
              href="/checkout"
              className="mt-3 block rounded-xl border border-stone-600 px-4 py-3 text-center font-semibold"
            >
              Zurück zum Checkout
            </Link>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-sky-500/40 bg-sky-500/10 p-4">
              <div className="text-lg font-bold">
                {isSplit ? "Getrennt zahlen" : "Zahlung wird geprüft"}
              </div>
              <div className="mt-1 text-sm text-stone-300">
                {paymentCancelled
                  ? "Die letzte Zahlung wurde abgebrochen. Der offene Anteil kann erneut bezahlt werden."
                  : state.message ||
                    (isSplit
                      ? state.whatsappShareEnabled !== false
                        ? "Sende jeder Person ihren eigenen sicheren Zahlungslink per WhatsApp. Der Status wird hier automatisch aktualisiert."
                        : "Öffne für jede Person den eigenen sicheren Zahlungslink. Der Status wird hier automatisch aktualisiert."
                      : "Bitte einen Moment warten. Die Zahlung wird sicher bestätigt.")}
              </div>
              {!!state.totalCount && (
                <div className="mt-3 text-sm font-semibold">
                  {state.paidCount || 0} von {state.totalCount} Zahlungen abgeschlossen
                </div>
              )}
            </div>

            {isSplit && (
              <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-50">
                <div className="font-bold">📲 Jeder bezahlt auf dem eigenen Handy</div>
                <div className="mt-1 text-xs text-stone-300">
                  {state.whatsappShareEnabled !== false
                    ? "Öffne deinen eigenen Anteil direkt oder sende den jeweiligen Link per WhatsApp."
                    : "Öffne für jede Person den eigenen sicheren Zahlungslink."}{" "}
                  Erst wenn alle Anteile bezahlt sind, wird eine einzige Bestellung an die Küche gesendet.
                </div>
              </div>
            )}

            {shares.length > 0 && (
              <div className="mt-4 space-y-3">
                {shares.map((share) => {
                  const open =
                    share.status !== "paid" &&
                    share.status !== "processing" &&
                    Boolean(share.shareUrl);
                  const itemLabels = (Array.isArray(share.items) ? share.items : [])
                    .map((item) => String(item?.label || "").trim())
                    .filter(Boolean);

                  return (
                    <div
                      key={`${share.index}-${share.label}`}
                      className="rounded-2xl border border-stone-700/60 bg-stone-900/60 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold">{share.label}</div>
                          {share.serviceFee > 0 && (
                            <div className="text-xs text-stone-400">
                              inkl. {fmt(share.serviceFee)} Servicegebühr
                            </div>
                          )}
                          {itemLabels.length > 0 && (
                            <div className="mt-2 line-clamp-2 text-xs text-stone-400">
                              {itemLabels.join(", ")}
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-bold">{fmt(share.amount)}</div>
                          <div className={`text-xs ${shareStatusClass(share.status)}`}>
                            {shareStatusLabel(share.status)}
                          </div>
                        </div>
                      </div>

                      {open && (
                        <div
                          className={`mt-3 grid grid-cols-1 gap-2 ${
                            state.whatsappShareEnabled !== false ? "sm:grid-cols-2" : ""
                          }`}
                        >
                          <button
                            type="button"
                            disabled={busyShare === share.index}
                            onClick={() => openShare(share)}
                            className="rounded-xl bg-amber-400 px-3 py-3 text-sm font-black text-black disabled:opacity-50"
                          >
                            {busyShare === share.index
                              ? "Stripe wird geöffnet …"
                              : "Jetzt bezahlen"}
                          </button>
                          {state.whatsappShareEnabled !== false && (
                            <button
                              type="button"
                              onClick={() => sendShareViaWhatsApp(share)}
                              className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 px-3 py-3 text-sm font-bold text-emerald-100"
                            >
                              Per WhatsApp senden
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {!isSplit && state.nextUrl ? (
              <button
                type="button"
                disabled={busyShare !== null}
                onClick={() => {
                  setBusyShare(state.nextShareIndex ?? 0);
                  window.location.assign(String(state.nextUrl));
                }}
                className="mt-5 w-full rounded-xl bg-amber-400 px-4 py-3 font-black text-black disabled:opacity-50"
              >
                Zahlung fortsetzen
              </button>
            ) : (
              <div className="mt-5 flex items-center justify-center gap-3 text-sm text-stone-400">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-stone-600 border-t-amber-300" />
                Zahlungsstatus wird automatisch aktualisiert …
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function PaymentReturnFallback() {
  return (
    <main className="mx-auto min-h-[100dvh] max-w-2xl px-4 py-8 text-stone-100 sm:px-6">
      <div className="rounded-3xl border border-stone-700/60 bg-stone-950/90 p-5 shadow-2xl sm:p-7">
        <div className="flex items-center justify-center gap-3 text-sm text-stone-300">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-stone-600 border-t-amber-300" />
          Zahlung wird geladen …
        </div>
      </div>
    <PaymentTrustBadges className="mt-4" />
</main>
  );
}

export default function PaymentReturnPage() {
  return (
    <Suspense fallback={<PaymentReturnFallback />}>
      <PaymentReturnContent />
    </Suspense>
  );
}
