"use client";
import { isNativeAndroidWebView } from "@/lib/client/native-android";
export type AndroidBridge = {
  platform: "android";
  appKind: "main" | "driver" | "schnell";
  permission: NotificationPermission;
  pushToken?: string;
  requestNotifications: () => void;
  refresh: () => void;
  updateDriverRoute: (route: { active: boolean }) => void;
};
export function androidBridge(): AndroidBridge | null {
  if (typeof window === "undefined" || !isNativeAndroidWebView()) return null;
  const bridge = (window as any).BurgerBrothersNative;
  return bridge?.platform === "android" &&
    typeof bridge.requestNotifications === "function"
    ? bridge
    : null;
}
export function isNativeAndroidCustomer() {
  return (
    typeof navigator !== "undefined" &&
    /\bBurgerBrothers-Android\/main(?=\s|$)/.test(navigator.userAgent)
  );
}
export function androidNotificationPermission(): NotificationPermission {
  return androidBridge()?.permission || "default";
}
function waitForValue<T>(
  event: string,
  read: () => T | null,
  timeout: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const done = () => {
      const value = read();
      if (value !== null) {
        clearTimeout(timer);
        window.removeEventListener(event, done);
        resolve(value);
      }
    };
    const timer = setTimeout(() => {
      window.removeEventListener(event, done);
      reject(new Error("native_timeout"));
    }, timeout);
    window.addEventListener(event, done);
    done();
  });
}
export async function waitForAndroidBridge() {
  return waitForValue("bb:nativeReady", androidBridge, 5000);
}
export async function requestAndroidNotifications(): Promise<NotificationPermission> {
  const bridge = await waitForAndroidBridge();
  const result = new Promise<NotificationPermission>((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("bb:nativePushPermission", listener);
      reject(new Error("permission_timeout"));
    }, 30000);
    const listener = (event: Event) => {
      clearTimeout(timer);
      window.removeEventListener("bb:nativePushPermission", listener);
      resolve(
        (event as CustomEvent).detail?.granted === true ? "granted" : "denied",
      );
    };
    window.addEventListener("bb:nativePushPermission", listener);
  });
  bridge.requestNotifications();
  return result;
}
export async function androidPushToken(): Promise<string> {
  const bridge = await waitForAndroidBridge();
  const result = waitForValue(
    "bb:nativePushToken",
    () => {
      const token = androidBridge()?.pushToken;
      return typeof token === "string" &&
        /^[A-Za-z0-9:_-]{20,4096}$/.test(token)
        ? token
        : null;
    },
    15000,
  );
  bridge.refresh();
  return result;
}
