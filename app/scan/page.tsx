// app/scan/page.tsx
"use client";

import { useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Legacy scan links are routed through the signed driver session.
 * Client-side PIN checks are intentionally not used as authentication.
 */
export default function ScanPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = useMemo(
    () => String(searchParams.get("id") || "").trim(),
    [searchParams],
  );

  useEffect(() => {
    const target = orderId
      ? `/driver?order=${encodeURIComponent(orderId)}`
      : "/driver";

    router.replace(target);
  }, [orderId, router]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center px-4 text-center text-stone-100">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-xl font-bold">Fahrer-Anmeldung</h1>
        <p className="mt-2 text-sm text-stone-300">
          Du wirst sicher zum Fahrerbereich weitergeleitet.
        </p>
      </div>
    </main>
  );
}
