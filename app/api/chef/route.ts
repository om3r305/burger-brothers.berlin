import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getTenantId, prisma } from "@/lib/db";
import { ensureChefCatalog } from "@/lib/server/chef-catalog";
import { enforceRateLimit, hasTrustedMutationOrigin } from "@/lib/server/request-security";
import {
  CHEF_COOKIE,
  completeChefPlan,
  createChefSession,
  deleteChefItem,
  deleteChefPlan,
  ensureChefBootstrap,
  findChefUserByUsername,
  getChefState,
  latestChefNotification,
  placeChefOrder,
  receiveChefNeeds,
  requireChef,
  saveChefReport,
  upsertChefItem,
  upsertChefPlan,
  upsertChefPush,
  upsertChefUser,
} from "@/lib/server/chef";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const headers = { "Cache-Control": "no-store, no-cache, must-revalidate" };
const json = (payload: Record<string, unknown>, status = 200) =>
  NextResponse.json(payload, { status, headers });

// Temporary test mode. Identity, role and order permission remain
// server-authoritative; only the PIN challenge is suspended for now.
const CHEF_PIN_REQUIRED = false;

type ChefSessionUser = {
  id: string;
  username: string;
  displayName: string;
  role: "ADMIN" | "CHEF";
  canOrder: boolean;
  active: boolean;
  pinHash: string;
};

const normalizeName = (value: unknown) =>
  String(value || "")
    .trim()
    .toLocaleLowerCase("de-DE")
    .replace(/\s+/g, " ");

async function ensureChefTestAdmin(username: string) {
  if (CHEF_PIN_REQUIRED || normalizeName(username) !== "omer") return;

  const tenantId = await getTenantId();
  const key = "chef:user:bbchef-omer";
  const row = await prisma.setting.findUnique({
    where: { tenantId_key: { tenantId, key } },
    select: { value: true },
  });
  const old = row?.value && typeof row.value === "object" ? (row.value as any) : {};
  const stamp = new Date().toISOString();
  const value = {
    ...old,
    id: "bbchef-omer",
    username: "omer",
    displayName: old.displayName || "Ömer",
    role: "ADMIN",
    canOrder: true,
    active: true,
    pinHash: old.pinHash || "",
    createdAt: old.createdAt || stamp,
    updatedAt: stamp,
  };

  await prisma.setting.upsert({
    where: { tenantId_key: { tenantId, key } },
    update: { value },
    create: { tenantId, key, value },
  });
}

export async function GET(req: NextRequest) {
  await ensureChefBootstrap();
  await ensureChefCatalog();
  const user = (await requireChef(req)) as ChefSessionUser | null;
  if (!user) return json({ ok: false, error: "UNAUTHORIZED" }, 401);

  if (req.nextUrl.searchParams.get("view") === "push") {
    return json({ ok: true, notification: await latestChefNotification() });
  }

  return json({
    ok: true,
    ...(await getChefState(user)),
    pinRequired: CHEF_PIN_REQUIRED,
  });
}

export async function POST(req: NextRequest) {
  if (!hasTrustedMutationOrigin(req)) {
    return json({ ok: false, error: "ORIGIN_NOT_ALLOWED" }, 403);
  }

  const body = await req.json().catch(() => ({} as any));
  const action = String(body?.action || "").trim();

  if (action === "login") {
    const limited = await enforceRateLimit(req, "login:chef", 12, 15 * 60_000);
    if (limited) return limited;

    await ensureChefBootstrap();
    await ensureChefCatalog();
    const username = String(body?.username || "").trim();
    await ensureChefTestAdmin(username);
    const user = (await findChefUserByUsername(username)) as ChefSessionUser | null;
    if (!user?.active) return json({ ok: false, error: "INVALID_USER" }, 401);

    const res = json({
      ok: true,
      pinRequired: CHEF_PIN_REQUIRED,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        canOrder: user.canOrder,
      },
    });
    res.cookies.set(CHEF_COOKIE, createChefSession(user.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    return res;
  }

  if (action === "logout") {
    const res = json({ ok: true });
    res.cookies.set(CHEF_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    });
    return res;
  }

  const user = (await requireChef(req)) as ChefSessionUser | null;
  if (!user) return json({ ok: false, error: "UNAUTHORIZED" }, 401);

  try {
    if (action === "saveReport") {
      return json({ ok: true, ...(await saveChefReport(user, body)) });
    }
    if (action === "placeOrder") {
      return json({ ok: true, ...(await placeChefOrder(user, body?.needIds)) });
    }
    if (action === "receiveNeeds") {
      return json({ ok: true, ...(await receiveChefNeeds(user, body?.needIds)) });
    }
    if (action === "upsertItem") {
      return json({ ok: true, item: await upsertChefItem(user, body?.item || {}) });
    }
    if (action === "deleteItem") {
      return json(await deleteChefItem(user, body?.id));
    }
    if (action === "upsertUser") {
      const incoming = { ...(body?.user || {}) };
      if (!incoming.id && !String(incoming.pin || "").trim()) {
        incoming.pin = randomUUID().replace(/-/g, "").slice(0, 12);
      }
      return json({ ok: true, user: await upsertChefUser(user, incoming) });
    }
    if (action === "upsertPlan") {
      return json({ ok: true, plan: await upsertChefPlan(user, body?.plan || {}) });
    }
    if (action === "completePlan") {
      return json({ ok: true, plan: await completeChefPlan(user, body?.id) });
    }
    if (action === "deletePlan") {
      return json(await deleteChefPlan(user, body?.id));
    }
    if (action === "subscribePush") {
      await upsertChefPush(req, body?.subscription);
      return json({ ok: true });
    }
    return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SERVER_ERROR";
    const status = ["ADMIN_REQUIRED", "ORDER_PERMISSION_REQUIRED"].includes(code)
      ? 403
      : [
          "NO_ORDER_ITEMS",
          "NO_OPEN_ORDER_ITEMS",
          "MULTIPLE_SUPPLIERS",
          "ITEM_NAME_REQUIRED",
          "USER_FIELDS_REQUIRED",
          "PIN_TOO_SHORT",
          "USERNAME_EXISTS",
          "PLAN_FIELDS_REQUIRED",
          "PLAN_NOT_FOUND",
        ].includes(code)
        ? 400
        : 500;

    if (status === 500) console.error("[bb-chef]", error);
    return json({ ok: false, error: code }, status);
  }
}
