import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;

function toCloudinaryProbeUrl(input: URL) {
  const marker = "/image/upload/";
  const markerIndex = input.pathname.indexOf(marker);

  if (markerIndex === -1) return input;

  const prefix = input.pathname.slice(0, markerIndex + marker.length);
  const suffix = input.pathname.slice(markerIndex + marker.length);
  const probe = new URL(input.href);
  probe.pathname = `${prefix}c_limit,w_360,f_png,q_auto:eco/${suffix}`;
  return probe;
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url");

  if (!rawUrl) {
    return NextResponse.json({ error: "url gerekli" }, { status: 400 });
  }

  let sourceUrl: URL;

  try {
    sourceUrl = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "Geçersiz url" }, { status: 400 });
  }

  if (sourceUrl.protocol !== "https:" || sourceUrl.hostname !== "res.cloudinary.com") {
    return NextResponse.json({ error: "İzin verilmeyen görsel adresi" }, { status: 403 });
  }

  const probeUrl = toCloudinaryProbeUrl(sourceUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(probeUrl, {
      cache: "force-cache",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "image/png,image/webp,image/*;q=0.8",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Görsel alınamadı" },
        { status: response.status >= 400 && response.status < 500 ? response.status : 502 },
      );
    }

    const finalUrl = new URL(response.url);
    if (finalUrl.protocol !== "https:" || finalUrl.hostname !== "res.cloudinary.com") {
      return NextResponse.json({ error: "Güvensiz yönlendirme" }, { status: 502 });
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "Geçersiz içerik türü" }, { status: 415 });
    }

    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Görsel çok büyük" }, { status: 413 });
    }

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Görsel çok büyük" }, { status: 413 });
    }

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return NextResponse.json(
      { error: aborted ? "Görsel isteği zaman aşımına uğradı" : "Görsel alınamadı" },
      { status: aborted ? 504 : 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
