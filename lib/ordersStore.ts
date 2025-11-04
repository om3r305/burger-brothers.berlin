
export type Mode = "pickup"|"delivery";
export type OrderItem = {
  name: string;
  qty: number;
  category?: string;
  add?: { label?: string; name?: string; price?: number }[];
  note?: string;
};
export type OrderRecord = {
  id: string;
  ts: number;
  mode: Mode;
  total: number;
  items: OrderItem[];
  address?: any;
  status: "Eingegangen"|"In Arbeit"|"Bereit"|"Abgeschlossen";
  etaMin?: number;
};

const g = global as any;
if (!g.__ORDERS_STORE__) g.__ORDERS_STORE__ = new Map<string, OrderRecord>();
const store: Map<string, OrderRecord> = g.__ORDERS_STORE__;

export function saveOrder(o: OrderRecord) {
  store.set(o.id, o);
}
export function getOrder(id: string): OrderRecord | undefined {
  return store.get(id);
}
export function updateOrder(id: string, patch: Partial<OrderRecord>) {
  const cur = store.get(id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  store.set(id, next);
}
export function listOrders(filter?: { status?: OrderRecord["status"] }) {
  const arr = Array.from(store.values());
  if (filter?.status) return arr.filter(o => o.status === filter.status);
  return arr;
}
