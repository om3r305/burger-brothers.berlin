import type { SettingsV6 } from "./settings";

const SETTINGS_URL = "/api/settings";

export async function fetchSettingsRemote(): Promise<SettingsV6 | null> {
  try {
    const res = await fetch(SETTINGS_URL, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function saveSettingsRemote(settings: SettingsV6) {
  const res = await fetch(SETTINGS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error("save_settings_failed");
}
