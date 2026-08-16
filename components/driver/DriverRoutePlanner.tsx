"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  getOrderRouteAddress,
  normalizeStatus,
  orderDeliveryGeo,
  orderPlzValue,
} from "@/lib/driver/domain";
import type {
  DriverIdentity,
  DriverOrder,
  DriverPosition,
  DriverTrackingState,
} from "@/types/driver";

type MapsApi = any;

type RouteMetric = {
  distanceMeters: number;
  durationMillis: number;
};

type Props = {
  driver: DriverIdentity;
  orders: DriverOrder[];
  routePlzPriority: string[];
  storeOrigin: string;
  livePosition: DriverPosition | null;
  trackingState: DriverTrackingState;
  nowMs: number;
  busy: boolean;
  mapPreferenceLabel: string;
  onStart: (orders: DriverOrder[]) => Promise<unknown>;
  onNavigate: (order: DriverOrder) => void;
  onChangeMapPreference: () => void;
};

let mapsPromise: Promise<MapsApi> | null = null;

const ROUTE_RECALC_MIN_MS = 60_000;
const ROUTE_RECALC_MOVE_M = 250;

function loadGoogleMaps(): Promise<MapsApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("maps_unavailable"));
  }

  const existing = (window as any).google?.maps;
  if (existing?.Map) return Promise.resolve(existing);
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
      if (maps?.Map) resolve(maps);
      else {
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
      window.setTimeout(finish, 0);
      return;
    }

    const script = document.createElement("script");
    script.id = "bb-google-driver-map";
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

