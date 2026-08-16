"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type TrackingPoint = {
  lat: number;
  lng: number;
};

export type TrackingRouteInfo = {
  distanceMeters: number;
  durationSeconds: number;
  generatedAt: number;
  activeOrderCount: number;
  etaReliable: boolean;
};

type Props = {
  trackingToken: string;
  active: boolean;
  position: (TrackingPoint & { ts?: number }) | null;
  destination: TrackingPoint | null;
  lastSeenText?: string | null;
  onRouteInfo?: (info: TrackingRouteInfo | null) => void;
};

type MapsApi = any;

let mapsPromise: Promise<MapsApi> | null = null;

const ROUTE_MIN_REFRESH_MS = 120_000;
const ROUTE_FORCE_REFRESH_MS = 300_000;
const ROUTE_MOVE_REFRESH_METERS = 350;

function loadGoogleMaps(): Promise<MapsApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("maps_unavailable"));
  }

  const existingMaps = (window as any).google?.maps;
  if (existingMaps?.Map) return Promise.resolve(existingMaps);
  if (mapsPromise) return mapsPromise;

  const apiKey = String(
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY || "",
  ).trim();

  if (!apiKey) {
    return Promise.reject(new Error("maps_not_configured"));
  }

  mapsPromise = new Promise((resolve, reject) => {
    const finish = () => {
      const maps = (window as any).google?.maps;
      if (maps?.Map) {
        resolve(maps);
      } else {
        mapsPromise = null;
        reject(new Error("maps_load_failed"));
      }
    };

    const existingScript = Array.from(document.scripts).find((script) =>
      String(script.src || "").includes("maps.googleapis.com/maps/api/js"),
    );

    if (existingScript) {
      existingScript.addEventListener("load", finish, { once: true });
      existingScript.addEventListener(
        "error",
        () => {
          mapsPromise = null;
          reject(new Error("maps_load_failed"));
        },
        { once: true },
      );

      window.setTimeout(() => {
        const maps = (window as any).google?.maps;
        if (maps?.Map) resolve(maps);
      }, 0);
      return;
    }

    const script = document.createElement("script");
    script.id = "bb-google-tracking-map";
    script.async = true;
    script.defer = true;
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
      "&v=weekly&language=de&region=DE";
    script.addEventListener("load", finish, { once: true });
    script.addEventListener(
      "error",
      () => {
        mapsPromise = null;
        reject(new Error("maps_load_failed"));
      },
      { once: true },
    );
    document.head.appendChild(script);
  });

  return mapsPromise;
}

function decodePolyline(encoded: string): TrackingPoint[] {
  const points: TrackingPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);

    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);

    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

