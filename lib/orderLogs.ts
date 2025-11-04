// lib/orderLogs.ts
const KEY = "bb_order_logs";

type Log = {
  id: string;      // orderId
  t: number;       // timestamp
  type:
    | "status"
    | "driver_assign"
    | "driver_unassign"
    | "driver_delivered"
    | "note";
  by?: string;     // "admin" / driverName
  data?: any;
};

function readAllLogs(): Log[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAllLogs(arr: Log[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(arr));
}

export function appendLog(entry: Log) {
  const all = readAllLogs();
  all.push(entry);
  writeAllLogs(all);
}

export function readOrderLogs(orderId: string) {
  return readAllLogs().filter((l) => l.id === orderId).sort((a,b)=>a.t-b.t);
}
