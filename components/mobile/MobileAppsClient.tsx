"use client";

import { useEffect, useState } from "react";

type ReleaseInfo = {
  available?: boolean;
  version?: string;
  apkUrl?: string;
  sha256?: string;
  sizeBytes?: number;
};

type AppDefinition = {
  key: "burger-brothers" | "bb-schnell" | "bb-driver";
  title: string;
  subtitle: string;
  icon: string;
  metadata: string;
  fallbackApk: string;
};

const APPS: AppDefinition[] = [
  {
    key: "burger-brothers",
    title: "Burger Brothers",
    subtitle: "Menü, Abholung und Lieferung",
    icon: "/mobile-icons/burger-brothers-192.png",
    metadata: "/downloads/burger-brothers-version.json",
    fallbackApk: "/downloads/burger-brothers.apk",
  },
  {
    key: "bb-schnell",
    title: "BB Schnell",
    subtitle: "Schnellbestellung direkt im Restaurant",
    icon: "/mobile-icons/bb-schnell-192.png",
    metadata: "/downloads/bb-schnell-version.json",
    fallbackApk: "/downloads/bb-schnell.apk",
  },
  {
    key: "bb-driver",
    title: "BB Driver",
    subtitle: "Kurier- und Lieferanwendung",
    icon: "/mobile-icons/bb-driver-192.png",
    metadata: "/downloads/bb-driver-version.json",
    fallbackApk: "/downloads/bb-driver.apk",
  },
];

function formatBytes(value?: number) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function MobileAppsClient() {
  const [releases, setReleases] = useState<Record<string, ReleaseInfo>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void Promise.all(
      APPS.map(async (app) => {
        try {
          const response = await fetch(`${app.metadata}?t=${Date.now()}`, {
            cache: "no-store",
          });
          if (!response.ok) return [app.key, {}] as const;
          const data = (await response.json()) as ReleaseInfo;
          return [app.key, data] as const;
        } catch {
          return [app.key, {}] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setReleases(Object.fromEntries(entries));
      setLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-dvh bg-black px-5 py-10 text-stone-100">
      <section className="mx-auto max-w-5xl">
        <div className="text-center">
          <p className="text-sm font-black uppercase tracking-[0.24em] text-amber-300">
            Burger Brothers Berlin
          </p>
          <h1 className="mt-3 text-4xl font-black sm:text-6xl">Unsere Apps</h1>
          <p className="mx-auto mt-4 max-w-2xl leading-7 text-stone-300">
            Android-App auswählen, APK herunterladen und auf dem Gerät installieren.
            Die iPhone-Versionen sind technisch vorbereitet und werden später veröffentlicht.
          </p>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {APPS.map((app) => {
            const release = releases[app.key] || {};
            const available = release.available === true;
            const apkUrl = release.apkUrl || app.fallbackApk;

            return (
              <article
                key={app.key}
                className="rounded-[2rem] border border-white/15 bg-white/[0.06] p-6 shadow-2xl shadow-black/40"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={app.icon}
                  alt={app.title}
                  className="h-24 w-24 rounded-3xl"
                />
                <h2 className="mt-5 text-2xl font-black text-white">{app.title}</h2>
                <p className="mt-2 min-h-12 text-sm leading-6 text-stone-300">
                  {app.subtitle}
                </p>

                <div className="mt-5 text-xs text-stone-400">
                  {available ? (
                    <>
                      Version {release.version || "1.0.0"}
                      {formatBytes(release.sizeBytes) ? ` · ${formatBytes(release.sizeBytes)}` : ""}
                    </>
                  ) : loaded ? (
                    "Android APK wird vorbereitet."
                  ) : (
                    "Version wird geprüft …"
                  )}
                </div>

                {available ? (
                  <a
                    href={apkUrl}
                    download
                    className="mt-5 block rounded-2xl bg-amber-300 px-5 py-4 text-center font-black text-black transition active:scale-[0.99]"
                  >
                    Android APK herunterladen
                  </a>
                ) : (
                  <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 px-5 py-4 text-center font-bold text-stone-400">
                    Noch nicht veröffentlicht
                  </div>
                )}

                <div className="mt-3 rounded-xl border border-sky-300/15 bg-sky-300/[0.06] px-4 py-3 text-xs leading-5 text-sky-100">
                  iOS vorbereitet · Veröffentlichung später über Apple
                </div>
              </article>
            );
          })}
        </div>

        <div className="mx-auto mt-8 max-w-3xl rounded-2xl border border-amber-300/20 bg-amber-300/[0.07] p-5 text-sm leading-6 text-stone-300">
          Android kann beim ersten Mal die Berechtigung „Unbekannte Apps installieren“
          verlangen. Nur APK-Dateien von dieser offiziellen Burger-Brothers-Seite verwenden.
        </div>
      </section>
    </main>
  );
}
