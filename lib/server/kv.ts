// lib/server/kv.ts
import fs from "fs";
import path from "path";

const DATA_FILE = process.env.KV_FILE || path.resolve(process.cwd(), "data/kv.json");

function load(): Record<string, any> {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")); } catch { return {}; }
}
function save(obj: Record<string, any>) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2), "utf-8");
}

export function incr(key: string): number {
  const store = load();
  const v = (store[key] || 0) + 1;
  store[key] = v;
  save(store);
  return v;
}
export function resetIfOlder(key: string, ms: number) {
  const tsKey = key + ":ts";
  const store = load();
  const now = Date.now();
  const ts = store[tsKey] || 0;
  if (now - ts > ms) {
    store[key] = 0;
    store[tsKey] = now;
    save(store);
    return true;
  }
  return false;
}
