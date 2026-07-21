"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import PaymentTrustBadges from "@/components/PaymentTrustBadges";
import { rememberCustomerTracking } from "@/lib/customer-tracking";

type Share = {
  index: number;
  label: string;
  amount: number;
  baseAmount: number;
  serviceFee: number;
  status: string;
  paymentMethodType?: string | null;
  items?: Array<{ key?: string; label?: string }>;
  shareUrl?: string;
};
type State = {
  ok?: boolean;
  paymentSessionId?: string;
  finalOrderId?: string | null;
  trackingToken?: string | null;
  mode?: string | null;
  planned?: string | null;
  etaMin?: number | null;
  etaAdjustMin?: number | null;
  finalized?: boolean;
  sessionStatus?: string;
  paidCount?: number;
  totalCount?: number;
  recoveryExpiresAt?: string | null;
  whatsappShareEnabled?: boolean;
  share?: Share;
  shares?: Share[];
  actionRequired?: boolean;
  actionUrl?: string | null;
  message?: string | null;
  error?: string | null;
};

const fmt = (value: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    Number(value || 0),
  );

function countdown(value: any, now: number) {
  const end = Date.parse(String(value || ""));
  if (!Number.isFinite(end)) return "";
  const seconds = Math.max(0, Math.ceil((end - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function etaLabel(state: State) {
  if (state.planned) {
    return `${state.mode === "pickup" ? "Geplante Abholung" : "Geplante Lieferung"}: ${state.planned}`;
  }
  const eta = Math.max(
    0,
    Number(state.etaMin || 0) + Number(state.etaAdjustMin || 0),
  );
  return eta ? `Voraussichtliche Zeit: ca. ${eta} Minuten` : "";
}

function SharePaymentContent() {
  const route = useParams<{ token: string }>();
  const params = useSearchParams();
  const token = String(route?.token || "").trim();
  const checkoutSessionId = String(
    params.get("checkout_session_id") || "",
  ).trim();
  const [state, setState] = useState<State>({ sessionStatus: "loading" });
  const [methods, setMethods] = useState<
    Array<{ id: string; type: string; label: string }>
  >([]);
  const [selectedMethodId, setSelectedMethodId] = useState("");
  const [rememberPayment, setRememberPayment] = useState(true);
  const [busy, setBusy] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [refresh, setRefresh] = useState(0);
  const profileAttempted = useRef(false);
  const endpoint = useMemo(
    () => `/api/payments/share?token=${encodeURIComponent(token)}`,
    [token],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/payments/profile", { cache: "no-store" })
      .then((response) => response.json().catch(() => ({})))
      .then((payload) => {
        if (!active) return;
        const next = Array.isArray(payload?.methods)
          ? payload.methods.slice(0, 6)
          : [];
        setMethods(next);
        setSelectedMethodId((current) => current || String(next[0]?.id || ""));
      })
      .catch(() => null);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!token) {
      setState({ sessionStatus: "failed", message: "Der Zahlungslink fehlt." });
      return;
    }
    let active = true;
    let timer = 0;
    const load = async () => {
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!active) return;
        setState(payload);
        if (payload?.finalized && payload?.trackingToken) {
          rememberCustomerTracking({
            trackingToken: payload.trackingToken,
            orderId: payload.finalOrderId,
          });
          return;
        }
        if (
          ["pending", "processing", "paid"].includes(
            String(payload?.sessionStatus || ""),
          )
        ) {
          timer = window.setTimeout(load, 2200);
        }
      } catch (error: any) {
        if (active)
          setState({
            sessionStatus: "failed",
            message:
              error?.message || "Zahlungsanteil konnte nicht geladen werden.",
          });
      }
    };
    void load();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [endpoint, token, refresh]);

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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checkoutSessionId,
        paymentSessionId: state.paymentSessionId,
        shareToken: token,
      }),
      cache: "no-store",
      credentials: "same-origin",
    }).catch(() => null);
  }, [checkoutSessionId, state.paymentSessionId, token]);

  async function pay(action: "start" | "checkout" = "start") {
    if (busy) return;
    try {
      setBusy(action);
      const response = await fetch("/api/payments/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          token,
          rememberPayment,
          savedPaymentMethodId: action === "start" ? selectedMethodId : "",
        }),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (payload?.url) {
        window.location.assign(String(payload.url));
        return;
      }
      if (!response.ok || payload?.ok === false) {
        setState((current) => ({
          ...current,
          message:
            payload?.message || "Die Zahlung konnte nicht gestartet werden.",
          error: payload?.error || "PAYMENT_FAILED",
        }));
        return;
      }
      setRefresh((value) => value + 1);
    } finally {
      setBusy("");
    }
  }

  function sendWhatsApp() {
    const share = state.share;
    const url =
      share?.shareUrl || `${window.location.origin}${window.location.pathname}`;
    const text = `Hallo 👋\n\nDein Anteil bei Burger Brothers: ${fmt(share?.amount || 0)}\n\nHier sicher bezahlen:\n${url}`;
    window.open(
      `https://wa.me/?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  const share = state.share;
  const shares = Array.isArray(state.shares) ? state.shares : [];
  const paid = share?.status === "paid";
  const terminal = ["failed", "expired", "refunded"].includes(
    String(state.sessionStatus || ""),
  );
  const trackHref = state.trackingToken
    ? `/track/${encodeURIComponent(state.trackingToken)}`
    : "/track";

  return (
    <main className="mx-auto min-h-[100dvh] max-w-2xl px-4 py-8 text-stone-100 sm:px-6">
      <div className="rounded-3xl border border-stone-700/60 bg-stone-950/90 p-5 shadow-2xl sm:p-7">
        <div className="text-xs font-black uppercase tracking-[0.24em] text-amber-300">
          Split Center
        </div>

        {state.sessionStatus === "loading" ? (
          <div className="mt-6 text-center text-stone-300">
            Zahlungsanteil wird geladen …
          </div>
        ) : state.finalized ? (
          <>
            <h1 className="mt-3 text-3xl font-black text-emerald-300">
              Alle Zahlungen abgeschlossen ✅
            </h1>
            <div className="mt-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <div>
                Bestellnummer: <strong>{state.finalOrderId}</strong>
              </div>
              {etaLabel(state) && (
                <div className="mt-2 font-semibold text-amber-100">
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
              Zahlung nicht verfügbar
            </h1>
            <p className="mt-3 text-stone-300">
              {state.message ||
                "Diese gemeinsame Zahlung kann nicht mehr fortgesetzt werden."}
            </p>
          </>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-3xl font-black">
                  {share?.label || "Dein Anteil"}
                </h1>
                <div className="mt-1 text-3xl font-black text-amber-200">
                  {fmt(share?.amount || 0)}
                </div>
              </div>
              {countdown(state.recoveryExpiresAt, now) && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
                  Restzeit{" "}
                  <strong>{countdown(state.recoveryExpiresAt, now)}</strong>
                </div>
              )}
            </div>

            <div className="mt-5 grid gap-2">
              {shares.map((item) => (
                <div
                  key={item.index}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2 ${item.index === share?.index ? "border-amber-400/50 bg-amber-400/10" : "border-stone-800 bg-stone-900/60"}`}
                >
                  <span className="font-semibold">
                    {item.label} · {fmt(item.amount)}
                  </span>
                  <span
                    className={
                      item.status === "paid"
                        ? "text-emerald-300"
                        : "text-stone-400"
                    }
                  >
                    {item.status === "paid" ? "Bezahlt ✅" : "Offen"}
                  </span>
                </div>
              ))}
            </div>

            {state.message && (
              <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
                {state.message}
              </div>
            )}

            {paid ? (
              <div className="mt-5 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-center font-black text-emerald-200">
                Dein Anteil ist bezahlt ✅
                <div className="mt-1 text-sm font-normal text-stone-300">
                  Diese Seite aktualisiert sich automatisch, bis alle bezahlt
                  haben.
                </div>
              </div>
            ) : (
              <>
                {methods.length > 0 && (
                  <div className="mt-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                    <div className="text-sm font-black text-emerald-100">
                      Gespeicherte Zahlungsart
                    </div>
                    <div className="mt-3 grid gap-2">
                      {methods.map((method) => (
                        <button
                          key={method.id}
                          type="button"
                          onClick={() => setSelectedMethodId(method.id)}
                          className={`rounded-xl border px-3 py-2 text-left text-sm font-bold ${selectedMethodId === method.id ? "border-emerald-300 bg-emerald-400/15" : "border-stone-700 bg-stone-950/50"}`}
                        >
                          {method.label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-2 text-xs text-stone-400">
                      Wenn keine zusätzliche Bestätigung nötig ist, wird die
                      Zahlung direkt abgeschlossen.
                    </div>
                  </div>
                )}

                <button
                  onClick={() => void pay("start")}
                  disabled={Boolean(busy)}
                  className="mt-5 w-full rounded-xl bg-amber-400 px-4 py-3 font-black text-black disabled:opacity-50"
                >
                  {busy === "start"
                    ? "Zahlung wird geprüft …"
                    : selectedMethodId
                      ? `Jetzt bezahlen • ${fmt(share?.amount || 0)}`
                      : `Zahlungsart wählen • ${fmt(share?.amount || 0)}`}
                </button>
                {selectedMethodId && (
                  <button
                    onClick={() => void pay("checkout")}
                    disabled={Boolean(busy)}
                    className="mt-3 w-full rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-3 font-bold text-sky-100 disabled:opacity-50"
                  >
                    Andere Zahlungsart
                  </button>
                )}
                <label className="mt-4 flex items-start gap-3 rounded-xl border border-stone-700 bg-stone-900/70 p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={rememberPayment}
                    onChange={(event) =>
                      setRememberPayment(event.target.checked)
                    }
                    className="mt-1"
                  />
                  <span>
                    Zahlungsart für zukünftige Bestellungen merken. Burger
                    Brothers speichert keine Karten-, CVC- oder
                    PayPal-Zugangsdaten.
                  </span>
                </label>
                {state.whatsappShareEnabled !== false && (
                  <button
                    onClick={sendWhatsApp}
                    className="mt-3 w-full rounded-xl border border-emerald-500/50 bg-emerald-500/10 px-4 py-3 font-bold text-emerald-100"
                  >
                    Per WhatsApp weiterleiten
                  </button>
                )}
              </>
            )}
          </>
        )}

        <Link
          href="/menu"
          className="mt-5 block text-center text-sm text-stone-400 underline decoration-stone-600 underline-offset-4"
        >
          Zur Speisekarte
        </Link>
      </div>
      <PaymentTrustBadges className="mt-4" />
    </main>
  );
}

export default function SharePaymentPage() {
  return (
    <Suspense
      fallback={
        <main className="p-8 text-center text-stone-200">
          Split Center wird geladen …
        </main>
      }
    >
      <SharePaymentContent />
    </Suspense>
  );
}
