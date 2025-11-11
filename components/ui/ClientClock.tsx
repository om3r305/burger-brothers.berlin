"use client";

import { useEffect, useState } from "react";

type Props = {
  tz?: string;              // ör: "Europe/Berlin"
  withSeconds?: boolean;    // saniye göstermek ister misin
};

export default function ClientClock({ tz = "Europe/Berlin", withSeconds = true }: Props) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const tick = setInterval(() => setNow(new Date()), withSeconds ? 1000 : 60000);
    return () => clearInterval(tick);
  }, [withSeconds]);

  if (!now) return <span suppressHydrationWarning> </span>;

  const fmtDate = new Intl.DateTimeFormat("de-DE", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(now);

  const fmtTime = new Intl.DateTimeFormat("de-DE", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    hour12: false,
  }).format(now);

  return (
    <span suppressHydrationWarning>
      {fmtDate}, {fmtTime}
    </span>
  );
}
