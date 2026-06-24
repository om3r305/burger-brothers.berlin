"use client";

import { useEffect, useMemo, useState } from "react";
import { readSettings } from "@/lib/settings";

type AnnItem = {
  title?: string;
  text?: string;
  imageUrl?: string;
  ctaLabel?: string;
  ctaHref?: string;
  enabled?: boolean;
  startsAt?: string; // ISO
  endsAt?: string;   // ISO
  frequency?: "once" | "daily"; // ← yeni (opsiyonel)
};

const SEEN_PREFIX = "bb_announce_seen_";

function isNowBetween(startISO?: string, endISO?: string) {
  const now = Date.now();
  const s = startISO ? Date.parse(startISO) : NaN;
  const e = endISO ? Date.parse(endISO) : NaN;
  if (!Number.isNaN(s) && now < s) return false;
  if (!Number.isNaN(e) && now > e) return false;
  return true;
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function bannerVersionHash(x: AnnItem, idx: number) {
  // içeriği özetleyip bir “id” üretelim; küçük değişiklikte yeni id doğsun
  const raw = JSON.stringify({
    i: idx,
    t: x.title || "",
    x: x.text || "",
    img: x.imageUrl || "",
    ctaL: x.ctaLabel || "",
    ctaH: x.ctaHref || "",
    s: x.startsAt || "",
    e: x.endsAt || "",
  });
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  return String(h);
}

function shouldShowOnce(id: string) {
  return !localStorage.getItem(SEEN_PREFIX + id);
}

function shouldShowDaily(id: string) {
  const last = localStorage.getItem(SEEN_PREFIX + id);
  return last !== todayKey();
}

function markSeen(id: string, mode: "once" | "daily") {
  localStorage.setItem(SEEN_PREFIX + id, mode === "once" ? "1" : todayKey());
}

export default function AnnouncementsClient() {
  const [items, setItems] = useState<AnnItem[]>([]);
  const [visibleIdx, setVisibleIdx] = useState<number | null>(null);

  // admin rotalarında göstermeyelim
  const isAdmin = typeof window !== "undefined" &&
    (location.pathname === "/admin" || location.pathname.startsWith("/admin/"));
  useEffect(() => {
    if (isAdmin) return;
    try {
      const s = readSettings() as any;
      const all: AnnItem[] = s?.announcements?.items || [];
      const enabled = (all || []).filter(
        (x) => x?.enabled !== false && isNowBetween(x?.startsAt, x?.endsAt)
      );
      setItems(enabled);
    } catch {
      setItems([]);
    }
  }, [isAdmin]);

  // “bu cihazda/bugün gösterildi mi?” filtresi
  const nextIdx = useMemo(() => {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const id = bannerVersionHash(it, i);
      const freq = it.frequency || "daily";
      if (freq === "once") {
        if (shouldShowOnce(id)) return i;
      } else {
        if (shouldShowDaily(id)) return i;
      }
    }
    return null;
  }, [items]);

  useEffect(() => {
    setVisibleIdx(nextIdx);
  }, [nextIdx]);

  if (isAdmin || visibleIdx == null) return null;

  const it = items[visibleIdx];
  const id = bannerVersionHash(it, visibleIdx);
  const freq = it.frequency || "daily";

  const close = () => {
    try { markSeen(id, freq); } catch {}
    setVisibleIdx(null);
  };

  return (
    <>
      {/* Mobil: bottom-sheet; Desktop: sağ-alt kutu */}
      <div
        role="dialog"
        aria-live="polite"
        className="fixed inset-x-0 bottom-0 z-[60] sm:inset-auto sm:right-6 sm:bottom-6 sm:max-w-sm"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}
      >
        <div className="mx-3 rounded-2xl border border-stone-700/60 bg-stone-900/90 backdrop-blur supports-[backdrop-filter]:bg-stone-900/70 p-3 shadow-2xl sm:mx-0">
          <div className="flex gap-3">
            {it.imageUrl ? (
              <img
                src={it.imageUrl}
                alt={it.title || "Announcement"}
                className="h-12 w-12 flex-none rounded-xl object-cover ring-1 ring-black/10"
                loading="lazy"
              />
            ) : null}

            <div className="min-w-0 flex-1">
              {it.title ? (
                <div className="truncate text-sm font-semibold">{it.title}</div>
              ) : null}
              {it.text ? (
                <div className="mt-0.5 text-xs text-stone-300/90 break-words">
                  {it.text}
                </div>
              ) : null}

              {(it.ctaHref && it.ctaLabel) ? (
                <a
                  href={it.ctaHref}
                  onClick={() => markSeen(id, freq)}
                  className="mt-2 inline-flex items-center rounded-full bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-400"
                >
                  {it.ctaLabel}
                </a>
              ) : null}
            </div>

            <button
              aria-label="Kapat"
              onClick={close}
              className="ml-1 inline-flex h-8 w-8 flex-none items-center justify-center rounded-full text-stone-300/80 hover:bg-stone-800/70"
            >
              ✕
            </button>
          </div>
          {/* alt satır: sıklık etiketini minikçe göstermek istersen */}
          {/* <div className="mt-2 text-[10px] text-stone-400">{freq === "once" ? "Bu cihazda bir kere gösterilir" : "Günde bir kez gösterilir"}</div> */}
        </div>
      </div>
    </>
  );
}
