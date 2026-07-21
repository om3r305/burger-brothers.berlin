"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import PaymentTrustBadges from "@/components/PaymentTrustBadges";

function LegacyPaymentReturnContent() {
  const params = useSearchParams();
  const [message, setMessage] = useState(
    "Zahlung wird dem richtigen Center zugeordnet …",
  );

  useEffect(() => {
    let active = true;
    const paymentSessionId = String(params.get("paymentSession") || "").trim();
    const recoveryToken = String(params.get("recovery") || "").trim();
    const legacySplit = params.get("split") === "1";

    const redirect = (kind: "online" | "split_contactless") => {
      const target = new URL(
        kind === "split_contactless" ? "/payment/split" : "/payment/center",
        window.location.origin,
      );
      params.forEach((value, key) => {
        if (key !== "split") target.searchParams.set(key, value);
      });
      window.location.replace(target.toString());
    };

    if (legacySplit) {
      redirect("split_contactless");
      return;
    }
    if (!paymentSessionId || !recoveryToken) {
      redirect("online");
      return;
    }

    void fetch(
      `/api/payments/session?id=${encodeURIComponent(paymentSessionId)}&recovery=${encodeURIComponent(recoveryToken)}`,
      { cache: "no-store" },
    )
      .then((response) => response.json().catch(() => ({})))
      .then((payload) => {
        if (!active) return;
        redirect(
          payload?.paymentKind === "split_contactless"
            ? "split_contactless"
            : "online",
        );
      })
      .catch(() => {
        if (!active) return;
        setMessage("Payment Center wird geöffnet …");
        redirect("online");
      });

    return () => {
      active = false;
    };
  }, [params]);

  return (
    <main className="mx-auto min-h-[100dvh] max-w-xl px-4 py-10 text-stone-100">
      <div className="rounded-3xl border border-stone-700/60 bg-stone-950/90 p-6 text-center shadow-2xl">
        <span className="mx-auto block h-10 w-10 animate-spin rounded-full border-4 border-stone-700 border-t-amber-300" />
        <p className="mt-4 text-stone-300">{message}</p>
      </div>
      <PaymentTrustBadges className="mt-4" />
    </main>
  );
}

export default function LegacyPaymentReturnPage() {
  return (
    <Suspense
      fallback={
        <main className="p-8 text-center text-stone-200">
          Zahlung wird geladen …
        </main>
      }
    >
      <LegacyPaymentReturnContent />
    </Suspense>
  );
}
