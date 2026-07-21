"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import TrackPanel from "@/components/ui/TrackPanel";
import {
  cleanCustomerTrackingValue,
  resolveCustomerTrackingToken,
} from "@/lib/customer-tracking";

function TrackIndexContent() {
  const router = useRouter();
  const query = useSearchParams();

  const requestedValue = useMemo(
    () =>
      cleanCustomerTrackingValue(
        query.get("token") ||
          query.get("trackingToken") ||
          query.get("order") ||
          query.get("id") ||
          "",
      ),
    [query],
  );

  useEffect(() => {
    if (!requestedValue) return;

    const trackingToken = resolveCustomerTrackingToken(requestedValue);

    if (trackingToken) {
      router.replace(`/track/${encodeURIComponent(trackingToken)}`);
    }
  }, [requestedValue, router]);

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-2xl items-center px-4 py-10 text-stone-100 sm:px-6">
      <div className="w-full rounded-3xl border border-stone-700/60 bg-stone-950/90 p-5 shadow-2xl sm:p-7">
        <div className="mb-5 flex items-center gap-3">
          <img
            src="/logo-burger-brothers.png"
            alt="Burger Brothers Berlin"
            className="h-12 w-12 rounded-full"
          />
          <div>
            <h1 className="text-2xl font-black">Bestellung verfolgen</h1>
            <p className="text-sm text-stone-400">
              Bestellnummer oder persönlichen Tracking-Code eingeben
            </p>
          </div>
        </div>

        <TrackPanel variant="emphasized" />

        <Link
          href="/menu"
          className="mt-4 block rounded-xl border border-stone-700 px-4 py-3 text-center font-semibold text-stone-200"
        >
          Zurück zur Speisekarte
        </Link>
      </div>
    </main>
  );
}

export default function TrackIndexPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[100dvh] items-center justify-center text-stone-300">
          Bestellung wird geladen …
        </main>
      }
    >
      <TrackIndexContent />
    </Suspense>
  );
}
