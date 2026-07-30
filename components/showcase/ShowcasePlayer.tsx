"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDefaultShowcaseDocument,
  normalizeShowcaseDocument,
  sceneIsActive,
} from "@/lib/showcase/config";
import {
  buildShowcaseMenuPages,
  effectiveShowcaseSceneDuration,
  expandShowcaseScenesForPlayback,
  selectedProductsForScene,
} from "@/lib/showcase/runtime";
import type { ShowcaseSnapshot } from "@/lib/showcase/types";
import ShowcaseStage from "./ShowcaseStage";
import ShowcaseErrorBoundary from "./ShowcaseErrorBoundary";
import WinnerCelebrationOverlay, {
  type ShowcaseWinnerEvent,
} from "./WinnerCelebrationOverlay";

const CACHE_KEY = "bb_showcase_snapshot_v1";
const LIVE_CHANNEL = "bb_showcase_live_v1";
const LIVE_STORAGE_KEY = "bb_showcase_publish_ping";
const MEDIA_CACHE_NAME = "bb-showcase-cloudinary-media-v1";

function isCloudinaryMediaUrl(value?: string) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "res.cloudinary.com";
  } catch {
    return false;
  }
}

async function readCachedMediaObjectUrl(value?: string) {
  if (!value || !isCloudinaryMediaUrl(value) || typeof caches === "undefined") {
    return null;
  }
  try {
    const cache = await caches.open(MEDIA_CACHE_NAME);
    const response = await cache.match(value);
    if (!response?.ok) return null;
    return URL.createObjectURL(await response.blob());
  } catch {
    return null;
  }
}

async function persistCloudinaryMedia(value?: string) {
  if (!value || !isCloudinaryMediaUrl(value) || typeof caches === "undefined") {
    return;
  }
  try {
    const cache = await caches.open(MEDIA_CACHE_NAME);
    if (await cache.match(value)) return;
    const response = await fetch(value, {
      cache: "force-cache",
      credentials: "omit",
      mode: "cors",
    });
    if (response.ok) await cache.put(value, response.clone());
  } catch {
    // The normal Cloudinary URL remains the fallback when a Smart TV browser
    // does not support Cache Storage or cross-origin cache writes.
  }
}

async function pruneCloudinaryMediaCache(keepUrls: string[]) {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(MEDIA_CACHE_NAME);
    const keep = new Set(keepUrls.filter(isCloudinaryMediaUrl));
    const requests = await cache.keys();
    await Promise.all(
      requests.map((request) =>
        keep.has(request.url) ? Promise.resolve(false) : cache.delete(request),
      ),
    );
  } catch {}
}

function defaultSnapshot(): ShowcaseSnapshot {
  const siteUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://www.burger-brothers.berlin";

  return {
    ok: true,
    source: "default_fallback",
    generatedAt: new Date().toISOString(),
    document: createDefaultShowcaseDocument(siteUrl),
    products: [],
    campaigns: [],
    branding: {
      shopName: "Burger Brothers Berlin",
      logoUrl: "/logo-burger-brothers.webp",
      themeId: "classic",
      themeColor: "#0b0704",
      themeVideoUrl: "/flames/flame-loop.mp4",
      themeDecorationsEnabled: true,
      themeMotionEnabled: true,
      themeSnow: false,
      themeCornerLeft: "🍔",
      themeCornerRight: "🔥",
      themeParticles: [],
      themeEffect: "ember",
      themeMotifs: [],
      themeBurst: ["✦", "🔥"],
      reviewsUrl: "",
      locationLabel: "13507 Berlin Tegel",
      siteUrl,
    },
  };
}

function readCachedSnapshot(cacheKey = CACHE_KEY) {
  try {
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ShowcaseSnapshot;
    if (!parsed?.document || !parsed?.branding) return null;
    return {
      ...parsed,
      document: normalizeShowcaseDocument(parsed.document, parsed.branding.siteUrl),
    } as ShowcaseSnapshot;
  } catch {
    return null;
  }
}

