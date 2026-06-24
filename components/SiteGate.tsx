// components/SiteGate.tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { readSettings } from "@/lib/settings";

/**
 * Müşteri tarafında tüm siteyi bakım modunda kapatır.
 * Admin ayar değiştiğinde storage event’ini dinleyip canlı günceller.
 */
export default function SiteGate({ children }: { children: React.ReactNode }) {
  const [tick, setTick] = useState(0);
  const s = useMemo(() => (readSettings() as any) || {}, [tick]);

  useEffect(() => {
    const on = () => setTick((x) => x + 1);
    window.addEventListener("storage", on);
    window.addEventListener("bb_settings_changed" as any, on);
    return () => {
      window.removeEventListener("storage", on);
      window.removeEventListener("bb_settings_changed" as any, on);
    };
  }, []);

  const closed = !!s?.site?.closed;
  const start = s?.site?.maintenanceStart ? Date.parse(s.site.maintenanceStart) : NaN;
  const end = s?.site?.maintenanceEnd ? Date.parse(s.site.maintenanceEnd) : NaN;
  const now = Date.now();
  const inWindow =
    (Number.isFinite(start) ? now >= start : true) &&
    (Number.isFinite(end) ? now <= end : true);

  if (closed && inWindow) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-950 text-stone-100 p-6">
        <div className="max-w-xl text-center space-y-3">
          <div className="text-2xl font-semibold">Wartungsmodus</div>
          <p className="opacity-90">
            {s?.site?.message || "Wir sind gleich zurück."}
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
