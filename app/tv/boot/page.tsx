// app/tv/boot/page.tsx
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function TVBootPage() {
  const router = useRouter();
  useEffect(() => {
    try { sessionStorage.setItem("bb_tv_tab", "1"); } catch {}
    router.replace("/tv");
  }, [router]);

  return (
    <main className="min-h-screen bg-[#0b0f14] text-stone-100 flex items-center justify-center">
      <div className="opacity-80 text-sm">Açılıyor…</div>
    </main>
  );
}
