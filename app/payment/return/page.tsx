"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useCart } from "@/components/store";

type Share = {
  index: number;
  label: string;
  amount: number;
  baseAmount: number;
  serviceFee: number;
  status: string;
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
  shares?: Share[];
  message?: string;
  error?: string;
};

const fmt = (value: number) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(Number(value || 0));

function PaymentReturnContent() {
  const params = useSearchParams();
  const clear = useCart((state: any) => state.clear);
  const paymentSessionId = useMemo(
    () => String(params.get("paymentSession") || "").trim(),
    [params],
  );

  const [state, setState] = useState<PaymentState>({
    status: "loading",
  });
  const [busy, setBusy] = useState(false);

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
          `/api/payments/session?id=${encodeURIComponent(paymentSessionId)}`,
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
  }, [paymentSessionId, clear]);

  const shares = Array.isArray(state.shares) ? state.shares : [];
  const finalized = state.finalized === true;
  const failed =
    state.status === "failed" ||
    state.status === "expired" ||
    state.status === "refunded" ||
    state.ok === false;

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
            <Link
              href="/checkout"
              className="mt-5 block rounded-xl border border-stone-600 px-4 py-3 text-center font-semibold"
            >
              Zurück zum Checkout
            </Link>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-sky-500/40 bg-sky-500/10 p-4">
              <div className="text-lg font-bold">
                {state.totalCount && state.totalCount > 1
                  ? "Getrennt zahlen"
                  : "Zahlung wird geprüft"}
              </div>
              <div className="mt-1 text-sm text-stone-300">
                {state.message ||
                  "Bitte einen Moment warten. Die Zahlung wird sicher bestätigt."}
              </div>
              {!!state.totalCount && (
                <div className="mt-3 text-sm font-semibold">
                  {state.paidCount || 0} von {state.totalCount} Zahlungen abgeschlossen
                </div>
              )}
            </div>

            {shares.length > 0 && (
              <div className="mt-4 space-y-2">
                {shares.map((share) => (
                  <div
                    key={`${share.index}-${share.label}`}
                    className="flex items-center justify-between rounded-xl border border-stone-700/60 bg-stone-900/60 px-3 py-3"
                  >
                    <div>
                      <div className="font-semibold">{share.label}</div>
                      {share.serviceFee > 0 && (
                        <div className="text-xs text-stone-400">
                          inkl. {fmt(share.serviceFee)} Servicegebühr
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-bold">{fmt(share.amount)}</div>
                      <div
                        className={`text-xs ${
                          share.status === "paid"
                            ? "text-emerald-300"
                            : share.status === "processing"
                              ? "text-sky-300"
                              : "text-amber-300"
                        }`}
                      >
                        {share.status === "paid"
                          ? "Bezahlt"
                          : share.status === "processing"
                            ? "Wird bestätigt"
                            : "Offen"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {state.nextUrl ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  window.location.assign(String(state.nextUrl));
                }}
                className="mt-5 w-full rounded-xl bg-amber-400 px-4 py-3 font-black text-black disabled:opacity-50"
              >
                {state.nextShareIndex != null
                  ? `Person ${state.nextShareIndex + 1} bezahlt jetzt`
                  : "Zahlung fortsetzen"}
              </button>
            ) : (
              <div className="mt-5 flex items-center justify-center gap-3 text-sm text-stone-400">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-stone-600 border-t-amber-300" />
                Zahlung wird geprüft …
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
