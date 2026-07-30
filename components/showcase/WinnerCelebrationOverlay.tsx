"use client";

import { useEffect } from "react";
import RewardStage from "@/components/rewards/RewardStage";
import {
  playRewardCelebrationSound,
  prewarmRewardCelebration,
  stopRewardCelebrationSound,
} from "@/lib/client/reward-celebration";

export type ShowcaseWinnerEvent = {
  id: string;
  ackToken: string;
  expiresAt: string;
  scheduledAt?: string;
  eventType: string;
  payload: {
    displayName?: string;
    rewardLabel?: string;
    customerNumber?: number;
    photoUrl?: string | null;
    durationSeconds?: number;
    soundEnabled?: boolean;
    headline?: string;
    message?: string;
  };
};

export default function WinnerCelebrationOverlay({ event }: { event: ShowcaseWinnerEvent }) {
  useEffect(() => {
    prewarmRewardCelebration();
    playRewardCelebrationSound(event.payload.soundEnabled !== false);
    return () => stopRewardCelebrationSound();
  }, [event.id, event.payload.soundEnabled]);

  const name = String(event.payload.displayName || "Glückspilz").trim();
  const reward = String(event.payload.rewardLabel || "einen Glücksgewinn").trim();
  const headline = String(event.payload.headline || `${name} hat gewonnen!`).trim();

  return (
    <RewardStage
      mode="tv"
      headline={headline.toLocaleUpperCase("de-DE")}
      reward={reward}
      orderNumber={
        Number(event.payload.customerNumber) > 0
          ? event.payload.customerNumber
          : undefined
      }
      photoUrl={event.payload.photoUrl}
      photoAlt={name}
      message={event.payload.message || "Herzlichen Glückwunsch und guten Appetit!"}
    />
  );
}
