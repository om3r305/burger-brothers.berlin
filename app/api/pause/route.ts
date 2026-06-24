// app/api/pause/route.ts
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type PauseState = {
  delivery: boolean;
  pickup: boolean;
};

const KEY = "pause";

const headers = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

function normalizePause(input: any): PauseState {
  const raw =
    input?.pause && typeof input.pause === "object"
      ? input.pause
      : input?.state && typeof input.state === "object"
        ? input.state
        : input?.value && typeof input.value === "object"
          ? input.value
          : input || {};

  return {
    delivery: !!raw.delivery,
    pickup: !!raw.pickup,
  };
}

async function readPause(): Promise<PauseState> {
  const tenantId = await getTenantId();

  const row = await prisma.setting.findUnique({
    where: {
      tenantId_key: {
        tenantId,
        key: KEY,
      },
    },
  });

  return normalizePause(row?.value);
}

async function writePause(next: PauseState): Promise<PauseState> {
  const tenantId = await getTenantId();
  const value = normalizePause(next);

  await prisma.setting.upsert({
    where: {
      tenantId_key: {
        tenantId,
        key: KEY,
      },
    },
    update: {
      value: value as unknown as Prisma.InputJsonValue,
    },
    create: {
      tenantId,
      key: KEY,
      value: value as unknown as Prisma.InputJsonValue,
    },
  });

  return value;
}

export async function GET() {
  try {
    const pause = await readPause();

    return NextResponse.json(
      {
        ok: true,
        source: "db",
        pause,
        state: pause,
        value: pause,
      },
      { headers },
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        source: "db",
        error: e?.message || "PAUSE_GET_FAILED",
      },
      { status: 500, headers },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const pause = await writePause(normalizePause(body));

    return NextResponse.json(
      {
        ok: true,
        source: "db",
        pause,
        state: pause,
        value: pause,
      },
      { headers },
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        source: "db",
        error: e?.message || "PAUSE_POST_FAILED",
      },
      { status: 500, headers },
    );
  }
}