import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getTenantId, prisma } from "@/lib/db";
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

// Temporary test mode requested for BB Chef. Identity and role are still
// server-authoritative; only the PIN challenge is suspended for now.
const CHEF_PIN_REQUIRED = false;
const CATALOG_VERSION = 2;
const CATALOG_VERSION_KEY = "chef:catalog:version";

type ChefSessionUser = {
  id: string;
  username: string;
  displayName: string;
  role: "ADMIN" | "CHEF";
  canOrder: boolean;
  active: boolean;
  pinHash: string;
};

type CatalogSpec = {
  id: string;
  name: string;
  aliases?: string[];
  category: string;
  mode: "QUANTITY" | "STATUS";
  unit: string;
  minStock: number | null;
  defaultOrderQty: number | null;
  sortOrder: number;
};

const CATALOG_V2: CatalogSpec[] = [
  { id: "protein-black-angus", name: "Black Angus", category: "Fleisch & Protein", mode: "QUANTITY", unit: "Kiste", minStock: 1, defaultOrderQty: null, sortOrder: 10 },
  { id: "protein-burger-fleisch", name: "Burger Fleisch", aliases: ["Normal Fleisch"], category: "Fleisch & Protein", mode: "QUANTITY", unit: "Kiste", minStock: 2, defaultOrderQty: null, sortOrder: 20 },
  { id: "protein-fit-burger", name: "Fit Burger Fleisch", aliases: ["Fitburger Fleisch", "Fit Burger"], category: "Fleisch & Protein", mode: "QUANTITY", unit: "Kiste", minStock: 1, defaultOrderQty: null, sortOrder: 30 },
  { id: "protein-beyond-meat", name: "Beyond Meat", aliases: ["Beyond", "Vegan Fleisch"], category: "Fleisch & Protein", mode: "QUANTITY", unit: "Karton", minStock: 1, defaultOrderQty: null, sortOrder: 40 },

  { id: "chicken-crispy", name: "Crispy Chicken", category: "Chicken & Snacks", mode: "QUANTITY", unit: "Karton", minStock: 2, defaultOrderQty: null, sortOrder: 110 },
  { id: "chicken-finger", name: "Chicken Finger", category: "Chicken & Snacks", mode: "QUANTITY", unit: "Karton", minStock: 2, defaultOrderQty: null, sortOrder: 120 },
  { id: "chicken-mini", name: "Mini Chicken", aliases: ["Mini Chicken Bites"], category: "Chicken & Snacks", mode: "QUANTITY", unit: "Karton", minStock: 1, defaultOrderQty: null, sortOrder: 130 },
  { id: "chicken-wings", name: "Chicken Wings", category: "Chicken & Snacks", mode: "QUANTITY", unit: "Karton", minStock: 2, defaultOrderQty: null, sortOrder: 140 },
  { id: "snack-mozzarella-sticks", name: "Mozzarella Sticks", aliases: ["Mozzarella Stick"], category: "Chicken & Snacks", mode: "QUANTITY", unit: "Karton", minStock: 1, defaultOrderQty: null, sortOrder: 150 },
  { id: "snack-halloumi", name: "Halloumi", category: "Chicken & Snacks", mode: "STATUS", unit: "Packung", minStock: null, defaultOrderQty: null, sortOrder: 160 },

  { id: "fries-curly", name: "Curly Fries", category: "Fries & Beilagen", mode: "QUANTITY", unit: "Karton", minStock: 3, defaultOrderQty: null, sortOrder: 210 },
  { id: "fries-straight-cut", name: "Straight Cut Fries", aliases: ["Straight Fries", "Düz Cut Fries"], category: "Fries & Beilagen", mode: "QUANTITY", unit: "Karton", minStock: 2, defaultOrderQty: null, sortOrder: 220 },
  { id: "fries-country", name: "Country Potatoes", category: "Fries & Beilagen", mode: "QUANTITY", unit: "Karton", minStock: 2, defaultOrderQty: null, sortOrder: 230 },
  { id: "fries-pommes", name: "Pommes", aliases: ["Normal Fries"], category: "Fries & Beilagen", mode: "QUANTITY", unit: "Karton", minStock: 3, defaultOrderQty: null, sortOrder: 240 },

  { id: "brot-burger", name: "Burger Brot", aliases: ["Normal Brot", "Normal Ekmek"], category: "Brot", mode: "QUANTITY", unit: "Kiste", minStock: 2, defaultOrderQty: null, sortOrder: 310 },
  { id: "brot-smash", name: "Smash Brot", category: "Brot", mode: "QUANTITY", unit: "Kiste", minStock: 2, defaultOrderQty: null, sortOrder: 320 },
  { id: "brot-kinder", name: "Kinder Brot", category: "Brot", mode: "QUANTITY", unit: "Kiste", minStock: 1, defaultOrderQty: null, sortOrder: 330 },
  { id: "brot-hotdog", name: "Hotdog Brot", aliases: ["Hot Dog Brot"], category: "Brot", mode: "QUANTITY", unit: "Kiste", minStock: 1, defaultOrderQty: null, sortOrder: 340 },

  { id: "kaese-mozzarella", name: "Mozzarella", category: "Käse & Special", mode: "STATUS", unit: "Packung", minStock: null, defaultOrderQty: null, sortOrder: 410 },
  { id: "kaese-gorgonzola", name: "Gorgonzola", category: "Käse & Special", mode: "STATUS", unit: "Packung", minStock: null, defaultOrderQty: null, sortOrder: 420 },
  { id: "kaese-cheddar", name: "Cheddar", category: "Käse & Special", mode: "STATUS", unit: "Packung", minStock: null, defaultOrderQty: null, sortOrder: 430 },

  { id: "gemuese-iceberg", name: "Iceberg Salat", category: "Gemüse & Frische", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 510 },
  { id: "gemuese-tomaten", name: "Tomaten", category: "Gemüse & Frische", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 520 },
  { id: "gemuese-zwiebeln", name: "Zwiebeln", category: "Gemüse & Frische", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 530 },
  { id: "gemuese-spinat", name: "Spinat", category: "Gemüse & Frische", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 540 },
  { id: "gemuese-avocado", name: "Avocado", category: "Gemüse & Frische", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 550 },
  { id: "gemuese-guacamole", name: "Guacamole", category: "Gemüse & Frische", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 560 },
  { id: "gemuese-jalapenos", name: "Jalapeños", category: "Gemüse & Frische", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 570 },
  { id: "gemuese-pickles", name: "Pickles", category: "Gemüse & Frische", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 580 },

  { id: "sauce-ketchup", name: "Ketchup", category: "Saucen", mode: "STATUS", unit: "Karton", minStock: null, defaultOrderQty: 1, sortOrder: 610 },
  { id: "sauce-mayo", name: "Mayonnaise", category: "Saucen", mode: "STATUS", unit: "Karton", minStock: null, defaultOrderQty: 1, sortOrder: 620 },
  { id: "sauce-bb", name: "BB Sauce", category: "Saucen", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 630 },
  { id: "sauce-schwarz", name: "Schwarze Sauce", category: "Saucen", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 640 },
  { id: "sauce-special", name: "Special Sauce", category: "Saucen", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 650 },

  { id: "box-burger", name: "BB Burger Box", category: "Boxen & Verpackung", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 710 },
  { id: "box-kinder", name: "Kinder Box", category: "Boxen & Verpackung", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 720 },
  { id: "box-menu", name: "Menü Box", category: "Boxen & Verpackung", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 730 },
  { id: "box-pommes", name: "Pommes Box", category: "Boxen & Verpackung", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 740 },
  { id: "box-sauce-cup", name: "Sauce Becher", category: "Boxen & Verpackung", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 750 },
  { id: "box-sauce-lid", name: "Sauce Becher Deckel", category: "Boxen & Verpackung", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 760 },
  { id: "box-bags", name: "Papiertüten", category: "Boxen & Verpackung", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 770 },

  { id: "verbrauch-servietten", name: "Servietten", category: "Verbrauch & Hygiene", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 810 },
  { id: "verbrauch-trinkhalme", name: "Trinkhalme", category: "Verbrauch & Hygiene", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 820 },
  { id: "verbrauch-toilettenpapier", name: "Toilettenpapier", category: "Verbrauch & Hygiene", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 830 },
  { id: "verbrauch-handschuhe", name: "Einweghandschuhe", category: "Verbrauch & Hygiene", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 840 },
];

