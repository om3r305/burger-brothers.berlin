import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import { enforceRateLimit, securityJson } from "@/lib/server/request-security";
import {
  extractTrackingToken,
  matchesTrackingToken,
} from "@/lib/server/public-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function plainObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function finiteCoordinate(value: unknown, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max
    ? number
    : null;
}

function normalizeStatus(value: unknown) {
  const text = String(value || "").toLowerCase().trim();
  if (text === "on_the_way" || text === "unterwegs") return "out_for_delivery";
  if (text === "delivered" || text === "completed" || text === "geliefert") return "done";
  if (text === "canceled" || text === "storniert") return "cancelled";
  return text;
}

function parseDurationSeconds(value: unknown) {
  const text = String(value || "").trim();
  const match = text.match(/^([0-9]+(?:\.[0-9]+)?)s$/);
  return match ? Math.max(0, Math.round(Number(match[1]))) : 0;
}

async function findOrderByTrackingToken(tenantId: string, token: string) {
  let order: any = null;

  try {
    order = await prisma.order.findFirst({
      where: {
        tenantId,
        meta: {
          path: ["trackingToken"],
          equals: token,
        } as any,
      },
      select: {
        id: true,
        mode: true,
        status: true,
        meta: true,
      },
    });
  } catch {
    // JSONB fallback below supports older Prisma/runtime combinations.
  }

  if (!order) {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT "id", "mode", "status", "meta"
      FROM "Order"
      WHERE "tenantId" = ${tenantId}
        AND (
          "meta" ->> 'trackingToken' = ${token}
          OR "meta" ->> 'publicTrackingToken' = ${token}
        )
      ORDER BY "ts" DESC
      LIMIT 2;
    `;

    order =
      rows.find((candidate: any) => matchesTrackingToken(candidate, token)) ||
      null;
  }

  return order && matchesTrackingToken(order, token) ? order : null;
}

export async function POST(req: Request) {
  const rateError = await enforceRateLimit(req, "tracking:route", 12, 60_000);
  if (rateError) return rateError;

  const token = extractTrackingToken(req);
  if (!token) {
    return securityJson({ ok: false, error: "missing_tracking_token" }, 401);
  }

  const apiKey = String(process.env.GOOGLE_MAPS_SERVER_API_KEY || "").trim();
  if (!apiKey) {
    return json({ ok: false, error: "maps_not_configured" }, 503);
  }

  const body = await req.json().catch(() => ({}));
  const origin = plainObject(plainObject(body).origin);
  const originLat = finiteCoordinate(origin.lat, -90, 90);
  const originLng = finiteCoordinate(origin.lng, -180, 180);

  if (originLat == null || originLng == null) {
    return json({ ok: false, error: "invalid_origin" }, 400);
  }

  try {
    const tenantId = await getTenantId();
    const order = await findOrderByTrackingToken(tenantId, token);

    if (!order) {
      return securityJson({ ok: false, error: "invalid_tracking_token" }, 401);
    }

    const status = normalizeStatus(
      plainObject(order.meta).statusManual ?? order.status,
    );

    if (String(order.mode || "delivery").toLowerCase() !== "delivery") {
      return json({ ok: false, error: "route_not_available_for_pickup" }, 409);
    }

    if (status !== "out_for_delivery") {
      return json({ ok: false, error: "route_not_active" }, 409);
    }

    const meta = plainObject(order.meta);
    const deliveryGeo = plainObject(meta.deliveryGeo ?? meta.delivery_geo);
    const destinationLat = finiteCoordinate(
      deliveryGeo.lat ?? deliveryGeo.latitude,
      -90,
      90,
    );
    const destinationLng = finiteCoordinate(
      deliveryGeo.lng ?? deliveryGeo.lon ?? deliveryGeo.longitude,
      -180,
      180,
    );

    if (destinationLat == null || destinationLng == null) {
      return json({ ok: false, error: "destination_unavailable" }, 409);
    }

    const trackingSession = await prisma.trackingSession.findFirst({
      where: {
        tenantId,
        active: true,
        orderIds: { has: order.id },
      },
      orderBy: { updatedAt: "desc" },
      select: { orderIds: true },
    });

    const activeOrderCount = Math.max(
      1,
      Array.isArray(trackingSession?.orderIds)
        ? trackingSession.orderIds.filter(Boolean).length
        : 1,
    );

    const response = await fetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
        },
        body: JSON.stringify({
          origin: {
            location: {
              latLng: {
                latitude: originLat,
                longitude: originLng,
              },
            },
          },
          destination: {
            location: {
              latLng: {
                latitude: destinationLat,
                longitude: destinationLng,
              },
            },
          },
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE",
          computeAlternativeRoutes: false,
          polylineQuality: "OVERVIEW",
          polylineEncoding: "ENCODED_POLYLINE",
        }),
      },
    );

    const raw = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("[tracking/route] Google Routes failed", response.status);
      return json(
        {
          ok: false,
          error: "google_routes_failed",
        },
        response.status === 429 ? 429 : 502,
      );
    }

    const route = Array.isArray(raw?.routes) ? raw.routes[0] : null;
    const encodedPolyline = String(route?.polyline?.encodedPolyline || "");
    const distanceMeters = Number(route?.distanceMeters);
    const durationSeconds = parseDurationSeconds(route?.duration);

    if (!encodedPolyline || !Number.isFinite(distanceMeters)) {
      return json({ ok: false, error: "route_unavailable" }, 502);
    }

    return json({
      ok: true,
      distanceMeters: Math.max(0, Math.round(distanceMeters)),
      durationSeconds,
      encodedPolyline,
      destination: {
        lat: destinationLat,
        lng: destinationLng,
      },
      generatedAt: Date.now(),
      trafficAware: true,
      activeOrderCount,
      etaReliable: activeOrderCount <= 1,
    });
  } catch (error) {
    console.error("[tracking/route]", error);
    return json({ ok: false, error: "route_unavailable" }, 500);
  }
}
