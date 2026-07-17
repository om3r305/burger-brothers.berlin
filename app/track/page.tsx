"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function TrackIndexRedirect() {
  const router = useRouter();
  const q = useSearchParams();

  useEffect(() => {
    const token = (q.get("token") || q.get("trackingToken") || "").trim();
    const legacyOrderId = (q.get("order") || q.get("id") || "").trim();
    const raw = token || legacyOrderId;

    if (!raw) return;

    // Tracking tokens are case-sensitive. Legacy order IDs may safely be
    // normalized to uppercase for operational users.
    const clean = token
      ? raw.replace(/\s+/g, "")
      : raw.replace(/\s+/g, "").toUpperCase();

    router.replace(`/track/${encodeURIComponent(clean)}`);
  }, [q, router]);

  return null;
}
