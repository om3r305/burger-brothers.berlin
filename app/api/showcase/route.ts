import { NextResponse } from "next/server";
import {
  buildShowcaseSnapshot,
  defaultShowcaseSnapshot,
  readPublishedShowcaseVersion,
} from "@/lib/showcase/server";
import type { ShowcaseSnapshot } from "@/lib/showcase/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const lastSuccessfulSnapshots = new Map<string, ShowcaseSnapshot>();

const HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const screen = url.searchParams.get("screen") || "main";
  const knownVersion = url.searchParams.get("knownVersion") || "";
  try {
    if (knownVersion) {
      const current = await readPublishedShowcaseVersion(screen);
      if (current.version && current.version === knownVersion) {
        return NextResponse.json(
          { ok: true, unchanged: true, version: current.version, generatedAt: new Date().toISOString() },
          { headers: HEADERS },
        );
      }
    }
    const snapshot = await buildShowcaseSnapshot(req, screen);
    lastSuccessfulSnapshots.set(screen, snapshot);
    return NextResponse.json(snapshot, { headers: HEADERS });
  } catch (error: any) {
    console.error("[showcase:GET]", error);

    const lastSuccessfulSnapshot = lastSuccessfulSnapshots.get(screen);
    if (lastSuccessfulSnapshot) {
      return NextResponse.json(
        {
          ...lastSuccessfulSnapshot,
          source: "memory_fallback",
          generatedAt: new Date().toISOString(),
          dbError: error?.message || "SHOWCASE_GET_FAILED",
        },
        { headers: HEADERS },
      );
    }

    return NextResponse.json(
      {
        ...defaultShowcaseSnapshot(req),
        dbError: error?.message || "SHOWCASE_GET_FAILED",
      },
      { headers: HEADERS },
    );
  }
}