function darkMapStyles() {
  return [
    { elementType: "geometry", stylers: [{ color: "#111827" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#d1d5db" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#111827" }] },
    {
      featureType: "administrative",
      elementType: "geometry.stroke",
      stylers: [{ color: "#374151" }],
    },
    {
      featureType: "poi",
      elementType: "geometry",
      stylers: [{ color: "#172033" }],
    },
    {
      featureType: "poi.park",
      elementType: "geometry",
      stylers: [{ color: "#10271e" }],
    },
    {
      featureType: "road",
      elementType: "geometry",
      stylers: [{ color: "#293548" }],
    },
    {
      featureType: "road",
      elementType: "geometry.stroke",
      stylers: [{ color: "#111827" }],
    },
    {
      featureType: "road.highway",
      elementType: "geometry",
      stylers: [{ color: "#34435a" }],
    },
    {
      featureType: "water",
      elementType: "geometry",
      stylers: [{ color: "#081b2d" }],
    },
  ];
}

function haversineMeters(a: DriverPosition, b: DriverPosition) {
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

function routeLetter(index: number) {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

function formatDistance(meters: number) {
  if (!Number.isFinite(meters) || meters <= 0) return "–";
  if (meters < 1000) {
    return `${Math.max(50, Math.round(meters / 50) * 50)} m`;
  }

  return `${(meters / 1000)
    .toFixed(meters >= 10_000 ? 0 : 1)
    .replace(".", ",")} km`;
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "–";
  return `${Math.max(1, Math.ceil(ms / 60_000))} Min.`;
}

function driverPositionFromGeolocation(position: GeolocationPosition): DriverPosition {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    ts: Date.now(),
  };
}

function routeFallbackRank(order: DriverOrder, priority: string[]) {
  const plz = orderPlzValue(order);
  const rank = priority.indexOf(plz);
  return rank >= 0 ? rank : priority.length + 100;
}

function orderedByFallback(orders: DriverOrder[], priority: string[]) {
  return [...orders].sort((left, right) => {
    const rankDiff =
      routeFallbackRank(left, priority) - routeFallbackRank(right, priority);
    if (rankDiff !== 0) return rankDiff;

    const leftPlz = orderPlzValue(left);
    const rightPlz = orderPlzValue(right);
    if (leftPlz !== rightPlz) return leftPlz.localeCompare(rightPlz);

    return Number(left.ts || 0) - Number(right.ts || 0);
  });
}

function routePoint(order: DriverOrder) {
  const geo = orderDeliveryGeo(order);
  return geo ? { lat: geo.lat, lng: geo.lng } : null;
}

function routeLocation(order: DriverOrder) {
  return routePoint(order) || getOrderRouteAddress(order);
}

export function DriverRoutePlanner({
  driver,
  orders,
  routePlzPriority,
  storeOrigin,
  livePosition,
  trackingState,
  nowMs,
  busy,
  mapPreferenceLabel,
  onStart,
  onNavigate,
  onChangeMapPreference,
}: Props) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapsRef = useRef<MapsApi | null>(null);
  const mapRef = useRef<any>(null);
  const routeLineRef = useRef<any>(null);
  const driverMarkerRef = useRef<any>(null);
  const stopMarkersRef = useRef<Map<string, any>>(new Map());
  const geocodeCacheRef = useRef<Map<string, DriverPosition>>(new Map());
  const storePointRef = useRef<DriverPosition | null>(null);
  const lastRouteRef = useRef<{
    at: number;
    origin: DriverPosition;
    queueKey: string;
  } | null>(null);
  const autoSortedSetRef = useRef("");

  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [localOrigin, setLocalOrigin] = useState<DriverPosition | null>(null);
  const [metrics, setMetrics] = useState<Record<string, RouteMetric>>({});
  const [routeSummary, setRouteSummary] = useState<RouteMetric | null>(null);
  const [mapError, setMapError] = useState("");
  const [routeNotice, setRouteNotice] = useState("");
  const [sorting, setSorting] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [mapFullscreen, setMapFullscreen] = useState(false);

  const storageKey = `bb_driver_route_queue_v2_${driver.id}`;

  const ordersById = useMemo(
    () => new Map(orders.map((order) => [String(order.id), order])),
    [orders],
  );

  const orderSetKey = useMemo(
    () =>
      orders
        .map((order) => String(order.id))
        .sort()
        .join("|"),
    [orders],
  );

  const ordered = useMemo(() => {
    const result: DriverOrder[] = [];
    const seen = new Set<string>();

    for (const id of orderedIds) {
      const order = ordersById.get(id);
      if (!order || seen.has(id)) continue;
      seen.add(id);
      result.push(order);
    }

    for (const order of orders) {
      const id = String(order.id);
      if (seen.has(id)) continue;
      seen.add(id);
      result.push(order);
    }

    return result;
  }, [orderedIds, orders, ordersById]);

  const startedOrders = useMemo(
    () =>
      ordered.filter(
        (order) => normalizeStatus(order.status) === "out_for_delivery",
      ),
    [ordered],
  );

  const waitingOrders = useMemo(
    () =>
      ordered.filter((order) =>
        ["new", "preparing", "ready"].includes(
          normalizeStatus(order.status),
        ),
      ),
    [ordered],
  );

  const activeOrder = startedOrders[0] || null;
  const origin = livePosition || localOrigin;
  const queueKey = ordered.map((order) => String(order.id)).join("|");

  const saveOrder = useCallback(
    (ids: string[]) => {
      setOrderedIds(ids);
      try {
        localStorage.setItem(storageKey, JSON.stringify(ids));
      } catch {
        // Route queue can always be rebuilt from server orders.
      }
    },
    [storageKey],
  );

  const ensureOrigin = useCallback(async () => {
    if (livePosition) return livePosition;
    if (localOrigin) return localOrigin;

    if (!("geolocation" in navigator)) {
      setRouteNotice(
        "Standort ist nicht verfügbar. Die PLZ-Reihenfolge wird als Fallback verwendet.",
      );
      return null;
    }

    return new Promise<DriverPosition | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const next = driverPositionFromGeolocation(position);
          setLocalOrigin(next);
          resolve(next);
        },
        () => {
          setRouteNotice(
            "Standort konnte nicht gelesen werden. Die PLZ-Reihenfolge wird als Fallback verwendet.",
          );
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 10_000,
          timeout: 10_000,
        },
      );
    });
  }, [livePosition, localOrigin]);

  const resolveStorePoint = useCallback(
    async (maps: MapsApi) => {
      if (storePointRef.current) return storePointRef.current;

      const address = String(storeOrigin || "").trim();
      if (!address || !maps?.Geocoder) return null;

      try {
        const geocoder = new maps.Geocoder();
        const result = await geocoder.geocode({
          address,
          region: "DE",
        });
        const location = result?.results?.[0]?.geometry?.location;

        if (!location) return null;

        const point = {
          lat: Number(location.lat()),
          lng: Number(location.lng()),
          ts: Date.now(),
        };

        if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
          return null;
        }

        storePointRef.current = point;
        return point;
      } catch {
        return null;
      }
    },
    [storeOrigin],
  );

  const resolvePoint = useCallback(
    async (order: DriverOrder, maps: MapsApi) => {
      const direct = routePoint(order);
      if (direct) return direct;

      const id = String(order.id);
      const cached = geocodeCacheRef.current.get(id);
      if (cached) return cached;

      const address = getOrderRouteAddress(order);
      if (!address || !maps?.Geocoder) return null;

      try {
        const geocoder = new maps.Geocoder();
        const result = await geocoder.geocode({
          address,
          region: "DE",
        });
        const location = result?.results?.[0]?.geometry?.location;

        if (!location) return null;

        const point = {
          lat: Number(location.lat()),
          lng: Number(location.lng()),
          ts: Date.now(),
        };

        if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
          return null;
        }

        geocodeCacheRef.current.set(id, point);
        return point;
      } catch {
        return null;
      }
    },
    [],
  );

  const autoSort = useCallback(
    async (sourceOrders: DriverOrder[] = ordered) => {
      if (sourceOrders.length <= 1) {
        saveOrder(sourceOrders.map((order) => String(order.id)));
        return;
      }

      setSorting(true);
      setRouteNotice("");

      try {
        // Route planning always starts from the driver's real current position.
        // The restaurant address is only a fallback if device location is unavailable.
        const currentOrigin = await ensureOrigin();
        const matrixOrigin =
          currentOrigin ||
          (String(storeOrigin || "").trim()
            ? String(storeOrigin).trim()
            : null);

        if (!matrixOrigin) {
          saveOrder(
            orderedByFallback(sourceOrders, routePlzPriority).map((order) =>
              String(order.id),
            ),
          );
          return;
        }

        const maps = await loadGoogleMaps();
        const routesLibrary = await maps.importLibrary("routes");
        const RouteMatrix = routesLibrary?.RouteMatrix;

        if (!RouteMatrix?.computeRouteMatrix) {
          throw new Error("route_matrix_unavailable");
        }

        const lockedFirst =
          activeOrder &&
          sourceOrders.some(
            (order) => String(order.id) === String(activeOrder.id),
          )
            ? activeOrder
            : null;

        const sortable = sourceOrders.filter(
          (order) => !lockedFirst || String(order.id) !== String(lockedFirst.id),
        );

        if (!sortable.length) {
          saveOrder(lockedFirst ? [String(lockedFirst.id)] : []);
          return;
        }

        const matrixOrders = sourceOrders.filter((order) =>
          Boolean(routeLocation(order)),
        );

        if (!matrixOrders.length) {
          throw new Error("route_destinations_missing");
        }

        const destinations = matrixOrders.map(routeLocation);
        const { matrix } = await RouteMatrix.computeRouteMatrix({
          origins: [
            typeof matrixOrigin === "string"
              ? matrixOrigin
              : { lat: matrixOrigin.lat, lng: matrixOrigin.lng },
          ],
          destinations,
          travelMode: "DRIVING",
          routingPreference: "TRAFFIC_AWARE",
          fields: ["distanceMeters", "durationMillis", "condition"],
        });

        const row = matrix?.rows?.[0];
        const items = Array.isArray(row?.items) ? row.items : [];

        const nextMetrics: Record<string, RouteMetric> = {};

        matrixOrders.forEach((order, index) => {
          const item = items[index];
          const distanceMeters = Number(item?.distanceMeters);
          const durationMillis = Number(item?.durationMillis);
          const exists =
            item?.condition === "ROUTE_EXISTS" ||
            (Number.isFinite(distanceMeters) && Number.isFinite(durationMillis));

          if (!exists) return;

          nextMetrics[String(order.id)] = {
            distanceMeters: Math.max(0, distanceMeters || 0),
            durationMillis: Math.max(0, durationMillis || 0),
          };
        });

        const ranked = sortable.map((order, index) => {
          const metric = nextMetrics[String(order.id)];

          return {
            order,
            distanceMeters: metric?.distanceMeters ?? Number.POSITIVE_INFINITY,
            durationMillis: metric?.durationMillis ?? Number.POSITIVE_INFINITY,
            fallbackRank: routeFallbackRank(order, routePlzPriority),
            index,
          };
        });

        ranked.sort((left, right) => {
          if (left.durationMillis !== right.durationMillis) {
            return left.durationMillis - right.durationMillis;
          }
          if (left.distanceMeters !== right.distanceMeters) {
            return left.distanceMeters - right.distanceMeters;
          }
          if (left.fallbackRank !== right.fallbackRank) {
            return left.fallbackRank - right.fallbackRank;
          }
          return left.index - right.index;
        });

        setMetrics((current) => ({ ...current, ...nextMetrics }));

        saveOrder([
          ...(lockedFirst ? [String(lockedFirst.id)] : []),
          ...ranked.map(({ order }) => String(order.id)),
        ]);
      } catch {
        const lockedFirst =
          activeOrder &&
          sourceOrders.some(
            (order) => String(order.id) === String(activeOrder.id),
          )
            ? activeOrder
            : null;
        const rest = sourceOrders.filter(
          (order) => !lockedFirst || String(order.id) !== String(lockedFirst.id),
        );
        const fallback = orderedByFallback(rest, routePlzPriority);

        saveOrder([
          ...(lockedFirst ? [String(lockedFirst.id)] : []),
          ...fallback.map((order) => String(order.id)),
        ]);
        setRouteNotice(
          "Google-Routenvergleich war kurz nicht verfügbar. PLZ-Reihenfolge wurde als Fallback verwendet.",
        );
      } finally {
        setSorting(false);
      }
    },
    [
      activeOrder,
      ensureOrigin,
      ordered,
      routePlzPriority,
      saveOrder,
      storeOrigin,
    ],
  );

  useEffect(() => {
    const serverIds = orders.map((order) => String(order.id));
    const serverSet = new Set(serverIds);
    let saved: string[] = [];

    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
      if (Array.isArray(parsed)) saved = parsed.map(String);
    } catch {}

    const next = [
      ...saved.filter((id) => serverSet.has(id)),
      ...serverIds.filter((id) => !saved.includes(id)),
    ];

    const firstActiveId = next.find((id) => {
      const order = orders.find((candidate) => String(candidate.id) === id);
      return order
        ? normalizeStatus(order.status) === "out_for_delivery"
        : false;
    });
    const normalizedNext = firstActiveId
      ? [firstActiveId, ...next.filter((id) => id !== firstActiveId)]
      : next;

    setOrderedIds(normalizedNext);

    if (!orders.length) {
      autoSortedSetRef.current = "";
      return;
    }

    const hasActive = orders.some(
      (order) => normalizeStatus(order.status) === "out_for_delivery",
    );

    if (!hasActive && autoSortedSetRef.current !== orderSetKey) {
      autoSortedSetRef.current = orderSetKey;
      window.setTimeout(() => {
        void autoSort(
          normalizedNext
            .map((id) => orders.find((order) => String(order.id) === id))
            .filter((order): order is DriverOrder => Boolean(order)),
        );
      }, 0);
    }
  }, [orderSetKey, orders, storageKey]); // autoSort intentionally omitted to avoid re-sorting after manual drag.

  useEffect(() => {
    if (livePosition) setLocalOrigin(livePosition);
  }, [livePosition?.lat, livePosition?.lng, livePosition?.ts]);

  // Before "Fahrt starten" customer tracking stays OFF, but the driver route
  // planner still follows the driver's device locally so planning starts from
  // the real position instead of the restaurant.
  useEffect(() => {
    if (startedOrders.length > 0 || !orders.length || !("geolocation" in navigator)) {
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setLocalOrigin(driverPositionFromGeolocation(position));
      },
      () => undefined,
      {
        enableHighAccuracy: true,
        maximumAge: 3_000,
        timeout: 10_000,
      },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [orders.length, startedOrders.length]);

  useEffect(() => {
    storePointRef.current = null;
  }, [storeOrigin]);

  const redrawMap = useCallback(async () => {
    if (!mapNodeRef.current || !ordered.length) return;

    try {
      const maps = await loadGoogleMaps();
      mapsRef.current = maps;

      const driverOrigin = origin || (await ensureOrigin());
      const fallbackStorePoint = driverOrigin
        ? null
        : await resolveStorePoint(maps);
      const currentOrigin = driverOrigin || fallbackStorePoint;
      const routeOrigin = driverOrigin
        ? { lat: driverOrigin.lat, lng: driverOrigin.lng }
        : String(storeOrigin || "").trim() ||
          (fallbackStorePoint
            ? { lat: fallbackStorePoint.lat, lng: fallbackStorePoint.lng }
            : null);

      const points = await Promise.all(
        ordered.map((order) => resolvePoint(order, maps)),
      );

      const validPoints = points.filter(
        (point): point is DriverPosition => Boolean(point),
      );

      if (!mapRef.current) {
        const center =
          currentOrigin ||
          validPoints[0] || {
            lat: 52.52,
            lng: 13.405,
          };

        mapRef.current = new maps.Map(mapNodeRef.current, {
          center,
          zoom: 13,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "cooperative",
          clickableIcons: false,
          styles: darkMapStyles(),
          backgroundColor: "#0b1220",
        });
      }

      if (currentOrigin) {
        const usingDriverOrigin = Boolean(driverOrigin);
        const originTitle = usingDriverOrigin ? "Fahrer" : "Burger Brothers";
        const originEmoji = usingDriverOrigin ? "🚚" : "🏪";

        if (!driverMarkerRef.current) {
          driverMarkerRef.current = new maps.Marker({
            map: mapRef.current,
            position: currentOrigin,
            title: originTitle,
            label: {
              text: originEmoji,
              fontSize: "17px",
            },
            zIndex: 50,
          });
        } else {
          driverMarkerRef.current.setPosition(currentOrigin);
          driverMarkerRef.current.setTitle(originTitle);
          driverMarkerRef.current.setLabel({
            text: originEmoji,
            fontSize: "17px",
          });
        }
      }

      const keep = new Set<string>();

      ordered.forEach((order, index) => {
        const point = points[index];
        if (!point) return;

        const id = String(order.id);
        keep.add(id);
        let marker = stopMarkersRef.current.get(id);

        if (!marker) {
          marker = new maps.Marker({
            map: mapRef.current,
            position: point,
            title: `${routeLetter(index)} · ${order.customer.name || "Kunde"}`,
            label: {
              text: routeLetter(index),
              color: "#ffffff",
              fontWeight: "800",
              fontSize: "13px",
            },
            icon: {
              path: maps.SymbolPath.CIRCLE,
              scale: 16,
              fillColor: index === 0 && activeOrder ? "#7f1d1d" : "#0f172a",
              fillOpacity: 1,
              strokeColor: index === 0 && activeOrder ? "#fb7185" : "#38bdf8",
              strokeOpacity: 1,
              strokeWeight: 3,
            },
            zIndex: 30 - index,
          });
          stopMarkersRef.current.set(id, marker);
        } else {
          marker.setPosition(point);
          marker.setLabel({
            text: routeLetter(index),
            color: "#ffffff",
            fontWeight: "800",
            fontSize: "13px",
          });
          marker.setIcon({
            path: maps.SymbolPath.CIRCLE,
            scale: 16,
            fillColor: index === 0 && activeOrder ? "#7f1d1d" : "#0f172a",
            fillOpacity: 1,
            strokeColor: index === 0 && activeOrder ? "#fb7185" : "#38bdf8",
            strokeOpacity: 1,
            strokeWeight: 3,
          });
          marker.setZIndex(30 - index);
          marker.setTitle(
            `${routeLetter(index)} · ${order.customer.name || "Kunde"}`,
          );
        }
      });

      for (const [id, marker] of stopMarkersRef.current.entries()) {
        if (keep.has(id)) continue;
        marker.setMap(null);
        stopMarkersRef.current.delete(id);
      }

      if (!routeOrigin || !validPoints.length) {
        const bounds = new maps.LatLngBounds();
        validPoints.forEach((point) => bounds.extend(point));
        if (currentOrigin) bounds.extend(currentOrigin);
        if (!bounds.isEmpty()) mapRef.current.fitBounds(bounds, 48);
        setMapError("");
        return;
      }

      const last = ordered[ordered.length - 1];
      const destinations = ordered.map((order, index) => points[index] || routeLocation(order));
      const destination = destinations[destinations.length - 1];

      if (!destination || !last) return;

      const routeCheck = lastRouteRef.current;
      const moved =
        routeCheck && currentOrigin
          ? haversineMeters(routeCheck.origin, currentOrigin)
          : Number.POSITIVE_INFINITY;
      const sameQueue = routeCheck?.queueKey === queueKey;
      const age = routeCheck ? Date.now() - routeCheck.at : Number.POSITIVE_INFINITY;

      if (
        sameQueue &&
        age < ROUTE_RECALC_MIN_MS &&
        moved < ROUTE_RECALC_MOVE_M
      ) {
        setMapError("");
        return;
      }

      const routesLibrary = await maps.importLibrary("routes");
      const Route = routesLibrary?.Route;

      if (!Route?.computeRoutes) return;

      const result = await Route.computeRoutes({
        origin: routeOrigin,
        destination,
        intermediates: destinations
          .slice(0, -1)
          .map((location) => ({ location })),
        travelMode: "DRIVING",
        routingPreference: "TRAFFIC_AWARE",
        fields: ["path", "distanceMeters", "durationMillis"],
      });

      const route = Array.isArray(result?.routes) ? result.routes[0] : null;
      const path = Array.isArray(route?.path)
        ? route.path
            .map((value: any) => ({
              lat: Number(typeof value.lat === "function" ? value.lat() : value.lat),
              lng: Number(typeof value.lng === "function" ? value.lng() : value.lng),
            }))
            .filter(
              (point: DriverPosition) =>
                Number.isFinite(point.lat) && Number.isFinite(point.lng),
            )
        : [];

      if (path.length) {
        if (!routeLineRef.current) {
          routeLineRef.current = new maps.Polyline({
            map: mapRef.current,
            path,
            geodesic: false,
            strokeColor: "#38bdf8",
            strokeOpacity: 0.9,
            strokeWeight: 6,
            clickable: false,
            zIndex: 5,
          });
        } else {
          routeLineRef.current.setPath(path);
        }

        const bounds = new maps.LatLngBounds();
        path.forEach((point: DriverPosition) => bounds.extend(point));
        mapRef.current.fitBounds(bounds, 48);
      }

      const distanceMeters = Number(route?.distanceMeters);
      const durationMillis = Number(route?.durationMillis);

      const nextSummary =
        Number.isFinite(distanceMeters) && Number.isFinite(durationMillis)
          ? {
              distanceMeters: Math.max(0, distanceMeters),
              durationMillis: Math.max(0, durationMillis),
            }
          : null;

      setRouteSummary(nextSummary);

      // For a single delivery, the full route is also the stop metric.
      if (nextSummary && ordered.length === 1) {
        setMetrics((current) => ({
          ...current,
          [String(ordered[0].id)]: nextSummary,
        }));
      }

      if (currentOrigin) {
        lastRouteRef.current = {
          at: Date.now(),
          origin: currentOrigin,
          queueKey,
        };
      } else {
        lastRouteRef.current = null;
      }
      setMapError("");
    } catch {
      setMapError("Google Maps Route konnte gerade nicht aktualisiert werden.");
    }
  }, [
    activeOrder,
    ensureOrigin,
    origin,
    ordered,
    queueKey,
    resolvePoint,
    resolveStorePoint,
    startedOrders.length,
    storeOrigin,
  ]);

  useEffect(() => {
    void redrawMap();
  }, [redrawMap]);

  useEffect(() => {
    const maps = mapsRef.current;
    const map = mapRef.current;

    if (map) {
      map.setOptions?.({
        gestureHandling: mapFullscreen ? "greedy" : "cooperative",
      });
      maps?.event?.trigger?.(map, "resize");
    }

    if (!mapFullscreen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const frame = window.requestAnimationFrame(() => {
      if (maps?.event && map) {
        maps.event.trigger(map, "resize");
      }
      lastRouteRef.current = null;
      void redrawMap();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [mapFullscreen, redrawMap]);

  const move = useCallback(
    (id: string, targetIndex: number) => {
      const current = ordered.map((order) => String(order.id));
      const fromIndex = current.indexOf(id);
      if (fromIndex < 0) return;

      const minIndex = activeOrder ? 1 : 0;
      const clamped = Math.max(
        minIndex,
        Math.min(current.length - 1, targetIndex),
      );

      if (activeOrder && fromIndex === 0) return;
      if (clamped === fromIndex) return;

      current.splice(fromIndex, 1);
      current.splice(clamped, 0, id);
      lastRouteRef.current = null;
      saveOrder(current);
    },
    [activeOrder, ordered, saveOrder],
  );

  const onDragMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!draggedId) return;

      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-route-row-id]");

      const targetId = target?.dataset.routeRowId;
      if (!targetId || targetId === draggedId) return;

      const targetIndex = ordered.findIndex(
        (order) => String(order.id) === targetId,
      );
      if (targetIndex >= 0) move(draggedId, targetIndex);
    },
    [draggedId, move, ordered],
  );

  const activeAgeMs =
    trackingState.lastPublishedAt != null
      ? Math.max(0, nowMs - trackingState.lastPublishedAt)
      : Number.POSITIVE_INFINITY;

  const gpsTone =
    startedOrders.length === 0
      ? "idle"
      : trackingState.status === "error" || activeAgeMs > 60_000
        ? "error"
        : trackingState.status === "warning" || activeAgeMs > 25_000
          ? "warning"
          : trackingState.status === "live"
            ? "live"
            : "starting";

  const gpsText =
    gpsTone === "idle"
      ? origin
        ? "Fahrerposition bereit · Kunden-Tracking aus"
        : "Fahrerposition wird ermittelt · Kunden-Tracking aus"
      : gpsTone === "live"
        ? `GPS LIVE${Number.isFinite(activeAgeMs) ? ` · vor ${Math.floor(activeAgeMs / 1000)} Sek.` : ""}`
        : gpsTone === "warning"
          ? "GPS wird aktualisiert…"
          : gpsTone === "error"
            ? trackingState.message || "GPS-Signal ist unterbrochen."
            : "GPS wird gestartet…";

  if (!orders.length) return null;

  const fullscreenStop = activeOrder || ordered[0] || null;
  const fullscreenStopIndex = fullscreenStop
    ? ordered.findIndex((order) => String(order.id) === String(fullscreenStop.id))
    : -1;
  const fullscreenMetric =
    fullscreenStop && fullscreenStopIndex >= 0
      ? metrics[String(fullscreenStop.id)]
      : null;

  return (
    <section
      className={
        mapFullscreen
          ? "fixed inset-0 z-[120] overflow-hidden bg-slate-950 text-stone-100"
          : "overflow-hidden rounded-2xl border border-white/15 bg-white/[0.055] shadow-2xl backdrop-blur-xl"
      }
    >
      <div
        className={
          mapFullscreen
            ? "pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
            : "flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-3 sm:px-4"
        }
      >
        <div
          className={
            mapFullscreen
              ? "pointer-events-auto rounded-2xl border border-white/15 bg-slate-950/88 px-3 py-2 shadow-xl backdrop-blur-xl"
              : ""
          }
        >
          <div className="text-xs font-extrabold uppercase tracking-[.16em] text-sky-200">
            Driver PRO Route
          </div>
          <div className="mt-0.5 text-sm text-stone-300">
            {ordered.length} Lieferung(en) · A = nächster Stopp
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <div
            className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
            gpsTone === "live"
              ? "border-emerald-300/35 bg-emerald-500/15 text-emerald-100"
              : gpsTone === "warning" || gpsTone === "starting"
                ? "border-amber-300/35 bg-amber-500/15 text-amber-100"
                : gpsTone === "error"
                  ? "border-rose-300/35 bg-rose-500/15 text-rose-100"
                  : "border-sky-300/30 bg-sky-500/10 text-sky-100"
          }`}
        >
            {gpsText}
          </div>

          {mapFullscreen ? (
            <button
              type="button"
              onClick={() => setMapFullscreen(false)}
              className="grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-slate-950/90 text-lg font-black text-white shadow-xl backdrop-blur"
              aria-label="Karte verkleinern"
              title="Karte verkleinern"
            >
              ✕
            </button>
          ) : null}
        </div>
      </div>

      <div
        className={
          mapFullscreen
            ? "absolute inset-0 w-full"
            : "relative min-h-[300px] w-full sm:min-h-[360px]"
        }
      >
        <div ref={mapNodeRef} className="absolute inset-0" />

        {!mapFullscreen ? (
          <button
            type="button"
            onClick={() => setMapFullscreen(true)}
            className="absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-xl border border-white/20 bg-slate-950/90 text-lg font-black text-white shadow-xl backdrop-blur"
            aria-label="Karte vergrößern"
            title="Karte vergrößern"
          >
            ⛶
          </button>
        ) : (
          <div className="absolute right-3 top-24 z-10 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                lastRouteRef.current = null;
                void ensureOrigin().then(() => redrawMap());
              }}
              className="grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-slate-950/90 text-lg text-white shadow-xl backdrop-blur"
              aria-label="Fahrerposition zentrieren"
              title="Fahrerposition zentrieren"
            >
              ◎
            </button>
            <button
              type="button"
              onClick={onChangeMapPreference}
              className="grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-slate-950/90 text-lg text-white shadow-xl backdrop-blur"
              aria-label="Karten-App ändern"
              title={`Karten-App: ${mapPreferenceLabel}`}
            >
              🗺️
            </button>
          </div>
        )}

        {mapError ? (
          <div className="absolute inset-x-3 bottom-3 rounded-xl border border-rose-300/30 bg-rose-950/90 px-3 py-2 text-xs text-rose-100 backdrop-blur">
            {mapError}
          </div>
        ) : null}

        {routeSummary && !mapFullscreen ? (
          <div className="absolute bottom-3 left-3 rounded-xl border border-white/15 bg-slate-950/90 px-3 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur">
            Gesamt: {formatDistance(routeSummary.distanceMeters)} ·{" "}
            {formatDuration(routeSummary.durationMillis)}
          </div>
        ) : null}

        {mapFullscreen && fullscreenStop ? (
          <div
            className="absolute inset-x-3 bottom-3 z-20 rounded-[1.6rem] border border-white/15 bg-slate-950/94 p-3 shadow-2xl backdrop-blur-2xl"
            style={{
              paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
            }}
          >
            <div className="mx-auto mb-2 h-1 w-12 rounded-full bg-white/25" />

            <div className="flex items-start gap-3">
              <div
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border text-base font-black ${
                  activeOrder
                    ? "border-rose-300/60 bg-rose-500/20 text-rose-100"
                    : "border-sky-300/50 bg-sky-500/15 text-sky-100"
                }`}
              >
                {routeLetter(Math.max(0, fullscreenStopIndex))}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="truncate text-base font-black text-white">
                    {fullscreenStop.customer.name || `#${fullscreenStop.id}`}
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                      activeOrder
                        ? "bg-rose-400 text-slate-950"
                        : "border border-amber-300/30 bg-amber-500/10 text-amber-100"
                    }`}
                  >
                    {activeOrder ? "AKTIVER STOPP" : "NÄCHSTER STOPP"}
                  </span>
                </div>

                <div className="mt-0.5 truncate text-sm text-stone-300">
                  {getOrderRouteAddress(fullscreenStop) || "Adresse fehlt"}
                </div>

                <div className="mt-1 text-xs font-semibold text-sky-100">
                  {fullscreenMetric
                    ? `${formatDistance(fullscreenMetric.distanceMeters)} · ${formatDuration(fullscreenMetric.durationMillis)}`
                    : routeSummary
                      ? `${formatDistance(routeSummary.distanceMeters)} · ${formatDuration(routeSummary.durationMillis)} gesamt`
                      : "Google-Fahrzeit wird berechnet"}
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onNavigate(fullscreenStop)}
                className="rounded-2xl border border-white/15 bg-white/10 px-3 py-3 text-sm font-extrabold text-white"
              >
                🧭 Navigation
              </button>

              {waitingOrders.length > 0 ? (
                <button
                  type="button"
                  disabled={busy || sorting}
                  onClick={() => void onStart(ordered)}
                  className="rounded-2xl bg-emerald-300 px-3 py-3 text-sm font-black text-slate-950 disabled:opacity-50"
                >
                  {busy
                    ? "Start…"
                    : startedOrders.length
                      ? `+ ${waitingOrders.length} starten`
                      : "🚗 Fahrt starten"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setMapFullscreen(false)}
                  className="rounded-2xl bg-sky-300 px-3 py-3 text-sm font-black text-slate-950"
                >
                  Route bearbeiten
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setMapFullscreen(false)}
              className="mt-2 w-full rounded-xl px-3 py-2 text-xs font-bold text-stone-300"
            >
              A/B/C/D Reihenfolge bearbeiten
            </button>
          </div>
        ) : null}
      </div>

      {!mapFullscreen ? (
      <div className="space-y-2 border-t border-white/10 p-3 sm:p-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={sorting || busy || ordered.length < 2}
            onClick={() => void autoSort()}
            className="rounded-xl border border-sky-300/30 bg-sky-500/10 px-3 py-2 text-xs font-bold text-sky-100 disabled:opacity-50"
          >
            {sorting ? "Google sortiert…" : "✨ Automatisch sortieren"}
          </button>

          {activeOrder ? (
            <button
              type="button"
              onClick={() => onNavigate(activeOrder)}
              className="rounded-xl bg-sky-300 px-3 py-2 text-xs font-extrabold text-slate-950"
            >
              🧭 Navigation zu A
            </button>
          ) : ordered[0] ? (
            <button
              type="button"
              onClick={() => onNavigate(ordered[0])}
              className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-bold text-white"
            >
              🧭 Route A öffnen
            </button>
          ) : null}

          <button
            type="button"
            onClick={onChangeMapPreference}
            className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-stone-200"
          >
            Karten-App: {mapPreferenceLabel}
          </button>
        </div>

        {routeNotice ? (
          <div className="rounded-xl border border-amber-300/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            {routeNotice}
          </div>
        ) : null}

        <div className="space-y-2">
          {ordered.map((order, index) => {
            const id = String(order.id);
            const metric = metrics[id];
            const isActive = Boolean(
              activeOrder && String(activeOrder.id) === id,
            );
            const isStarted =
              normalizeStatus(order.status) === "out_for_delivery";
            const locked = Boolean(activeOrder && index === 0);

            return (
              <div
                key={id}
                data-route-row-id={id}
                onPointerMove={onDragMove}
                className={`flex items-center gap-2 rounded-xl border p-2.5 ${
                  isActive
                    ? "border-rose-300/40 bg-rose-500/10"
                    : isStarted
                      ? "border-emerald-300/25 bg-emerald-500/5"
                      : "border-white/10 bg-black/15"
                }`}
              >
                <div
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border text-sm font-black ${
                    isActive
                      ? "border-rose-300/60 bg-rose-500/20 text-rose-100"
                      : "border-sky-300/50 bg-sky-500/15 text-sky-100"
                  }`}
                >
                  {routeLetter(index)}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-extrabold text-white">
                      {order.customer.name || `#${order.id}`}
                    </span>
                    {isActive ? (
                      <span className="rounded-full bg-rose-400 px-2 py-0.5 text-[10px] font-black text-slate-950">
                        AKTIV
                      </span>
                    ) : isStarted ? (
                      <span className="rounded-full border border-emerald-300/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-100">
                        UNTERWEGS
                      </span>
                    ) : (
                      <span className="rounded-full border border-amber-300/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-100">
                        ÜBERNOMMEN
                      </span>
                    )}
                  </div>

                  <div className="truncate text-xs text-stone-300">
                    {getOrderRouteAddress(order) || "Adresse fehlt"}
                  </div>

                  <div className="mt-0.5 text-[11px] text-sky-100/80">
                    {metric
                      ? `${formatDistance(metric.distanceMeters)} · ${formatDuration(metric.durationMillis)}`
                      : "Google-Fahrzeit wird berechnet"}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={locked || index <= (activeOrder ? 1 : 0)}
                    onClick={() => move(id, index - 1)}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-white/15 bg-white/5 text-sm disabled:opacity-25"
                    aria-label="Stopp nach oben"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={locked || index >= ordered.length - 1}
                    onClick={() => move(id, index + 1)}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-white/15 bg-white/5 text-sm disabled:opacity-25"
                    aria-label="Stopp nach unten"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    disabled={locked}
                    onPointerDown={(event) => {
                      if (locked) return;
                      event.currentTarget.setPointerCapture?.(event.pointerId);
                      setDraggedId(id);
                    }}
                    onPointerUp={() => setDraggedId(null)}
                    onPointerCancel={() => setDraggedId(null)}
                    className="grid h-8 w-8 touch-none place-items-center rounded-lg border border-white/15 bg-white/5 text-base disabled:opacity-25"
                    aria-label="Stopp verschieben"
                    title="Gedrückt halten und ziehen"
                  >
                    ☰
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {waitingOrders.length > 0 ? (
          <button
            type="button"
            disabled={busy || sorting}
            onClick={() => void onStart(ordered)}
            className="w-full rounded-xl bg-emerald-300 px-4 py-3 text-sm font-black text-slate-950 shadow-lg hover:bg-emerald-200 disabled:opacity-50"
          >
            {busy
              ? "Start wird gespeichert…"
              : startedOrders.length
                ? `🚗 ${waitingOrders.length} weitere Lieferung(en) starten`
                : `🚗 Fahrt starten · ${waitingOrders.length} Lieferung(en)`}
          </button>
        ) : (
          <div className="rounded-xl border border-emerald-300/20 bg-emerald-500/10 px-3 py-2 text-center text-xs font-semibold text-emerald-100">
            Alle übernommenen Lieferungen sind unterwegs.
          </div>
        )}

        <div className="text-[10px] leading-relaxed text-stone-400">
          Automatisch = Google-Fahrzeit vom aktuellen Fahrerstandort. A bleibt
          während einer laufenden Tour gesperrt; B/C/D können weiter verschoben
          werden. Vor „Fahrt starten“ wird kein Kunden-Live-Tracking aktiviert.
        </div>
      </div>
      ) : null}
    </section>
  );
}
