
"use client";
import { readSettings } from "@/lib/settings";

export default function Announcement() {
  const s = readSettings();
  if (!s.announcements?.enabled) return null;
  const list = (s.announcements?.items||[]).filter(it=>it?.active);
  if (!list.length) return null;
  return (
    <div className="sticky top-0 z-50 w-full bg-amber-500/10 backdrop-blur border-b border-amber-500/30">
      <div className="mx-auto max-w-5xl p-2 text-sm">
        <div className="flex gap-3 overflow-x-auto">
          {list.map((it,idx)=>(
            <div key={idx} className="shrink-0 rounded px-3 py-1 border border-amber-500/40">
              <b className="mr-2">{it.title}</b>
              <span className="opacity-90">{it.text}</span>
              {it.ctaHref && it.ctaLabel && (
                <a href={it.ctaHref} className="ml-2 underline hover:no-underline">{it.ctaLabel}</a>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
