/* Live driver tracking (Option A: polling + server JSON) */
import { getDeviceId } from "@/lib/settings";

const BASE = "/api/track";

export type TrackPoint = { lat: number; lng: number; ts: number; speed?: number; heading?: number };
export type TrackSession = {
  id: string;
  createdAt: number;
  active: boolean;
  last?: TrackPoint;
  history: TrackPoint[];
  orders: string[];
  driverId?: string;
};

let watchId: number | null = null;
let postTimer: any = null;
let currentSessionId: string | null = null;

function sessionIdToday(): string {
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return `sess_${day}_${getDeviceId()}`;
}

async function postPoint(lat: number, lng: number, orderIds: string[]) {
  const sid = currentSessionId || sessionIdToday();
  currentSessionId = sid;
  const payload = {
    lat, lng,
    speed: undefined,
    heading: undefined,
    orderIds,
    driverId: getDeviceId(),
    active: true,
  };
  await fetch(`${BASE}/${encodeURIComponent(sid)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

export function startDriverTracking(getActiveOrderIds: () => string[]) {
  if (postTimer) return; // already running
  currentSessionId = sessionIdToday();

  const tick = () => {
    const orders = getActiveOrderIds();
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        postPoint(pos.coords.latitude, pos.coords.longitude, orders);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 }
    );
  };

  tick();
  postTimer = setInterval(tick, 15_000);

  // optional continuous updates
  if ("geolocation" in navigator && navigator.geolocation.watchPosition) {
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const orders = getActiveOrderIds();
        postPoint(pos.coords.latitude, pos.coords.longitude, orders);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 }
    );
  }
}

export async function stopDriverTracking() {
  // mark inactive
  if (currentSessionId) {
    try {
      await fetch(`${BASE}/${encodeURIComponent(currentSessionId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lat: 0, lng: 0, active: false }),
      });
    } catch {}
  }
  if (postTimer) { clearInterval(postTimer); postTimer = null; }
  if (watchId != null && "geolocation" in navigator) {
    try { navigator.geolocation.clearWatch(watchId); } catch {}
    watchId = null;
  }
  currentSessionId = null;
}

export async function fetchByOrder(orderId: string) {
  const res = await fetch(`${BASE}/by-order/${encodeURIComponent(orderId)}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<{ sessionId: string; session: TrackSession }>;
}
