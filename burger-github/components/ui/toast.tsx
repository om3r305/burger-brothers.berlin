// components/ui/toast.tsx
"use client";
import { useEffect, useState } from "react";

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 1600);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-stone-200/20 bg-black/70 px-3 py-2 text-sm backdrop-blur">
      {msg}
    </div>
  ) : null;
  return { toast: setMsg, ToastNode: node };
}
