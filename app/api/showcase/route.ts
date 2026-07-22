import { NextResponse } from "next/server";
import {
  buildShowcaseSnapshot,
  defaultShowcaseSnapshot,
} from "@/lib/showcase/server";
import type { ShowcaseSnapshot } from "@/lib/showcase/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

let lastSuccessfulSnapshot: ShowcaseSnapshot | null = null;

const HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
};

export async function GET(req: Request) {
  try {
    const snapshot = await buildShowcaseSnapshot(req);
    lastSuccessfulSnapshot = snapshot;
    return NextResponse.json(snapshot, { headers: HEADERS });
  } catch (error: any) {
    console.error("[showcase:GET]", error);

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
