"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StoredOrder, TvSoundKind } from "@/types/tv";
import {
  TV_SOUND_SOURCES,
  getOrderSoundKey,
  getOrderSoundLabel,
  getTvSoundErrorMessage,
  getTvSoundKind,
  getTvSoundTitle,
  isSoundCandidateOrder,
  saveTvSoundEnabled,
  saveTvSoundVolume,
} from "@/lib/tv/domain";

export function useTvSound() {
  const deliveryAudioRef = useRef<HTMLAudioElement | null>(null);
  const pickupAudioRef = useRef<HTMLAudioElement | null>(null);
  const sourceIndexRef = useRef<Record<TvSoundKind, number>>({
    delivery: 0,
    pickup: 0,
  });
  const knownOrdersRef = useRef<Set<string> | null>(null);
  const enabledRef = useRef(true);
  const volumeRef = useRef(1);

  const [enabled, setEnabled] = useState(true);
  const [unlocked, setUnlocked] = useState(true);
  const [volume, setVolume] = useState(100);
  const [error, setError] = useState("");

  const getAudioRef = useCallback((kind: TvSoundKind) => {
    return kind === "delivery" ? deliveryAudioRef : pickupAudioRef;
  }, []);

  const getAudioForKind = useCallback(
    (kind: TvSoundKind) => {
      if (typeof window === "undefined") return null;

      const ref = getAudioRef(kind);
      const sources = TV_SOUND_SOURCES[kind];
      const index = sourceIndexRef.current[kind] % sources.length;
      const source = sources[index];

      if (!ref.current || ref.current.dataset.src !== source) {
        const audio = new Audio(source);
        audio.preload = "auto";
        audio.dataset.src = source;
        audio.volume = volumeRef.current;
        ref.current = audio;
      }

      return ref.current;
    },
    [getAudioRef],
  );

  const setEnabledSafe = useCallback((nextEnabled: boolean) => {
    enabledRef.current = nextEnabled;
    setEnabled(nextEnabled);
    saveTvSoundEnabled(nextEnabled);

    if (!nextEnabled) setError("");
  }, []);

  const setVolumeSafe = useCallback(
    (nextVolume: number) => {
      const normalized = Math.max(0, Math.min(100, Math.round(nextVolume)));
      const audioVolume = normalized / 100;

      volumeRef.current = audioVolume;
      setVolume(normalized);
      saveTvSoundVolume(normalized);

      for (const kind of ["delivery", "pickup"] as const) {
        const audio = getAudioRef(kind).current;
        if (audio) audio.volume = audioVolume;
      }
    },
    [getAudioRef],
  );

  const play = useCallback(
    async (kind: TvSoundKind, force = false) => {
      if (!force && !enabledRef.current) return false;

      const sources = TV_SOUND_SOURCES[kind];
      let lastError: unknown = null;

      for (let attempt = 0; attempt < sources.length; attempt += 1) {
        const audio = getAudioForKind(kind);
        if (!audio) return false;

        try {
          audio.pause();
          audio.currentTime = 0;
          audio.volume = volumeRef.current;
          await audio.play();

          setUnlocked(true);
          setError("");
          return true;
        } catch (caught) {
          lastError = caught;
          const message =
            caught instanceof Error ? caught.message : String(caught || "");

          if (/notallowed|permission|interact|user gesture|gesture/i.test(message)) {
            setUnlocked(false);
            setError(getTvSoundErrorMessage(caught));
            return false;
          }

          const ref = getAudioRef(kind);
          try {
            ref.current?.pause();
          } catch {
            // Audio cleanup best effort.
          }

          ref.current = null;
          sourceIndexRef.current[kind] =
            (sourceIndexRef.current[kind] + 1) % sources.length;
        }
      }

      console.warn(`${getTvSoundTitle(kind)} sound failed`, lastError);
      setError(getTvSoundErrorMessage(lastError));
      return false;
    },
    [getAudioForKind, getAudioRef],
  );

  const stop = useCallback(() => {
    for (const kind of ["delivery", "pickup"] as const) {
      const audio = getAudioRef(kind).current;
      if (!audio) continue;

      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {
        // Audio cleanup best effort.
      }
    }
  }, [getAudioRef]);

  const unlock = useCallback(async () => {
    setEnabledSafe(true);
    await play("pickup", true);
  }, [play, setEnabledSafe]);

  const toggle = useCallback(async () => {
    if (!enabledRef.current || !unlocked) {
      await unlock();
      return;
    }

    setEnabledSafe(false);
  }, [setEnabledSafe, unlock, unlocked]);

  const handleNewOrders = useCallback(
    (nextOrders: StoredOrder[]) => {
      const candidates = nextOrders.filter(isSoundCandidateOrder);
      const currentKeys = new Set(
        candidates
          .map(getOrderSoundKey)
          .filter((key): key is string => Boolean(key)),
      );

      if (!knownOrdersRef.current) {
        knownOrdersRef.current = currentKeys;
        return;
      }

      const previousKeys = knownOrdersRef.current;
      const newOrders = candidates.filter((order) => {
        const key = getOrderSoundKey(order);
        return Boolean(key && !previousKeys.has(key));
      });

      knownOrdersRef.current = currentKeys;

      if (!newOrders.length || !enabledRef.current) return;

      const hasDelivery = newOrders.some(
        (order) => getTvSoundKind(order) === "delivery",
      );
      const hasPickup = newOrders.some(
        (order) => getTvSoundKind(order) === "pickup",
      );

      if (hasDelivery) void play("delivery");

      if (hasPickup) {
        window.setTimeout(
          () => void play("pickup"),
          hasDelivery ? 900 : 0,
        );
      }

      console.info(
        `TV order sound: ${newOrders.map(getOrderSoundLabel).join(", ")}`,
      );
    },
    [play],
  );

  useEffect(() => {
    const defaultEnabled = true;
    const defaultVolume = 100;

    enabledRef.current = defaultEnabled;
    volumeRef.current = defaultVolume / 100;
    setEnabled(defaultEnabled);
    setUnlocked(true);
    setVolume(defaultVolume);
    saveTvSoundEnabled(defaultEnabled);
    saveTvSoundVolume(defaultVolume);

    for (const kind of ["delivery", "pickup"] as const) {
      try {
        getAudioForKind(kind)?.load();
      } catch {
        // Preload best effort.
      }
    }
  }, [getAudioForKind]);

  useEffect(() => {
    return () => {
      for (const audio of [deliveryAudioRef.current, pickupAudioRef.current]) {
        try {
          audio?.pause();
        } catch {
          // Audio cleanup best effort.
        }
      }
      knownOrdersRef.current?.clear();
    };
  }, []);

  return {
    enabled,
    unlocked,
    volume,
    error,
    play,
    stop,
    toggle,
    setVolume: setVolumeSafe,
    handleNewOrders,
  };
}

export function usePendingOrderAlarm({
  order,
  busy,
  play,
  repeatMs = 4000,
}: {
  order: StoredOrder | null;
  busy: boolean;
  play: (kind: TvSoundKind, force?: boolean) => Promise<boolean>;
  repeatMs?: number;
}) {
  useEffect(() => {
    if (!order || busy) return;

    let stopped = false;
    const kind = getTvSoundKind(order);

    const ring = () => {
      if (!stopped) void play(kind);
    };

    ring();
    const timerId = window.setInterval(ring, repeatMs);

    return () => {
      stopped = true;
      window.clearInterval(timerId);
    };
  }, [busy, order?.id, order?.mode, play, repeatMs]);
}
