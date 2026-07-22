"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  TvConfirmRequest,
  TvToastMessage,
  TvToastTone,
} from "@/types/tv";

type PendingConfirm = {
  request: TvConfirmRequest;
  resolve: (accepted: boolean) => void;
};

export function useTvFeedback() {
  const [messages, setMessages] = useState<TvToastMessage[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const timerIdsRef = useRef<Set<number>>(new Set());
  const pendingConfirmRef = useRef<PendingConfirm | null>(null);
  const nextIdRef = useRef(1);

  const dismiss = useCallback((id: number) => {
    setMessages((current) => current.filter((message) => message.id !== id));
  }, []);

  const notify = useCallback(
    (
      message: string,
      tone: TvToastTone = "info",
      durationMs = tone === "error" ? 6000 : 3500,
    ) => {
      const cleanMessage = String(message || "").trim();
      if (!cleanMessage) return;

      const id = nextIdRef.current++;
      setMessages((current) => [
        ...current.slice(-3),
        { id, tone, message: cleanMessage },
      ]);

      const timerId = window.setTimeout(() => {
        timerIdsRef.current.delete(timerId);
        dismiss(id);
      }, durationMs);

      timerIdsRef.current.add(timerId);
    },
    [dismiss],
  );

  const confirm = useCallback((request: TvConfirmRequest) => {
    return new Promise<boolean>((resolve) => {
      setPendingConfirm((current) => {
        current?.resolve(false);
        return { request, resolve };
      });
    });
  }, []);

  const answerConfirm = useCallback((accepted: boolean) => {
    setPendingConfirm((current) => {
      if (!current) return null;
      current.resolve(accepted);
      return null;
    });
  }, []);

  useEffect(() => {
    pendingConfirmRef.current = pendingConfirm;
  }, [pendingConfirm]);

  useEffect(() => {
    return () => {
      for (const timerId of timerIdsRef.current) {
        window.clearTimeout(timerId);
      }
      timerIdsRef.current.clear();
      pendingConfirmRef.current?.resolve(false);
      pendingConfirmRef.current = null;
    };
  }, []);

  return {
    messages,
    dismiss,
    notify,
    confirm,
    confirmRequest: pendingConfirm?.request ?? null,
    acceptConfirm: () => answerConfirm(true),
    cancelConfirm: () => answerConfirm(false),
  };
}
