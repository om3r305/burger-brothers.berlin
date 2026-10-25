"use client";

import { isNativeAndroidCustomer } from "@/lib/client/android-native-bridge";
import {
  isActivePaymentRecovery,
  parseJsonUnknown,
} from "@/lib/checkout/runtime";

const RECOVERY_KEY = "bb_active_payment_recovery_v1";
const OPERATIONAL =
  /^\/(?:admin|dashboard|driver|tv|print|showcase|schnellbestellung)(?:\/|$)/;

// Storage is only a recovery candidate. The existing server endpoint verifies
// ownership and payment state; neither manageUrl nor a paid flag is trusted here.
export function nativePaymentRecoveryPath(raw: string | null): string | null {
  const value = parseJsonUnknown(raw);
  if (!isActivePaymentRecovery(value)) return null;
  const id = value.paymentSessionId.trim();
  const token = value.recoveryToken.trim();
  if (
    id.length > 256 ||
    token.length > 512 ||
    /[\s\u0000-\u001f]/.test(id + token)
  )
    return null;
  return `/payment/center?paymentSession=${encodeURIComponent(id)}&recovery=${encodeURIComponent(token)}`;
}

export function installNativePaymentRecovery(): () => void {
  if (typeof window === "undefined" || !isNativeAndroidCustomer())
    return () => {};
  let navigating = false;
  let checking = false;
  let disposed = false;
  let pending: AbortController | null = null;
  const canRecover = () => {
    const path = window.location.pathname;
    return (
      document.visibilityState !== "hidden" &&
      !/^\/payment(?:\/|$)/.test(path) &&
      !OPERATIONAL.test(path)
    );
  };
  const resume = async () => {
    if (disposed || checking || navigating || !canRecover()) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const candidate = window.localStorage.getItem(RECOVERY_KEY);
      const destination = nativePaymentRecoveryPath(candidate);
      if (!destination) return;
      checking = true;
      pending = new AbortController();
      timeout = setTimeout(() => pending?.abort(), 8000);
      const query = new URLSearchParams(destination.split("?")[1]);
      const response = await fetch(
        `/api/payments/session?id=${encodeURIComponent(query.get("paymentSession")!)}&recovery=${encodeURIComponent(query.get("recovery")!)}`,
        {
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
          signal: pending.signal,
        },
      );
      const state = await response.json();
      // Never displace the current page solely because a local candidate exists.
      // Invalid access, transient failures and malformed responses remain retryable.
      if (
        !response.ok ||
        state?.ok !== true ||
        !(
          state.finalized === true ||
          ["open", "pending", "processing", "paid"].includes(state.status)
        )
      )
        return;
      if (
        disposed ||
        !canRecover() ||
        window.localStorage.getItem(RECOVERY_KEY) !== candidate
      )
        return;
      navigating = true;
      window.location.replace(destination);
    } catch {
      navigating = false;
      // Preserve the candidate for a later resume; no local paid/expired inference.
    } finally {
      if (timeout) clearTimeout(timeout);
      checking = false;
      pending = null;
    }
  };
  window.addEventListener("bb:nativeResume", resume);
  window.addEventListener("pageshow", resume);
  document.addEventListener("visibilitychange", resume);
  void resume(); // Cold start after Android killed the background process.
  return () => {
    disposed = true;
    pending?.abort();
    window.removeEventListener("bb:nativeResume", resume);
    window.removeEventListener("pageshow", resume);
    document.removeEventListener("visibilitychange", resume);
  };
}