const normalizeName = (value: unknown) =>
  String(value || "")
    .trim()
    .toLocaleLowerCase("de-DE")
    .replace(/\s+/g, " ");

async function ensureChefCatalogV2() {
  const tenantId = await getTenantId();
  const versionRow = await prisma.setting.findUnique({
    where: { tenantId_key: { tenantId, key: CATALOG_VERSION_KEY } },
    select: { value: true },
  });
  if (Number(versionRow?.value || 0) >= CATALOG_VERSION) return;

  const rows = await prisma.setting.findMany({
    where: { tenantId, key: { startsWith: "chef:item:" } },
    select: { key: true, value: true },
  });
  const working = rows.map((row) => ({ key: row.key, value: row.value as any }));
  const stamp = new Date().toISOString();

  for (const spec of CATALOG_V2) {
    const accepted = new Set([spec.name, ...(spec.aliases || [])].map(normalizeName));
    const existing = working.find((row) => accepted.has(normalizeName(row.value?.name)));
    const old = existing?.value && typeof existing.value === "object" ? existing.value : {};
    const id = String(old.id || spec.id);
    const key = existing?.key || `chef:item:${id}`;
    const next = {
      ...old,
      id,
      name: spec.name,
      category: spec.category,
      mode: spec.mode,
      unit: old.unit || spec.unit,
      minStock: old.minStock ?? spec.minStock,
      defaultOrderQty: old.defaultOrderQty ?? spec.defaultOrderQty,
      supplierName: old.supplierName || "",
      supplierWhatsapp: old.supplierWhatsapp || "",
      active: old.active !== false,
      sortOrder: spec.sortOrder,
      createdAt: old.createdAt || stamp,
      updatedAt: stamp,
    };

    await prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key } },
      update: { value: next },
      create: { tenantId, key, value: next },
    });

    if (!existing) working.push({ key, value: next });
    else existing.value = next;
  }

  await prisma.setting.upsert({
    where: { tenantId_key: { tenantId, key: CATALOG_VERSION_KEY } },
    update: { value: CATALOG_VERSION },
    create: { tenantId, key: CATALOG_VERSION_KEY, value: CATALOG_VERSION },
  });
}

