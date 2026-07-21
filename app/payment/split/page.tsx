"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import PaymentTrustBadges from "@/components/PaymentTrustBadges";
import { rememberCustomerTracking } from "@/lib/customer-tracking";

type Share = {
  index: number;
  label: string;
  amount: number;
  baseAmount: number;
  serviceFee: number;
  status: string;
  shareUrl?: string | null;
  items?: Array<{ label?: string }>;
};
type State = {
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
  paidCount?: number;
  totalCount?: number;
  recoveryExpiresAt?: string | null;
  whatsappShareEnabled?: boolean;
  shares?: Share[];
  message?: string | null;
};

const fmt = (value: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    Number(value || 0),
  );
function clearRecovery() {
  try {
    localStorage.removeItem("bb_active_payment_recovery_v1");
    sessionStorage.removeItem("bb_active_payment_session");
    window.dispatchEvent(new CustomEvent("bb:payment-recovery-changed"));
  } catch {}
}
function countdown(value: any, now: number) {
  const end = Date.parse(String(value || ""));
  if (!Number.isFinite(end)) return "";
  const sec = Math.max(0, Math.ceil((end - now) / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}
function etaLabel(state: State) {
  if (state.planned)
    return `${state.mode === "pickup" ? "Geplante Abholung" : "Geplante Lieferung"}: ${state.planned}`;
  const eta = Math.max(
    0,
    Number(state.etaMin || 0) + Number(state.etaAdjustMin || 0),
  );
  return eta ? `Voraussichtliche Zeit: ca. ${eta} Minuten` : "";
}

function SplitCenterContent() {
  const params = useSearchParams();
  const paymentSessionId = String(params.get("paymentSession") || "").trim();
  const recoveryToken = String(params.get("recovery") || "").trim();
  const [state, setState] = useState<State>({ status: "loading" });
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  const endpoint = useMemo(
    () =>
      `/api/payments/session?id=${encodeURIComponent(paymentSessionId)}&recovery=${encodeURIComponent(recoveryToken)}`,
    [paymentSessionId, recoveryToken],
  );

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (!paymentSessionId || !recoveryToken) {
      setState({
        status: "failed",
        message: "Der Split-Zahlungszugriff fehlt.",
      });
      return;
    }
    let active = true;
    let timer = 0;
    const load = async () => {
      try {
        const r = await fetch(endpoint, { cache: "no-store" });
        const p = await r.json().catch(() => ({}));
        if (!active) return;
        setState(p);
        if (p?.paymentKind === "online") {
          const u = new URL("/payment/center", window.location.origin);
          u.searchParams.set("paymentSession", paymentSessionId);
          u.searchParams.set("recovery", recoveryToken);
          window.location.replace(u.toString());
          return;
        }
        if (p?.finalized) {
          clearRecovery();
          if (p.trackingToken)
            rememberCustomerTracking({
              trackingToken: p.trackingToken,
              orderId: p.finalOrderId,
            });
          return;
        }
        if (
          ["expired", "failed", "refunded", "cancelled"].includes(
            String(p?.status || ""),
          )
        ) {
          clearRecovery();
          return;
        }
        if (["pending", "processing", "paid"].includes(String(p?.status || "")))
          timer = window.setTimeout(load, 2200);
      } catch (e: any) {
        if (active)
          setState({
            status: "failed",
            message: e?.message || "Split-Zahlung konnte nicht geladen werden.",
          });
      }
    };
    void load();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [endpoint, paymentSessionId, recoveryToken]);

  async function cancel() {
    if (busy) return;
    setBusy("cancel");
    try {
      const r = await fetch("/api/payments/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cancel",
          paymentSessionId,
          recoveryToken,
        }),
        cache: "no-store",
      });
      const p = await r.json().catch(() => ({}));
      if (p?.cancelled) {
        clearRecovery();
        window.location.assign("/checkout?payment=cancelled");
        return;
      }
      setState((c) => ({ ...c, ...p }));
    } finally {
      setBusy("");
    }
  }
  async function copy(share: Share) {
    if (!share.shareUrl) return;
    await navigator.clipboard.writeText(share.shareUrl);
    setCopied(share.index);
    window.setTimeout(() => setCopied(null), 1600);
  }
  function whatsapp(share: Share) {
    if (!share.shareUrl) return;
    const text = `Hallo 👋\n\nDein Anteil bei Burger Brothers: ${fmt(share.amount)}\n\nSicher bezahlen:\n${share.shareUrl}`;
    window.open(
      `https://wa.me/?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }
  function email(share: Share) {
    if (!share.shareUrl) return;
    const subject = "Burger Brothers – Dein Zahlungsanteil";
    const body = `Hallo,\n\ndein Anteil beträgt ${fmt(share.amount)}.\n\nHier sicher bezahlen:\n${share.shareUrl}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  const shares = Array.isArray(state.shares) ? state.shares : [];
  const terminal = ["expired", "failed", "refunded", "cancelled"].includes(
    String(state.status || ""),
  );
  const trackHref = state.trackingToken
    ? `/track/${encodeURIComponent(state.trackingToken)}`
    : "/track";
  return (
    <main className="mx-auto min-h-[100dvh] max-w-3xl px-4 py-8 text-stone-100 sm:px-6">
      <div className="rounded-3xl border border-stone-700/60 bg-stone-950/90 p-5 shadow-2xl sm:p-7">
        <div className="text-xs font-black uppercase tracking-[0.24em] text-amber-300">
          Split Center
        </div>
        {state.status === "loading" ? (
          <div className="mt-6 text-center text-stone-300">
            Split-Zahlung wird geladen …
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
              Gemeinsame Zahlung beendet
            </h1>
            <p className="mt-3 text-stone-300">
              {state.message ||
                "Die Zahlung kann nicht mehr fortgesetzt werden."}
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
            <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-3xl font-black">Getrennt zahlen</h1>
                <p className="mt-1 text-sm text-stone-400">
                  {state.paidCount || 0} von {state.totalCount || shares.length}{" "}
                  Anteilen bezahlt
                </p>
              </div>
              {countdown(state.recoveryExpiresAt, now) && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
                  Restzeit{" "}
                  <strong>{countdown(state.recoveryExpiresAt, now)}</strong>
                </div>
              )}
            </div>
            <div className="mt-6 grid gap-4">
              {shares.map((share) => {
                const paid = share.status === "paid";
                return (
                  <article
                    key={share.index}
                    className={`rounded-2xl border p-4 ${paid ? "border-emerald-500/40 bg-emerald-500/10" : "border-stone-700 bg-stone-900/70"}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-black">{share.label}</div>
                        <div className="text-xl font-black text-amber-200">
                          {fmt(share.amount)}
                        </div>
                      </div>
                      <div
                        className={`rounded-full px-3 py-1 text-xs font-black ${paid ? "bg-emerald-400 text-black" : "bg-amber-400/15 text-amber-200"}`}
                      >
                        {paid ? "Bezahlt ✅" : "Offen"}
                      </div>
                    </div>
                    {!paid && share.shareUrl && (
                      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <button
                          onClick={() =>
                            window.location.assign(String(share.shareUrl))
                          }
                          className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-black text-black"
                        >
                          Jetzt bezahlen
                        </button>
                        <button
                          onClick={() => void copy(share)}
                          className="rounded-lg border border-stone-600 px-3 py-2 text-sm font-bold"
                        >
                          {copied === share.index
                            ? "Kopiert ✓"
                            : "Link kopieren"}
                        </button>
                        {state.whatsappShareEnabled !== false && (
                          <button
                            onClick={() => whatsapp(share)}
                            className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-bold text-emerald-100"
                          >
                            WhatsApp
                          </button>
                        )}
                        <button
                          onClick={() => email(share)}
                          className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm font-bold text-sky-100"
                        >
                          E-Mail
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            <button
              onClick={() => void cancel()}
              disabled={Boolean(busy)}
              className="mt-6 w-full rounded-xl border border-rose-500/50 bg-rose-500/10 px-4 py-3 font-bold text-rose-100 disabled:opacity-50"
            >
              {busy ? "Wird abgebrochen …" : "Gemeinsame Zahlung abbrechen"}
            </button>
          </>
        )}
      </div>
      <PaymentTrustBadges className="mt-4" />
    </main>
  );
}
export default function SplitCenterPage() {
  return (
    <Suspense
      fallback={
        <main className="p-8 text-center text-stone-200">
          Split Center wird geladen …
        </main>
      }
    >
      <SplitCenterContent />
    </Suspense>
  );
}
