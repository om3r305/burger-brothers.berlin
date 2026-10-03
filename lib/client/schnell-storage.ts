// Storage is optional on phones (quota, private mode and browser restrictions).
// Keep the current tab's cart and retry key usable even when persistence fails.
const fallback = new Map<string, string | null>();

export const schnellStorage = {
  getItem(key: string): string | null {
    if (typeof window === "undefined") return null;
    if (fallback.has(key)) return fallback.get(key) ?? null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
      fallback.delete(key);
    } catch {
      fallback.set(key, value);
    }
  },
  removeItem(key: string): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(key);
      fallback.delete(key);
    } catch {
      // A tombstone prevents an old persisted cart/key from resurfacing.
      fallback.set(key, null);
    }
  },
};
