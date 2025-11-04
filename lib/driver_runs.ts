// lib/driver_runs.ts
// Basit “aktif koşu” listesi. Sürücü cihazında hangi siparişler var tutar.
const PREFIX = "bb_run_";

export function addToRun(driverDeviceId: string, orderId: string) {
  const arr = getRun(driverDeviceId);
  if (!arr.includes(orderId)) arr.push(orderId);
  setRun(driverDeviceId, arr);
}

export function removeFromRun(driverDeviceId: string, orderId: string) {
  const arr = getRun(driverDeviceId).filter((x) => x !== orderId);
  setRun(driverDeviceId, arr);
}

export function clearRun(driverDeviceId: string) {
  setRun(driverDeviceId, []);
}

export function getRun(driverDeviceId: string): string[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = localStorage.getItem(PREFIX + driverDeviceId);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setRun(id: string, arr: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PREFIX + id, JSON.stringify(arr));
}
