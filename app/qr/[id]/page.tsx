"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Eski QR sayfası PIN'i client bundle içinde doğruluyordu. Bu güvenli değildir.
 * QR artık sürücüyü imzalı driver session kullanan ana kurye ekranına taşır.
 */
export default function QRDriverRedirect({ params }: { params: { id: string } }) {
  const router = useRouter();

  useEffect(() => {
    const orderId = String(params?.id || "").trim();
    const query = orderId ? `?order=${encodeURIComponent(orderId)}` : "";
    router.replace(`/driver${query}`);
  }, [params?.id, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0b0f14] p-6 text-stone-100">
      <div className="rounded-xl border border-white/10 bg-white/5 p-5 text-center">
        Sichere Fahrer-Anmeldung wird geöffnet…
      </div>
    </main>
  );
}