function haversineMeters(a: TrackingPoint, b: TrackingPoint) {
  const radius = 6_371_000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function formatDistance(meters: number) {
  if (!Number.isFinite(meters) || meters <= 0) return "–";
  if (meters < 1000) return `${Math.max(50, Math.round(meters / 50) * 50)} m`;
  return `${(meters / 1000).toFixed(meters >= 10_000 ? 0 : 1).replace(".", ",")} km`;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "–";
  return `${Math.max(1, Math.ceil(seconds / 60))} Min.`;
}

function makeDriverIcon(maps: MapsApi) {
  return {
    path: maps.SymbolPath.CIRCLE,
    scale: 18,
    fillColor: "#0f172a",
    fillOpacity: 1,
    strokeColor: "#38bdf8",
    strokeOpacity: 1,
    strokeWeight: 3,
  };
}

function makeDestinationIcon(maps: MapsApi) {
  return {
    path: maps.SymbolPath.CIRCLE,
    scale: 15,
    fillColor: "#052e16",
    fillOpacity: 1,
    strokeColor: "#34d399",
    strokeOpacity: 1,
    strokeWeight: 3,
  };
}

function darkMapStyles() {
  return [
    { elementType: "geometry", stylers: [{ color: "#111827" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#d1d5db" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#111827" }] },
    { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#374151" }] },
    { featureType: "poi", elementType: "geometry", stylers: [{ color: "#172033" }] },
    { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#10271e" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#293548" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#111827" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#34435a" }] },
    { featureType: "transit", elementType: "geometry", stylers: [{ color: "#1f2937" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#081b2d" }] },
  ];
}

export default function GoogleDeliveryMap({
  trackingToken,
  active,
  position,
  destination,
  lastSeenText,
  onRouteInfo,
}: Props) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapsRef = useRef<MapsApi | null>(null);
  const mapRef = useRef<any>(null);
  const driverMarkerRef = useRef<any>(null);
  const destinationMarkerRef = useRef<any>(null);
  const routeLineRef = useRef<any>(null);
  const animationRef = useRef<number | null>(null);
  const routeBusyRef = useRef(false);
  const lastRouteAtRef = useRef(0);
  const lastRouteOriginRef = useRef<TrackingPoint | null>(null);
  const mountedRef = useRef(true);
  const onRouteInfoRef = useRef(onRouteInfo);

  const [mapError, setMapError] = useState("");
  const [routeError, setRouteError] = useState("");
  const [routeInfo, setRouteInfo] = useState<TrackingRouteInfo | null>(null);

  useEffect(() => {
    onRouteInfoRef.current = onRouteInfo;
  }, [onRouteInfo]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  const fitMap = useCallback((path: TrackingPoint[] = []) => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (!maps || !map) return;

    const points = [
      ...(position ? [position] : []),
      ...(destination ? [destination] : []),
      ...path,
    ];

    if (!points.length) return;
    if (points.length === 1) {
      map.setCenter(points[0]);
      map.setZoom(15);
      return;
    }

    const bounds = new maps.LatLngBounds();
    points.forEach((point) => bounds.extend(point));
    map.fitBounds(bounds, 48);
  }, [destination, position]);

  useEffect(() => {
    if (!active || !mapNodeRef.current || (!position && !destination)) return;

    let cancelled = false;

    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !mapNodeRef.current) return;

        mapsRef.current = maps;
        let shouldFit = false;

        if (!mapRef.current) {
          const center = position || destination || { lat: 52.52, lng: 13.405 };
          mapRef.current = new maps.Map(mapNodeRef.current, {
            center,
            zoom: 15,
            disableDefaultUI: true,
            zoomControl: true,
            gestureHandling: "cooperative",
            clickableIcons: false,
            styles: darkMapStyles(),
            backgroundColor: "#0b1220",
          });
          shouldFit = true;
        }

        if (position && !driverMarkerRef.current) {
          driverMarkerRef.current = new maps.Marker({
            map: mapRef.current,
            position,
            title: "Fahrer",
            icon: makeDriverIcon(maps),
            label: {
              text: "🚚",
              fontSize: "16px",
            },
            zIndex: 20,
          });
          shouldFit = true;
        }

        if (destination && !destinationMarkerRef.current) {
          destinationMarkerRef.current = new maps.Marker({
            map: mapRef.current,
            position: destination,
            title: "Lieferziel",
            icon: makeDestinationIcon(maps),
            label: {
              text: "●",
              color: "#d1fae5",
              fontSize: "11px",
              fontWeight: "700",
            },
            zIndex: 10,
          });
          shouldFit = true;
        }

        if (shouldFit) fitMap();
        setMapError("");
      })
      .catch((error) => {
        if (cancelled) return;
        const code = error instanceof Error ? error.message : "maps_load_failed";
        setMapError(
          code === "maps_not_configured"
            ? "Google Maps ist noch nicht konfiguriert."
            : "Google Maps konnte gerade nicht geladen werden.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [active, destination, fitMap, position]);

  useEffect(() => {
    const marker = driverMarkerRef.current;
    const map = mapRef.current;
    if (!marker || !map || !position) return;

    if (animationRef.current != null) cancelAnimationFrame(animationRef.current);

    const fromValue = marker.getPosition?.();
    const from = fromValue
      ? { lat: Number(fromValue.lat()), lng: Number(fromValue.lng()) }
      : position;
    const to = { lat: position.lat, lng: position.lng };
    const startedAt = performance.now();
    const duration = 1_100;

    const tick = (time: number) => {
      const progress = Math.min(1, (time - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = {
        lat: from.lat + (to.lat - from.lat) * eased,
        lng: from.lng + (to.lng - from.lng) * eased,
      };

      marker.setPosition(next);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(tick);
      } else {
        animationRef.current = null;
        const bounds = map.getBounds?.();
        if (bounds && !bounds.contains(to)) map.panTo(to);
      }
    };

    animationRef.current = requestAnimationFrame(tick);
  }, [position?.lat, position?.lng]);

  useEffect(() => {
    const marker = destinationMarkerRef.current;
    if (marker && destination) marker.setPosition(destination);
  }, [destination?.lat, destination?.lng]);

  const fetchRoute = useCallback(async () => {
    if (!active || !trackingToken || !position || !destination) return;
    if (routeBusyRef.current) return;

    const now = Date.now();
    const age = now - lastRouteAtRef.current;
    const moved = lastRouteOriginRef.current
      ? haversineMeters(lastRouteOriginRef.current, position)
      : Number.POSITIVE_INFINITY;

    const shouldRefresh =
      lastRouteAtRef.current === 0 ||
      age >= ROUTE_FORCE_REFRESH_MS ||
      (age >= ROUTE_MIN_REFRESH_MS && moved >= ROUTE_MOVE_REFRESH_METERS);

    if (!shouldRefresh) return;

    routeBusyRef.current = true;

    try {
      const response = await fetch("/api/track/route", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-order-tracking-token": trackingToken,
        },
        body: JSON.stringify({
          origin: {
            lat: position.lat,
            lng: position.lng,
          },
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data?.ok === false) {
        if (response.status !== 409 && response.status !== 404) {
          setRouteError("Route wird gleich erneut berechnet.");
        }
        return;
      }

      const encodedPolyline = String(data?.encodedPolyline || "");
      const distanceMeters = Number(data?.distanceMeters);
      const durationSeconds = Number(data?.durationSeconds);
      const generatedAt = Number(data?.generatedAt || Date.now());
      const activeOrderCount = Math.max(1, Number(data?.activeOrderCount || 1));
      const etaReliable = data?.etaReliable !== false;
      const path = encodedPolyline ? decodePolyline(encodedPolyline) : [];

      const maps = mapsRef.current;
      const map = mapRef.current;

      if (maps && map && path.length) {
        if (!routeLineRef.current) {
          routeLineRef.current = new maps.Polyline({
            map,
            path,
            geodesic: false,
            strokeColor: "#38bdf8",
            strokeOpacity: 0.95,
            strokeWeight: 6,
            clickable: false,
            zIndex: 5,
          });
        } else {
          routeLineRef.current.setPath(path);
        }

        fitMap(path);
      }

      const info = {
        distanceMeters: Number.isFinite(distanceMeters) ? distanceMeters : 0,
        durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
        generatedAt: Number.isFinite(generatedAt) ? generatedAt : Date.now(),
        activeOrderCount: Number.isFinite(activeOrderCount) ? activeOrderCount : 1,
        etaReliable,
      } satisfies TrackingRouteInfo;

      lastRouteAtRef.current = Date.now();
      lastRouteOriginRef.current = { lat: position.lat, lng: position.lng };
      setRouteInfo(info);
      onRouteInfoRef.current?.(info);
      setRouteError("");
    } catch {
      if (mountedRef.current) {
        setRouteError("Route wird gleich erneut berechnet.");
      }
    } finally {
      routeBusyRef.current = false;
    }
  }, [active, destination, fitMap, position, trackingToken]);

  useEffect(() => {
    void fetchRoute();
  }, [fetchRoute]);

  useEffect(() => {
    lastRouteAtRef.current = 0;
    lastRouteOriginRef.current = null;
    setRouteInfo(null);
    onRouteInfoRef.current?.(null);
  }, [trackingToken]);

  if (!active) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/15 bg-black/20 shadow-2xl">
      <div className="relative aspect-[4/3] min-h-[300px] w-full sm:aspect-[16/10]">
        <div ref={mapNodeRef} className="absolute inset-0" />

        {mapError && (
          <div className="absolute inset-0 grid place-items-center bg-slate-950/90 p-6 text-center text-sm text-rose-100">
            {mapError}
          </div>
        )}

        {!mapError && !position && (
          <div className="absolute inset-x-4 bottom-4 rounded-xl border border-white/15 bg-slate-950/85 px-4 py-3 text-sm text-stone-100 shadow-xl backdrop-blur">
            🚚 Fahrer-Position wird gleich übertragen…
          </div>
        )}

        {position && (
          <div className="absolute left-3 top-3 rounded-full border border-emerald-300/30 bg-emerald-950/85 px-3 py-1.5 text-xs font-semibold text-emerald-100 shadow-lg backdrop-blur">
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-400 align-middle shadow-[0_0_12px_rgba(52,211,153,.9)]" />
            LIVE{lastSeenText ? ` · vor ${lastSeenText}` : ""}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 divide-x divide-white/10 border-t border-white/10 bg-slate-950/70 text-center">
        <div className="px-2 py-3">
          <div className="text-[10px] uppercase tracking-[.14em] text-stone-400">Entfernung</div>
          <div className="mt-1 text-sm font-bold text-white">
            {routeInfo ? formatDistance(routeInfo.distanceMeters) : "–"}
          </div>
        </div>
        <div className="px-2 py-3">
          <div className="text-[10px] uppercase tracking-[.14em] text-stone-400">Fahrzeit</div>
          <div className="mt-1 text-sm font-bold text-white">
            {routeInfo
              ? `${formatDuration(routeInfo.durationSeconds)}${routeInfo.etaReliable ? "" : "*"}`
              : "–"}
          </div>
        </div>
        <div className="px-2 py-3">
          <div className="text-[10px] uppercase tracking-[.14em] text-stone-400">Status</div>
          <div className="mt-1 text-sm font-bold text-emerald-300">
            {position ? "Unterwegs" : "Warten"}
          </div>
        </div>
      </div>

      {routeInfo && !routeInfo.etaReliable && (
        <div className="border-t border-amber-300/15 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/90">
          * Der Fahrer hat mehrere aktive Lieferungen. Angezeigt wird die direkte Route zu Ihnen; die tatsächliche Ankunft kann abweichen.
        </div>
      )}

      {routeError && (
        <div className="border-t border-amber-300/15 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/90">
          {routeError}
        </div>
      )}
    </div>
  );
}