export async function GET(req: NextRequest) {
  await ensureChefBootstrap();
  await ensureChefCatalogV2();
  const user = (await requireChef(req)) as ChefSessionUser | null;
  if (!user) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  if (req.nextUrl.searchParams.get("view") === "push")
    return json({ ok: true, notification: await latestChefNotification() });
  return json({ ok: true, ...(await getChefState(user)), pinRequired: CHEF_PIN_REQUIRED });
}

export async function POST(req: NextRequest) {
  if (!hasTrustedMutationOrigin(req))
    return json({ ok: false, error: "ORIGIN_NOT_ALLOWED" }, 403);

  const body = await req.json().catch(() => ({} as any));
  const action = String(body?.action || "").trim();

  if (action === "login") {
    const limited = await enforceRateLimit(req, "login:chef", 12, 15 * 60_000);
    if (limited) return limited;

    await ensureChefBootstrap();
    await ensureChefCatalogV2();
    const username = String(body?.username || "").trim();
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
    if (action === "saveReport") return json({ ok: true, ...(await saveChefReport(user, body)) });
    if (action === "placeOrder") return json({ ok: true, ...(await placeChefOrder(user, body?.needIds)) });
    if (action === "receiveNeeds") return json({ ok: true, ...(await receiveChefNeeds(user, body?.needIds)) });
    if (action === "upsertItem") return json({ ok: true, item: await upsertChefItem(user, body?.item || {}) });
    if (action === "deleteItem") return json(await deleteChefItem(user, body?.id));
    if (action === "upsertUser") {
      const incoming = { ...(body?.user || {}) };
      if (!incoming.id && !String(incoming.pin || "").trim()) incoming.pin = randomUUID().replace(/-/g, "").slice(0, 12);
      return json({ ok: true, user: await upsertChefUser(user, incoming) });
    }
    if (action === "upsertPlan") return json({ ok: true, plan: await upsertChefPlan(user, body?.plan || {}) });
    if (action === "completePlan") return json({ ok: true, plan: await completeChefPlan(user, body?.id) });
    if (action === "deletePlan") return json(await deleteChefPlan(user, body?.id));
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
