"use client";

import type { SchnellRewardPublic } from "@/lib/rewards/config";

const STORAGE_KEY = "bb_schnell_reward_displayed_v1";
const MAX_ENTRIES = 80;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type StoredEntry = { key: string; shownAt: number };

function rewardKey(orderId: string, reward: Pick<SchnellRewardPublic, "winId">) {
  return `${String(orderId || "").trim()}:${String(reward?.winId || "").trim()}`;
}

function readEntries(): StoredEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - MAX_AGE_MS;
    return parsed
      .filter(
        (entry): entry is StoredEntry =>
          Boolean(entry) &&
          typeof entry.key === "string" &&
          Number(entry.shownAt) >= cutoff,
      )
      .slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

function writeEntries(entries: StoredEntry[]) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(entries.slice(-MAX_ENTRIES)),
    );
  } catch {
    // Private mode/storage quota must never break the order status screen.
  }
}

export function hasDisplayedSchnellReward(
  orderId: string,
  reward: Pick<SchnellRewardPublic, "winId">,
) {
  if (typeof window === "undefined") return false;
  const key = rewardKey(orderId, reward);
  return Boolean(key && readEntries().some((entry) => entry.key === key));
}

export function markSchnellRewardDisplayed(
  orderId: string,
  reward: Pick<SchnellRewardPublic, "winId">,
) {
  if (typeof window === "undefined") return;
  const key = rewardKey(orderId, reward);
  if (!key || key.endsWith(":")) return;
  const next = readEntries().filter((entry) => entry.key !== key);
  next.push({ key, shownAt: Date.now() });
  writeEntries(next);
}
