"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function TrackIndexRedirect() {
  const router = useRouter();
  const q = useSearchParams();

  useEffect(() => {
    // ?order=... veya ?id=... → /track/ID
    const raw = (q.get("order") || q.get("id") || "").trim();
    if (!raw) return;

    // temizle: boşlukları at, büyük harfe çevir
    const clean = raw.replace(/\s+/g, "").toUpperCase();

    // aynı sayfaya tekrar gelmeyi önlemek için replace
    router.replace(`/track/${encodeURIComponent(clean)}`);
  }, [q, router]);

  // burada istersen bir loading gösterebilirsin
  return null;
}
