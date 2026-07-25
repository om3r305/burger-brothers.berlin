import { NextResponse } from "next/server";
import {
  createSessionToken,
  distanceMeters,
  getSchnellSettings,
  SCHNELL_COOKIE,
  verifyAccessToken,
} from "@/lib/server/schnellbestellung";
import {
  enforceRateLimit,
  forbiddenResponse,
  hasTrustedMutationOrigin,
} from "@/lib/server/request-security";

export async function POST(req: Request) {
  if (!hasTrustedMutationOrigin(req)) {
    return forbiddenResponse("origin_not_allowed");
  }

  const rate = await enforceRateLimit(req, "schnell:location", 30, 10 * 60 * 1000);
  if (rate) return rate;

  const body = await req.json().catch(() => ({}));
  const settings = await getSchnellSettings();

  if (!settings.enabled || settings.paused) {
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  }

  if (!verifyAccessToken(String(body.token || ""), settings)) {
    return NextResponse.json({ ok: false, error: "invalid_qr" }, { status: 401 });
  }

  const deviceId = String(body.deviceId || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);

  if (!deviceId) {
    return NextResponse.json({ ok: false, error: "device_missing" }, { status: 400 });
  }

  if (!settings.locationCheckEnabled) {
    const sessionToken = createSessionToken(settings, {
      deviceId,
      locationVerified: false,
    });
    const response = NextResponse.json({
      ok: true,
      locationSkipped: true,
      expiresIn: settings.sessionMinutes * 60,
    });

    response.cookies.set(SCHNELL_COOKIE, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: settings.sessionMinutes * 60,
    });

    return response;
  }

  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const accuracy = Number(body.accuracy);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(accuracy)) {
    return NextResponse.json(
      { ok: false, error: "location_required" },
      { status: 428 },
    );
  }

  const distance = distanceMeters(lat, lng, settings.shopLat, settings.shopLng);

  if (accuracy > settings.maxAccuracyMeters) {
    return NextResponse.json(
      {
        ok: false,
        error: "accuracy_too_low",
        accuracy,
        maxAccuracy: settings.maxAccuracyMeters,
      },
      { status: 422 },
    );
  }

  if (distance > settings.radiusMeters) {
    return NextResponse.json(
      {
        ok: false,
        error: "outside_radius",
        distance,
        radius: settings.radiusMeters,
      },
      { status: 403 },
    );
  }

  const sessionToken = createSessionToken(settings, {
    lat,
    lng,
    accuracy,
    deviceId,
    locationVerified: true,
  });
  const response = NextResponse.json({
    ok: true,
    distance,
    expiresIn: settings.sessionMinutes * 60,
  });

  response.cookies.set(SCHNELL_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: settings.sessionMinutes * 60,
  });

  return response;
}
