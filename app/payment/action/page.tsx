"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import PaymentTrustBadges from "@/components/PaymentTrustBadges";

declare global {
  interface Window {
    Stripe?: (key: string) => {
      handleNextAction: (params: {
        clientSecret: string;
      }) => Promise<{ error?: { message?: string } }>;
    };
  }
}

function loadStripeJs() {
  return new Promise<void>((resolve, reject) => {
    if (window.Stripe) {
      resolve();
      return;
    }
    const existing = document.querySelector(
      'script[src="https://js.stripe.com/v3/"]',
    ) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("STRIPE_JS_LOAD_FAILED")),
        { once: true },
      );
      return;
    }
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("STRIPE_JS_LOAD_FAILED"));
    document.head.appendChild(script);
  });
}

function ActionContent() {
  const params = useSearchParams();
  const paymentSessionId = String(params.get("paymentSession") || "");
  const recoveryToken = String(params.get("recovery") || "");
  const token = String(params.get("token") || "");
  const isShare = Boolean(token);
  const [message, setMessage] = useState(
    "Sichere Bestätigung wird vorbereitet …",
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const endpoint = isShare
          ? "/api/payments/share"
          : "/api/payments/session";
        const body = isShare
          ? { action: "action_details", token }
          : { action: "action_details", paymentSessionId, recoveryToken };
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(
            payload?.message ||
              payload?.error ||
              "Die Bestätigung ist nicht verfügbar.",
          );
        if (payload?.completed) {
          window.location.replace(
            String(
              payload.returnUrl ||
                (isShare
                  ? `/pay/${encodeURIComponent(token)}`
                  : "/payment/center"),
            ),
          );
          return;
        }
        if (!payload?.clientSecret || !payload?.publishableKey)
          throw new Error(
            payload?.message ||
              payload?.error ||
              "Die Bestätigung ist nicht verfügbar.",
          );
        await loadStripeJs();
        if (!window.Stripe)
          throw new Error("Stripe konnte nicht geladen werden.");
        if (active)
          setMessage(
            "Bitte bestätige die Zahlung bei deiner Bank oder deinem Zahlungsanbieter.",
          );
        const stripe = window.Stripe(payload.publishableKey);
        const result = await stripe.handleNextAction({
          clientSecret: payload.clientSecret,
        });
        if (result?.error)
          throw new Error(
            result.error.message ||
              "Die Bestätigung wurde nicht abgeschlossen.",
          );
        window.location.replace(
          String(
            payload.returnUrl ||
              (isShare
                ? `/pay/${encodeURIComponent(token)}`
                : "/payment/center"),
          ),
        );
      } catch (error: any) {
        if (active) {
          setFailed(true);
          setMessage(
            error?.message || "Die Zahlung konnte nicht bestätigt werden.",
          );
        }
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [isShare, paymentSessionId, recoveryToken, token]);

  const backUrl = isShare
    ? `/pay/${encodeURIComponent(token)}`
    : `/payment/center?paymentSession=${encodeURIComponent(paymentSessionId)}&recovery=${encodeURIComponent(recoveryToken)}`;
  return (
    <main className="mx-auto min-h-[100dvh] max-w-xl px-4 py-10 text-stone-100">
      <div className="rounded-3xl border border-stone-700/60 bg-stone-950/90 p-6 text-center shadow-2xl">
        <div
          className={`mx-auto h-12 w-12 rounded-full border-4 ${failed ? "border-rose-400" : "animate-spin border-stone-700 border-t-amber-300"}`}
        />
        <h1 className="mt-5 text-2xl font-black">Zahlung bestätigen</h1>
        <p className="mt-3 leading-6 text-stone-300">{message}</p>
        {failed && (
          <a
            href={backUrl}
            className="mt-5 block rounded-xl bg-amber-400 px-4 py-3 font-black text-black"
          >
            Zurück zum Zahlungscenter
          </a>
        )}
      </div>
      <PaymentTrustBadges className="mt-4" />
    </main>
  );
}
export default function PaymentActionPage() {
  return (
    <Suspense
      fallback={
        <main className="p-8 text-center text-stone-200">
          Bestätigung wird geladen …
        </main>
      }
    >
      <ActionContent />
    </Suspense>
  );
}