function writeCachedSnapshot(snapshot: ShowcaseSnapshot, cacheKey = CACHE_KEY) {
  try {
    localStorage.setItem(cacheKey, JSON.stringify(snapshot));
  } catch {}
}

type ShowcaseFetchResult = ShowcaseSnapshot | { ok: true; unchanged: true; version: string; generatedAt: string };

async function fetchSnapshot(screenSlug = "main", knownVersion = "", signal?: AbortSignal): Promise<ShowcaseFetchResult> {
  const params = new URLSearchParams({ screen: screenSlug, t: String(Date.now()) });
  if (knownVersion) params.set("knownVersion", knownVersion);
  const response = await fetch(`/api/showcase?${params.toString()}`, {
    cache: "no-store",
    signal,
    headers: { Accept: "application/json" },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `SHOWCASE_HTTP_${response.status}`);
  }
  if (data.unchanged === true) return data as ShowcaseFetchResult;
  if (!data.document) throw new Error("SHOWCASE_SNAPSHOT_MISSING");
  return data as ShowcaseSnapshot;
}

export default function ShowcasePlayer({ screenSlug = "main" }: { screenSlug?: string }) {
  const cacheKey = `${CACHE_KEY}:${screenSlug}`;
  const [snapshot, setSnapshot] = useState<ShowcaseSnapshot | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [playbackCycle, setPlaybackCycle] = useState(0);
  const [online, setOnline] = useState(true);
  const [scheduleNow, setScheduleNow] = useState(() => Date.now());
  const [liveEvent, setLiveEvent] = useState<ShowcaseWinnerEvent | null>(null);
  const [resolvedMedia, setResolvedMedia] = useState<{
    playbackKey: string;
    mediaUrl?: string;
    posterUrl?: string;
  }>({ playbackKey: "" });
  const wakeLockRef = useRef<any>(null);
  const loadingRef = useRef(false);
  const snapshotRef = useRef<ShowcaseSnapshot | null>(null);
  const lastFullLoadRef = useRef(0);
  const persistVisibleMediaRef = useRef<() => void>(() => {});
  const liveEventRef = useRef<ShowcaseWinnerEvent | null>(null);
  const seenLiveEventIdsRef = useRef(new Set<string>());
  const scheduledLiveEventIdRef = useRef("");
  const liveEventStartTimerRef = useRef<number | null>(null);
  const liveEventPollBusyRef = useRef(false);
  const liveEventPollFailuresRef = useRef(0);
  const sceneTimerRef = useRef<number | null>(null);
  const sceneTimerStartedAtRef = useRef(0);
  const sceneTimerRemainingMsRef = useRef(0);
  const sceneTimerPlaybackKeyRef = useRef("");
  const sceneVisitCountsRef = useRef(new Map<string, number>());
  snapshotRef.current = snapshot;
  liveEventRef.current = liveEvent;

  useEffect(() => {
    let interval = 0;
    const update = () => setScheduleNow(Date.now());
    const delay = 60_000 - (Date.now() % 60_000) + 120;
    const alignment = window.setTimeout(() => {
      update();
      interval = window.setInterval(update, 60_000);
    }, delay);
    const onVisibility = () => {
      if (document.visibilityState === "visible") update();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(alignment);
      if (interval) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const activeScenes = useMemo(() => {
    const scenes = snapshot?.document?.scenes || [];
    const active = scenes.filter((scene) => sceneIsActive(scene, scheduleNow));
    const playable = active.length
      ? active
      : createDefaultShowcaseDocument(snapshot?.branding?.siteUrl).scenes;
    return expandShowcaseScenesForPlayback(playable);
  }, [scheduleNow, snapshot?.document, snapshot?.branding?.siteUrl]);

  const activeSceneCountRef = useRef(1);
  const activeScenesRef = useRef(activeScenes);
  const currentPlaybackKeyRef = useRef("");
  const advancedPlaybackKeyRef = useRef("");

  const scene = activeScenes[activeIndex] || activeScenes[0];
  const playbackKey = snapshot
    ? `${snapshot.document.version}:${scene.id}:${activeIndex}:${activeScenes.length}:${playbackCycle}`
    : "";

  activeSceneCountRef.current = Math.max(1, activeScenes.length);
  activeScenesRef.current = activeScenes;
  currentPlaybackKeyRef.current = playbackKey;
  const contentIndex = sceneVisitCountsRef.current.get(scene.id) || 0;

  const displayScene = useMemo(() => {
    if (resolvedMedia.playbackKey !== playbackKey) return scene;
    return {
      ...scene,
      mediaUrl: resolvedMedia.mediaUrl || scene.mediaUrl,
      posterUrl: resolvedMedia.posterUrl || scene.posterUrl,
    };
  }, [playbackKey, resolvedMedia, scene]);

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];

    const resolve = async () => {
      const [mediaUrl, posterUrl] = await Promise.all([
        readCachedMediaObjectUrl(scene?.mediaUrl),
        readCachedMediaObjectUrl(scene?.posterUrl),
      ]);
      if (cancelled) {
        [mediaUrl, posterUrl].forEach((value) => value && URL.revokeObjectURL(value));
        return;
      }
      if (mediaUrl) objectUrls.push(mediaUrl);
      if (posterUrl) objectUrls.push(posterUrl);
      setResolvedMedia({
        playbackKey,
        mediaUrl: mediaUrl || undefined,
        posterUrl: posterUrl || undefined,
      });
    };

    void resolve();
    return () => {
      cancelled = true;
      objectUrls.forEach((value) => URL.revokeObjectURL(value));
    };
  }, [playbackKey, scene?.mediaUrl, scene?.posterUrl]);

  useEffect(() => {
    if (!snapshot) return;
    const keepUrls = snapshot.document.scenes.flatMap((entry) =>
      [entry.mediaUrl, entry.posterUrl].filter((value): value is string => Boolean(value)),
    );
    void pruneCloudinaryMediaCache(keepUrls);
    try {
      void navigator.storage?.persist?.();
    } catch {}
  }, [snapshot?.document?.version]);

  const persistVisibleMedia = useCallback(() => {
    void persistCloudinaryMedia(scene?.mediaUrl);
    void persistCloudinaryMedia(scene?.posterUrl);
  }, [scene?.mediaUrl, scene?.posterUrl]);
  persistVisibleMediaRef.current = persistVisibleMedia;

  const advanceScene = useCallback((expectedPlaybackKey?: string) => {
    const currentPlaybackKey = currentPlaybackKeyRef.current;

    // Ignore stale video/timer callbacks that belong to the previous scene.
    if (expectedPlaybackKey && expectedPlaybackKey !== currentPlaybackKey) return;
    if (!currentPlaybackKey) return;

    // Timer, render error and media error callbacks can fire close together.
    // Advance only once for the currently visible scene.
    if (advancedPlaybackKeyRef.current === currentPlaybackKey) return;
    advancedPlaybackKeyRef.current = currentPlaybackKey;

    setActiveIndex((current) => {
      const next = (current + 1) % Math.max(1, activeSceneCountRef.current);
      const nextScene = activeScenesRef.current[next];
      if (nextScene?.type === "reviews") {
        sceneVisitCountsRef.current.set(
          nextScene.id,
          (sceneVisitCountsRef.current.get(nextScene.id) || 0) + 1,
        );
      }
      return next;
    });
    setPlaybackCycle((current) => current + 1);
  }, []);

  const load = useCallback(async (quiet = false, forceFull = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    const current = snapshotRef.current;
    const dynamicRefreshDue = Date.now() - lastFullLoadRef.current >= 5 * 60_000;
    const knownVersion = !forceFull && !dynamicRefreshDue ? current?.document?.version || "" : "";

    try {
      const result = await fetchSnapshot(screenSlug, knownVersion, controller.signal);
      setOnline(true);
      if ("unchanged" in result && result.unchanged) return;
      const fresh = result as ShowcaseSnapshot;
      lastFullLoadRef.current = Date.now();
      writeCachedSnapshot(fresh, cacheKey);
      setSnapshot((previous) => {
        if (previous?.document?.version === fresh.document.version) {
          return { ...fresh, document: previous.document };
        }
        setActiveIndex(0);
        setPlaybackCycle((cycle) => cycle + 1);
        return fresh;
      });
    } catch (error) {
      setOnline(false);
      if (!quiet) {
        setSnapshot((currentSnapshot) => currentSnapshot || readCachedSnapshot(cacheKey) || defaultSnapshot());
      }
    } finally {
      loadingRef.current = false;
      window.clearTimeout(timeout);
    }
  }, [cacheKey, screenSlug]);

  const loadLiveEvent = useCallback(async () => {
    if (
      liveEventRef.current ||
      scheduledLiveEventIdRef.current ||
      liveEventPollBusyRef.current ||
      document.visibilityState === "hidden"
    ) {
      return;
    }

    liveEventPollBusyRef.current = true;
    const controller = new AbortController();
    const abortTimer = window.setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(
        `/api/showcase/events?screen=${encodeURIComponent(screenSlug)}&t=${Date.now()}`,
        {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        },
      );

      const data = await response.json().catch(() => null);
      const nextEvent = data?.ok ? (data.event as ShowcaseWinnerEvent | null) : null;
      if (!response.ok || !nextEvent?.id) {
        liveEventPollFailuresRef.current = response.ok
          ? 0
          : Math.min(5, liveEventPollFailuresRef.current + 1);
        return;
      }
      if (seenLiveEventIdsRef.current.has(nextEvent.id)) return;

      liveEventPollFailuresRef.current = 0;
      scheduledLiveEventIdRef.current = nextEvent.id;
      const scheduledAtMs = new Date(
        nextEvent.scheduledAt || Date.now(),
      ).getTime();
      const delayMs = Number.isFinite(scheduledAtMs)
        ? Math.max(0, scheduledAtMs - Date.now())
        : 0;

      const startEvent = () => {
        liveEventStartTimerRef.current = null;
        scheduledLiveEventIdRef.current = "";
        if (seenLiveEventIdsRef.current.has(nextEvent.id)) return;
        seenLiveEventIdsRef.current.add(nextEvent.id);
        setLiveEvent(nextEvent);
      };

      if (delayMs <= 40) {
        startEvent();
      } else {
        liveEventStartTimerRef.current = window.setTimeout(startEvent, delayMs);
      }
    } catch {
      liveEventPollFailuresRef.current = Math.min(
        5,
        liveEventPollFailuresRef.current + 1,
      );
      // The normal Showcase loop must continue even if live events are offline.
    } finally {
      window.clearTimeout(abortTimer);
      liveEventPollBusyRef.current = false;
    }
  }, [screenSlug]);

  useEffect(() => {
    let stopped = false;
    let timer = 0;

    const scheduleNext = () => {
      if (stopped) return;
      const failureDelay = liveEventPollFailuresRef.current * 2_000;
      // 4 saniye, iki ekranda eski 2 saniyelik polling yükünü yarıya indirir.
      // Küçük sabit screen jitter aynı milisaniyede bağlantı kuyruğu oluşmasını önler.
      const screenJitter = [...screenSlug].reduce(
        (sum, char) => sum + char.charCodeAt(0),
        0,
      ) % 700;
      timer = window.setTimeout(async () => {
        await loadLiveEvent();
        scheduleNext();
      }, 4_000 + screenJitter + failureDelay);
    };

    void loadLiveEvent().finally(scheduleNext);

    const onVisibility = () => {
      if (document.visibilityState === "visible") void loadLiveEvent();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      if (liveEventStartTimerRef.current != null) {
        window.clearTimeout(liveEventStartTimerRef.current);
        liveEventStartTimerRef.current = null;
      }
      scheduledLiveEventIdRef.current = "";
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadLiveEvent, screenSlug]);

  useEffect(() => {
    if (!liveEvent) return;
    const durationSeconds = Math.max(3, Math.min(30, Number(liveEvent.payload.durationSeconds || 12)));
    const timer = window.setTimeout(() => {
      const completed = liveEvent;
      setLiveEvent(null);
      void fetch("/api/showcase/events", {
        method: "POST",
        cache: "no-store",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: completed.id, ackToken: completed.ackToken }),
      }).catch(() => {});
    }, durationSeconds * 1_000);
    return () => window.clearTimeout(timer);
  }, [liveEvent]);

  useEffect(() => {
    const trimSeenEvents = window.setInterval(() => {
      if (seenLiveEventIdsRef.current.size > 200) {
        seenLiveEventIdsRef.current.clear();
        if (liveEventRef.current?.id) seenLiveEventIdsRef.current.add(liveEventRef.current.id);
      }
    }, 10 * 60_000);
    return () => window.clearInterval(trimSeenEvents);
  }, []);

  useEffect(() => {
    const cached = readCachedSnapshot(cacheKey);
    setSnapshot(cached || defaultSnapshot());
    void load(Boolean(cached));
  }, [load]);

  useEffect(() => {
    if (!snapshot) return;
    const seconds = Math.max(
      10,
      Math.min(60, Number(snapshot.document.settings.refreshSeconds || 15)),
    );
    const timer = window.setInterval(() => void load(true), seconds * 1_000);
    return () => window.clearInterval(timer);
  }, [load, snapshot?.document?.settings?.refreshSeconds]);

  useEffect(() => {
    const refreshNow = () => void load(true, true);
    let channel: BroadcastChannel | null = null;

    try {
      channel = new BroadcastChannel(LIVE_CHANNEL);
      channel.onmessage = refreshNow;
    } catch {}

    const onStorage = (event: StorageEvent) => {
      if (event.key === LIVE_STORAGE_KEY) refreshNow();
    };
    const onFocus = () => refreshNow();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshNow();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      channel?.close();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const sceneDurationSeconds = useMemo(() => {
    if (!snapshot) return 0;

    const isPortrait =
      typeof window !== "undefined" &&
      window.innerWidth / Math.max(1, window.innerHeight) < 1.15;
    const menuPageSize =
      scene.type === "menu" && isPortrait
        ? Math.min(6, Number(scene.menuItemsPerPage || 8))
        : undefined;

    return effectiveShowcaseSceneDuration(scene, snapshot, menuPageSize);
  }, [scene, snapshot?.products]);

  useEffect(() => {
    advancedPlaybackKeyRef.current = "";
  }, [playbackKey]);

  useEffect(() => {
    sceneVisitCountsRef.current.clear();
  }, [snapshot?.document?.version]);

  useEffect(() => {
    if (!playbackKey || sceneDurationSeconds <= 0) return;

    const fullDurationMs = sceneDurationSeconds * 1_000;
    if (sceneTimerPlaybackKeyRef.current !== playbackKey) {
      if (sceneTimerRef.current) window.clearTimeout(sceneTimerRef.current);
      sceneTimerRef.current = null;
      sceneTimerPlaybackKeyRef.current = playbackKey;
      sceneTimerRemainingMsRef.current = fullDurationMs;
      sceneTimerStartedAtRef.current = 0;
    }

    // A winner overlay temporarily pauses the current scene. When the overlay
    // closes, the exact remaining scene time resumes instead of restarting.
    if (liveEvent) return;

    const delay = Math.max(50, sceneTimerRemainingMsRef.current || fullDurationMs);
    sceneTimerStartedAtRef.current = Date.now();
    sceneTimerRef.current = window.setTimeout(() => {
      sceneTimerRef.current = null;
      sceneTimerStartedAtRef.current = 0;
      sceneTimerRemainingMsRef.current = 0;
      sceneTimerPlaybackKeyRef.current = "";
      persistVisibleMediaRef.current();
      advanceScene(playbackKey);
    }, delay);

    return () => {
      if (sceneTimerRef.current) {
        window.clearTimeout(sceneTimerRef.current);
        sceneTimerRef.current = null;
      }
      if (
        sceneTimerPlaybackKeyRef.current === playbackKey &&
        sceneTimerStartedAtRef.current > 0
      ) {
        const elapsed = Date.now() - sceneTimerStartedAtRef.current;
        sceneTimerRemainingMsRef.current = Math.max(0, delay - elapsed);
      }
      sceneTimerStartedAtRef.current = 0;
    };
  }, [advanceScene, liveEvent, playbackKey, sceneDurationSeconds]);

  useEffect(() => {
    if (activeIndex < activeScenes.length) return;
    setActiveIndex(0);
  }, [activeIndex, activeScenes.length]);

  useEffect(() => {
    if (!snapshot) return;
    const nextScene = activeScenes[(activeIndex + 1) % Math.max(1, activeScenes.length)];
    if (!nextScene) return;

    const urls = new Set<string>();
    if (nextScene.mediaUrl) urls.add(nextScene.mediaUrl);
    if (nextScene.posterUrl) urls.add(nextScene.posterUrl);

    if (nextScene.type === "product") {
      selectedProductsForScene(nextScene, snapshot.products)
        .slice(0, 8)
        .forEach((product) => product.imageUrl && urls.add(product.imageUrl));
    }

    if (nextScene.type === "menu") {
      buildShowcaseMenuPages(nextScene, snapshot.products)
        .slice(0, 2)
        .flatMap((page) => page.products)
        .forEach((product) => product.imageUrl && urls.add(product.imageUrl));
    }

    const cleanups: Array<() => void> = [];
    for (const url of urls) {
      if (nextScene.type === "video" || /\.(mp4|webm)(?:\?|$)/i.test(url)) {
        const video = document.createElement("video");
        video.preload = "auto";
        video.muted = true;
        video.src = url;
        video.load();
        cleanups.push(() => {
          video.removeAttribute("src");
          video.load();
        });
      } else {
        const image = new Image();
        image.src = url;
      }
    }

    return () => cleanups.forEach((cleanup) => cleanup());
  }, [activeIndex, activeScenes, snapshot]);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => {
    const requestWakeLock = async () => {
      try {
        if ("wakeLock" in navigator && document.visibilityState === "visible") {
          wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
        }
      } catch {}
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void requestWakeLock();
    };
    void requestWakeLock();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      wakeLockRef.current?.release?.().catch?.(() => {});
    };
  }, []);

  if (!snapshot) {
    return (
      <div id="bb-showcase-root" className="fixed inset-0 z-[1200] grid place-items-center bg-black">
        <img src="/logo-burger-brothers.webp" alt="Burger Brothers Berlin" className="h-36 w-36 object-contain" />
      </div>
    );
  }

  if (!snapshot.document.enabled) {
    const disabled = {
      ...createDefaultShowcaseDocument(snapshot.branding.siteUrl).scenes[0],
      title: snapshot.branding.shopName,
      subtitle: "Das Schaufenster ist momentan pausiert.",
      showQr: true,
    };
    return (
      <div id="bb-showcase-root">
        <ShowcaseStage
          snapshot={snapshot}
          scene={disabled}
          sceneIndex={0}
          sceneCount={1}
          online={online}
        />
        {liveEvent ? <WinnerCelebrationOverlay event={liveEvent} /> : null}
      </div>
    );
  }

  return (
    <div id="bb-showcase-root">
      <ShowcaseErrorBoundary key={playbackKey} label="Sahne atlandı" onReset={() => advanceScene(playbackKey)}>
        <ShowcaseStage
          snapshot={snapshot}
          scene={displayScene}
          sceneIndex={activeIndex}
          sceneCount={activeScenes.length}
          contentIndex={contentIndex}
          online={online}
          onVideoEnded={() => {
            // Video uzunluğu sahne süresini belirlemez. "hold" modunda video
            // son karede bekler; "loop" modunda yeniden başlar. Geçişi yalnız
            // sahne zamanlayıcısı yapar.
            persistVisibleMedia();
          }}
          onVideoError={() => advanceScene(playbackKey)}
        />
      </ShowcaseErrorBoundary>
      {liveEvent ? <WinnerCelebrationOverlay event={liveEvent} /> : null}
    </div>
  );
}
