"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type AttentionItem = {
  id: string;
  title: string;
  body: string;
  url: string;
  status: string;
  createdAt: string;
};

export default function AdminAttentionBell() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<AttentionItem[]>([]);
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const response = await fetch("/api/admin/attention", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) return;
      const nextItems = Array.isArray(data.items) ? data.items : [];
      setUnreadCount(Number(data.unreadCount || 0));
      setItems(nextItems);

    } catch {
      // Bildirim rozeti diğer admin işlemlerini engellemez.
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "BB_ADMIN_PUSH") void load();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [load]);

  const markRead = async (id: string) => {
    await fetch("/api/admin/attention", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, action: "read" }),
    }).catch(() => undefined);
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, status: "read" } : item)),
    );
    setUnreadCount((current) => Math.max(0, current - 1));
  };

  return (
    <div className="relative ml-auto">
      <button
        type="button"
        onClick={() =>
          setOpen((current) => {
            if (!current) void load();
            return !current;
          })
        }
        className="relative grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/5 text-xl hover:bg-white/10"
        aria-label="Admin bildirimleri"
      >
        🔔
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[10px] font-black text-white">
            {Math.min(99, unreadCount)}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="fixed left-2 right-2 top-[calc(env(safe-area-inset-top)+4.5rem)] z-[1500] max-h-[75dvh] overflow-hidden rounded-2xl border border-stone-700 bg-stone-950 shadow-2xl sm:absolute sm:left-auto sm:right-0 sm:top-14 sm:w-[min(92vw,390px)]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <strong>Onay bildirimleri</strong>
            <button type="button" onClick={() => setOpen(false)} className="text-stone-400">✕</button>
          </div>
          <div className="max-h-[65vh] overflow-y-auto p-2">
            {items.length ? (
              items.map((item) => (
                <Link
                  key={item.id}
                  href={item.url}
                  onClick={() => {
                    void markRead(item.id);
                    setOpen(false);
                  }}
                  className={`block rounded-xl p-3 transition hover:bg-white/10 ${
                    item.status === "unread" ? "bg-amber-400/10" : "bg-white/[0.03]"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-black text-white">{item.title}</div>
                      <div className="mt-1 line-clamp-2 text-xs leading-5 text-stone-400">{item.body}</div>
                    </div>
                    {item.status === "unread" ? <span className="mt-1 h-2.5 w-2.5 rounded-full bg-red-400" /> : null}
                  </div>
                </Link>
              ))
            ) : (
              <div className="p-6 text-center text-sm text-stone-500">Bekleyen bildirim yok.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
