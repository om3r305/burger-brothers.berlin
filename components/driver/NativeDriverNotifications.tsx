"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { isNativeAndroidWebView } from "@/lib/client/native-android";
import {
  androidBridge,
  androidNotificationPermission,
  androidPushToken,
  requestAndroidNotifications,
  waitForAndroidBridge,
} from "@/lib/client/android-native-bridge";
export default function NativeDriverNotifications({
  driverId,
}: {
  driverId: string;
}) {
  const [native, setNative] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const registering = useRef(false);
  const registeredToken = useRef("");
  const register = useCallback(async (request = false, force = false) => {
    if (registering.current) return;
    registering.current = true;
    setBusy(true);
    try {
      if (request && (await requestAndroidNotifications()) !== "granted") {
        setMessage(
          "Benachrichtigungen sind nicht freigegeben. Sie können die Freigabe in den Android-App-Einstellungen ändern.",
        );
        return;
      }
      if (androidNotificationPermission() !== "granted") return;
      const token = await androidPushToken();
      if (!force && token === registeredToken.current) return;
      const response = await fetch("/api/native/driver/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (response.ok) registeredToken.current = token;
      setMessage(
        response.ok
          ? "Lieferbenachrichtigungen sind aktiv."
          : "Benachrichtigungen konnten nicht angemeldet werden. Bitte erneut versuchen.",
      );
    } catch {
      setMessage(
        "Benachrichtigungsdienst nicht erreichbar. Bitte erneut versuchen.",
      );
    } finally {
      registering.current = false;
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (!isNativeAndroidWebView()) return;
    setNative(true);
    let cancelled = false;
    registeredToken.current = "";
    const refresh = () => {
      if (!cancelled && androidNotificationPermission() === "granted")
        void register(false, true);
    };
    const rotated = () => {
      const token = androidBridge()?.pushToken;
      if (token && token !== registeredToken.current && !registering.current)
        refresh();
    };
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("bb:nativePushToken", rotated);
    document.addEventListener("visibilitychange", visible);
    void waitForAndroidBridge()
      .then(refresh)
      .catch(() => undefined);
    return () => {
      cancelled = true;
      window.removeEventListener("bb:nativePushToken", rotated);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [driverId, register]);
  if (!native) return null;
  return (
    <aside className="mx-3 my-2 rounded-xl border border-amber-300/30 p-3 text-sm">
      <button
        type="button"
        className="btn-primary"
        disabled={busy}
        onClick={() => void register(true, true)}
      >
        {busy ? "Wird aktiviert …" : "Lieferbenachrichtigungen aktivieren"}
      </button>
      {message && (
        <p role="status" className="mt-2">
          {message}
        </p>
      )}
    </aside>
  );
}
