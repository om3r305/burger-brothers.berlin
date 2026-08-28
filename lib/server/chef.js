import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { prisma, getTenantId } from "@/lib/db";
import {
  getSchnellPushConfig,
  normalizeSchnellPushSubscription,
  sendEmptySchnellPush,
} from "@/lib/server/schnell-push";

export const CHEF_COOKIE = "bb_chef_sess";
export const CHEF_PUSH_SCOPE = "chef_app";

const K = {
  user: (id) => `chef:user:${id}`,
  item: (id) => `chef:item:${id}`,
  need: (id) => `chef:need:${id}`,
  report: (id) => `chef:report:${id}`,
  order: (id) => `chef:order:${id}`,
  plan: (id) => `chef:plan:${id}`,
  activity: (id) => `chef:activity:${id}`,
  notification: (id) => `chef:notification:${id}`,
};

const BOOTSTRAP_PIN_HASH =
  "b23242eb0b393991c4d8f144b4ef05b2:5da976887f8982d2911a862c8221c7a4dff5f837e7b5d85369e41381d9c51cf1";

const rawSeeds = [
  ["Burger Fleisch", "Fleisch & Protein", "QUANTITY", "Kiste", 2, null],
  ["Crispy Chicken", "Fleisch & Protein", "QUANTITY", "Karton", 2, null],
  ["Chicken Fingers", "Hähnchen & Snacks", "QUANTITY", "Karton", 2, null],
  ["Chicken Wings", "Hähnchen & Snacks", "QUANTITY", "Karton", 2, null],
  ["Burger Brot", "Brot", "QUANTITY", "Kiste", 2, null],
  ["Smash Brot", "Brot", "QUANTITY", "Kiste", 2, null],
  ["Hotdog Brot", "Brot", "QUANTITY", "Kiste", 1, null],
  ["Curly Fries", "Pommes & Beilagen", "QUANTITY", "Karton", 3, null],
  ["Fries", "Pommes & Beilagen", "QUANTITY", "Karton", 3, null],
  ["Country Potatoes", "Pommes & Beilagen", "QUANTITY", "Karton", 2, null],
  ["Halloumi", "Käse & Spezial", "STATUS", "Packung", null, null],
  ["Mozzarella", "Käse & Spezial", "STATUS", "Packung", null, null],
  ["Gorgonzola", "Käse & Spezial", "STATUS", "Packung", null, null],
  ["Cheddar", "Käse & Spezial", "STATUS", "Packung", null, null],
  ["Eisbergsalat", "Gemüse & Frische", "STATUS", "", null, null],
  ["Tomaten", "Gemüse & Frische", "STATUS", "", null, null],
  ["Zwiebeln", "Gemüse & Frische", "STATUS", "", null, null],
  ["Spinat", "Gemüse & Frische", "STATUS", "", null, null],
  ["Avocado", "Gemüse & Frische", "STATUS", "", null, null],
  ["Guacamole", "Gemüse & Frische", "STATUS", "", null, null],
  ["Jalapeños", "Gemüse & Frische", "STATUS", "", null, null],
  ["Pickles", "Gemüse & Frische", "STATUS", "", null, null],
  ["Ketchup", "Soßen", "STATUS", "Karton", null, 1],
  ["Mayonnaise", "Soßen", "STATUS", "Karton", null, 1],
  ["BB Sauce", "Soßen", "STATUS", "", null, null],
  ["Schwarze Sauce", "Soßen", "STATUS", "", null, null],
  ["Special Sauce", "Soßen", "STATUS", "", null, null],
  ["BB Burger Box", "Boxen & Verpackung", "STATUS", "", null, null],
  ["Kinder Box", "Boxen & Verpackung", "STATUS", "", null, null],
  ["Menü Box", "Boxen & Verpackung", "STATUS", "", null, null],
  ["Pommes Box", "Boxen & Verpackung", "STATUS", "", null, null],
  ["Soßenbecher", "Boxen & Verpackung", "STATUS", "", null, null],
  ["Deckel für Soßenbecher", "Boxen & Verpackung", "STATUS", "", null, null],
  ["Papiertüten", "Boxen & Verpackung", "STATUS", "", null, null],
  ["Servietten", "Verbrauch & Hygiene", "STATUS", "", null, null],
  ["Trinkhalme", "Verbrauch & Hygiene", "STATUS", "", null, null],
  ["Toilettenpapier", "Verbrauch & Hygiene", "STATUS", "", null, null],
  ["Einweghandschuhe", "Verbrauch & Hygiene", "STATUS", "", null, null],
];

const seeds = rawSeeds.map((row, index) => ({
  name: row[0],
  category: row[1],
  mode: row[2],
  unit: row[3],
  minStock: row[4],
  defaultOrderQty: row[5],
  supplierName: "",
  supplierWhatsapp: "",
  active: true,
  sortOrder: (index + 1) * 10,
}));

const now = () => new Date().toISOString();
const clean = (value, max = 180) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f]/g, " ")
    .trim()
    .slice(0, max);
const num = (value) => {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

async function list(prefix, take = 500) {
  const tenantId = await getTenantId();
  const rows = await prisma.setting.findMany({
    where: { tenantId, key: { startsWith: prefix } },
    orderBy: { updatedAt: "desc" },
    take,
    select: { value: true },
  });
  return rows.map((row) => row.value);
}

async function get(key) {
  const tenantId = await getTenantId();
  const row = await prisma.setting.findUnique({
    where: { tenantId_key: { tenantId, key } },
    select: { value: true },
  });
  return row?.value || null;
}

async function put(key, value) {
  const tenantId = await getTenantId();
  return prisma.setting.upsert({
    where: { tenantId_key: { tenantId, key } },
    update: { value },
    create: { tenantId, key, value },
  });
}

async function del(key) {
  const tenantId = await getTenantId();
  await prisma.setting.deleteMany({ where: { tenantId, key } });
}

const safeUser = (user) => {
  const { pinHash, ...safe } = user;
  return safe;
};

export function hashChefPin(pin) {
  const salt = randomBytes(16);
  const digest = scryptSync(pin, salt, 32, { N: 16384, r: 8, p: 1 });
  return `${salt.toString("hex")}:${digest.toString("hex")}`;
}

export function verifyChefPin(pin, stored) {
  try {
    const [salt, digest] = String(stored || "").split(":");
    const actual = scryptSync(pin, Buffer.from(salt, "hex"), 32, {
      N: 16384,
      r: 8,
      p: 1,
    });
    const expected = Buffer.from(digest, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function secret() {
  const value = clean(process.env.SESSION_SECRET || process.env.AUTH_SECRET, 500);
  if (value.length < 32) throw new Error("SESSION_SECRET_MISSING_OR_TOO_SHORT");
  return value;
}

export function createChefSession(sub) {
  const payload = Buffer.from(
    JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 30 * 86400, v: 1 }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `chef:${payload}.${sig}`;
}

function readSession(token) {
  try {
    const raw = String(token || "");
    if (!raw.startsWith("chef:")) return null;
    const [payload, signature, ...rest] = raw.slice(5).split(".");
    if (!payload || !signature || rest.length) return null;
    const expected = createHmac("sha256", secret()).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const value = JSON.parse(Buffer.from(payload, "base64url").toString());
    return value?.v === 1 && value?.sub && Number(value.exp) > Date.now() / 1000
      ? value
      : null;
  } catch {
    return null;
  }
}

function cookie(req, name) {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      return rest.join("=");
    }
  }
  return "";
}

export async function ensureChefBootstrap() {
  if ((await list("chef:user:", 5)).length) return;
  const stamp = now();
  await put(K.user("bbchef-omer"), {
    id: "bbchef-omer",
    username: "omer",
    displayName: "Ömer",
    role: "ADMIN",
    canOrder: true,
    active: true,
    pinHash: BOOTSTRAP_PIN_HASH,
    createdAt: stamp,
    updatedAt: stamp,
  });
  for (let index = 0; index < seeds.length; index += 1) {
    const id = `seed-${String(index + 1).padStart(3, "0")}`;
    await put(K.item(id), { ...seeds[index], id, createdAt: stamp, updatedAt: stamp });
  }
}

export async function findChefUserByUsername(username) {
  const query = clean(username, 60).toLocaleLowerCase("de-DE");
  return (
    (await list("chef:user:", 100)).find(
      (user) => String(user.username).toLocaleLowerCase("de-DE") === query,
    ) || null
  );
}

export async function requireChef(req) {
  const session = readSession(cookie(req, CHEF_COOKIE));
  if (!session?.sub) return null;
  const user = await get(K.user(clean(session.sub, 120)));
  return user?.active ? user : null;
}

async function activity(user, action, detail) {
  const entry = {
    id: randomUUID(),
    actorId: user.id,
    actorName: user.displayName,
    action,
    detail: clean(detail, 500),
    createdAt: now(),
  };
  await put(K.activity(entry.id), entry);
}

export async function getChefState(me) {
  await ensureChefBootstrap();
  const [items, needs, plans, reports, activities, users] = await Promise.all([
    list("chef:item:"),
    list("chef:need:"),
    list("chef:plan:", 250),
    list("chef:report:", 30),
    list("chef:activity:", 50),
    me.role === "ADMIN" ? list("chef:user:", 100) : Promise.resolve([]),
  ]);
  const pushConfig = getSchnellPushConfig();
  return {
    me: safeUser(me),
    items: items
      .filter((item) => item.active)
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name).localeCompare(String(b.name), "de")),
    needs: needs
      .filter((need) => need.state === "OPEN" || need.state === "ORDERED")
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    plans: plans
      .filter((plan) => plan.active)
      .sort((a, b) => String(a.scheduledDate).localeCompare(String(b.scheduledDate))),
    reports: reports
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 10),
    activity: activities
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 30),
    users: users.map(safeUser),
    push: {
      configured: pushConfig.configured,
      publicKey: pushConfig.configured ? pushConfig.publicKey : "",
    },
  };
}

export async function saveChefReport(user, input) {
  const entries = Array.isArray(input?.entries) ? input.entries.slice(0, 250) : [];
  const reportId = randomUUID();
  const createdAt = now();
  await put(K.report(reportId), {
    id: reportId,
    createdById: user.id,
    createdByName: user.displayName,
    voiceTranscript: clean(input?.voiceTranscript, 4000),
    createdAt,
    entryCount: entries.length,
  });

  const known = await list("chef:need:", 500);
  let fresh = 0;
  for (const raw of entries) {
    const itemId = clean(raw?.itemId, 120);
    const item = itemId ? await get(K.item(itemId)) : null;
    if (!item?.active) continue;

    const currentQty = num(raw.currentQty);
    let neededQty = num(raw.neededQty);
    const statusRaw = clean(raw.status, 20).toUpperCase();
    const status = ["LOW", "CRITICAL", "OUT"].includes(statusRaw) ? statusRaw : null;
    if (neededQty == null && status && item.defaultOrderQty != null) {
      neededQty = item.defaultOrderQty;
    }
    const needsOrder = (neededQty != null && neededQty > 0) || Boolean(status);

    if (needsOrder) {
      const old = known.find(
        (need) => need.itemId === itemId && need.state === "OPEN",
      );
      const next = old
        ? {
            ...old,
            reportId,
            currentQty,
            neededQty,
            status,
            note: clean(raw.note, 400),
            createdById: user.id,
            createdByName: user.displayName,
            createdAt,
          }
        : {
            id: randomUUID(),
            itemId,
            reportId,
            currentQty,
            neededQty,
            status,
            note: clean(raw.note, 400),
            state: "OPEN",
            createdById: user.id,
            createdByName: user.displayName,
            createdAt,
          };
      await put(K.need(next.id), next);
      if (old) Object.assign(old, next);
      else {
        known.push(next);
        fresh += 1;
      }
    } else if (raw.checked === true) {
      for (const old of known.filter(
        (need) => need.itemId === itemId && need.state === "OPEN",
      )) {
        const next = { ...old, state: "RESOLVED" };
        await put(K.need(old.id), next);
        Object.assign(old, next);
      }
    }
  }

  await activity(
    user,
    "REPORT_SAVED",
    `${entries.length} Artikel geprüft${fresh ? `, ${fresh} neue offene Positionen` : ""}`,
  );
  await createChefNotification({
    title: "BB Chef · Bestandskontrolle",
    body: `${user.displayName} hat die Bestandskontrolle gespeichert. ${entries.length} Artikel wurden aktualisiert.`,
    url: "/chef",
  });
  return { reportId };
}

function orderMessage(needs, items) {
  const map = new Map(items.map((item) => [item.id, item]));
  const lines = needs
    .map((need) => {
      const item = map.get(need.itemId);
      if (!item) return "";
      const quantity =
        need.neededQty != null
          ? `${need.neededQty}${item.unit ? ` ${item.unit}` : ""}`
          : item.defaultOrderQty != null
            ? `${item.defaultOrderQty}${item.unit ? ` ${item.unit}` : ""}`
            : "bestellen";
      return `• ${item.name}: ${quantity}`;
    })
    .filter(Boolean)
    .join("\n");
  return `Hallo, wir benötigen bitte:\n\n${lines}\n\nVielen Dank!`;
}

export async function placeChefOrder(user, idsInput) {
  if (!user.canOrder && user.role !== "ADMIN") {
    throw new Error("ORDER_PERMISSION_REQUIRED");
  }
  const ids = Array.isArray(idsInput)
    ? idsInput.map((value) => clean(value, 120)).filter(Boolean).slice(0, 100)
    : [];
  if (!ids.length) throw new Error("NO_ORDER_ITEMS");

  const [allNeeds, items] = await Promise.all([
    list("chef:need:", 500),
    list("chef:item:", 500),
  ]);
  const selected = allNeeds.filter(
    (need) => ids.includes(need.id) && need.state === "OPEN",
  );
  if (!selected.length) throw new Error("NO_OPEN_ORDER_ITEMS");

  const map = new Map(items.map((item) => [item.id, item]));
  const supplierNames = new Set(
    selected.map((need) => map.get(need.itemId)?.supplierName || "").filter(Boolean),
  );
  if (supplierNames.size > 1) throw new Error("MULTIPLE_SUPPLIERS");

  const supplierName = String([...supplierNames][0] || "Lieferant");
  const supplierWhatsapp =
    selected.map((need) => map.get(need.itemId)?.supplierWhatsapp || "").find(Boolean) || "";
  const message = orderMessage(selected, items);
  const orderedAt = now();

  for (const need of selected) {
    await put(K.need(need.id), {
      ...need,
      state: "ORDERED",
      orderedById: user.id,
      orderedByName: user.displayName,
      orderedAt,
    });
  }

  const id = randomUUID();
  await put(K.order(id), {
    id,
    supplierName,
    supplierWhatsapp,
    needIds: selected.map((need) => need.id),
    message,
    orderedById: user.id,
    orderedByName: user.displayName,
    orderedAt,
  });
  await activity(user, "ORDER_PLACED", `${supplierName}: ${selected.length} Positionen bestellt`);
  await createChefNotification({
    title: "BB Chef · Bestellung erfasst",
    body: `${user.displayName} hat ${selected.length} Positionen für ${supplierName} als bestellt markiert.`,
    url: "/chef",
  });

  const digits = String(supplierWhatsapp).replace(/\D/g, "");
  return {
    orderId: id,
    message,
    whatsappUrl: `https://wa.me/${digits}?text=${encodeURIComponent(message)}`,
  };
}

export async function receiveChefNeeds(user, idsInput) {
  const ids = Array.isArray(idsInput)
    ? idsInput.map((value) => clean(value, 120))
    : [];
  const needs = await list("chef:need:", 500);
  const receivedAt = now();
  let count = 0;
  for (const need of needs.filter(
    (row) => ids.includes(row.id) && row.state === "ORDERED",
  )) {
    await put(K.need(need.id), {
      ...need,
      state: "RECEIVED",
      receivedById: user.id,
      receivedByName: user.displayName,
      receivedAt,
    });
    count += 1;
  }
  if (count) await activity(user, "ORDER_RECEIVED", `${count} Positionen eingegangen`);
  return { count };
}

export async function upsertChefItem(user, input) {
  if (user.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
  const id = clean(input?.id, 120) || randomUUID();
  const old = await get(K.item(id));
  const stamp = now();
  const name = clean(input?.name, 120);
  if (!name) throw new Error("ITEM_NAME_REQUIRED");

  const item = {
    ...(old || {}),
    id,
    name,
    category: clean(input.category, 100) || "Sonstiges",
    mode: clean(input.mode, 20).toUpperCase() === "STATUS" ? "STATUS" : "QUANTITY",
    unit: clean(input.unit, 40),
    minStock: num(input.minStock),
    defaultOrderQty: num(input.defaultOrderQty),
    supplierName: clean(input.supplierName, 120),
    supplierWhatsapp: clean(input.supplierWhatsapp, 50),
    voiceAliases: Array.isArray(input.voiceAliases)
      ? input.voiceAliases.map((value) => clean(value, 120)).filter(Boolean).slice(0, 30)
      : Array.isArray(old?.voiceAliases)
        ? old.voiceAliases
        : [],
    source: clean(input.source, 40) || old?.source || "",
    active: input.active !== false,
    sortOrder: Number.isFinite(Number(input.sortOrder))
      ? Number(input.sortOrder)
      : old?.sortOrder || Date.now(),
    createdAt: old?.createdAt || stamp,
    updatedAt: stamp,
  };

  await put(K.item(id), item);
  await activity(user, old ? "ITEM_UPDATED" : "ITEM_CREATED", item.name);
  return item;
}

export async function deleteChefItem(user, idInput) {
  if (user.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
  const id = clean(idInput, 120);
  const old = await get(K.item(id));
  if (old) {
    await put(K.item(id), { ...old, active: false, updatedAt: now() });
    await activity(user, "ITEM_DISABLED", old.name);
  }
  return { ok: true };
}

export async function upsertChefUser(actor, input) {
  if (actor.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");
  const id = clean(input?.id, 120) || randomUUID();
  const old = await get(K.user(id));
  const username = clean(input.username, 60).toLocaleLowerCase("de-DE");
  const displayName = clean(input.displayName, 100);
  const pin = clean(input.pin, 40);
  if (!username || !displayName) throw new Error("USER_FIELDS_REQUIRED");
  if (
    (await list("chef:user:", 100)).some(
      (user) =>
        user.id !== id &&
        String(user.username).toLocaleLowerCase("de-DE") === username,
    )
  ) {
    throw new Error("USERNAME_EXISTS");
  }
  if (!old && pin.length < 4) throw new Error("PIN_TOO_SHORT");

  const stamp = now();
  const user = {
    id,
    username,
    displayName,
    role: clean(input.role, 20).toUpperCase() === "ADMIN" ? "ADMIN" : "CHEF",
    canOrder: input.canOrder === true,
    active: input.active !== false,
    pinHash: pin ? hashChefPin(pin) : old?.pinHash || "",
    createdAt: old?.createdAt || stamp,
    updatedAt: stamp,
  };
  await put(K.user(id), user);
  await activity(actor, old ? "USER_UPDATED" : "USER_CREATED", displayName);
  return safeUser(user);
}

export async function upsertChefPlan(user, input) {
  const id = clean(input?.id, 120) || randomUUID();
  const old = await get(K.plan(id));
  const stamp = now();
  const title = clean(input.title, 140);
  const scheduledDate = clean(input.scheduledDate, 20);
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
    throw new Error("PLAN_FIELDS_REQUIRED");
  }
  const plan = {
    id,
    title,
    note: clean(input.note, 500),
    scheduledDate,
    remindDayBefore: input.remindDayBefore !== false,
    remindSameDay: input.remindSameDay !== false,
    recurrence:
      clean(input.recurrence, 20).toUpperCase() === "WEEKLY" ? "WEEKLY" : "NONE",
    active: input.active !== false,
    createdById: old?.createdById || user.id,
    createdByName: old?.createdByName || user.displayName,
    createdAt: old?.createdAt || stamp,
    updatedAt: stamp,
    lastReminderKey: old?.lastReminderKey || "",
  };
  await put(K.plan(id), plan);
  await activity(user, old ? "PLAN_UPDATED" : "PLAN_CREATED", `${title} · ${scheduledDate}`);
  return plan;
}

function nextWeek(date) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 7);
  return value.toISOString().slice(0, 10);
}

export async function completeChefPlan(user, idInput) {
  const id = clean(idInput, 120);
  const plan = await get(K.plan(id));
  if (!plan) throw new Error("PLAN_NOT_FOUND");
  const stamp = now();
  const next =
    plan.recurrence === "WEEKLY"
      ? {
          ...plan,
          scheduledDate: nextWeek(plan.scheduledDate),
          completedAt: stamp,
          completedByName: user.displayName,
          updatedAt: stamp,
          lastReminderKey: "",
        }
      : {
          ...plan,
          active: false,
          completedAt: stamp,
          completedByName: user.displayName,
          updatedAt: stamp,
        };
  await put(K.plan(id), next);
  await activity(user, "PLAN_COMPLETED", plan.title);
  return next;
}

export async function deleteChefPlan(user, idInput) {
  const id = clean(idInput, 120);
  const plan = await get(K.plan(id));
  if (plan) {
    await del(K.plan(id));
    await activity(user, "PLAN_DELETED", plan.title);
  }
  return { ok: true };
}

function berlin(date = new Date()) {
  const format = (value) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(value);
  return {
    today: format(date),
    tomorrow: format(new Date(date.getTime() + 86400000)),
  };
}

export async function runChefReminders() {
  const plans = await list("chef:plan:", 250);
  const { today, tomorrow } = berlin();
  let sent = 0;

  for (const plan of plans.filter((value) => value.active)) {
    const kind =
      plan.remindSameDay && plan.scheduledDate === today
        ? "today"
        : plan.remindDayBefore && plan.scheduledDate === tomorrow
          ? "tomorrow"
          : "";
    if (!kind) continue;
    const key = `${plan.scheduledDate}:${kind}`;
    if (plan.lastReminderKey === key) continue;

    await createChefNotification({
      title:
        kind === "today"
          ? "BB Chef · Heutige Vorbereitung"
          : "BB Chef · Morgen vorbereiten",
      body:
        kind === "today"
          ? `${plan.title} soll heute vorbereitet werden.`
          : `${plan.title} soll morgen vorbereitet werden.`,
      url: "/chef",
    });
    await put(K.plan(plan.id), { ...plan, lastReminderKey: key, updatedAt: now() });
    sent += 1;
  }

  return { checked: plans.length, sent };
}

export async function createChefNotification(input) {
  const notification = {
    id: randomUUID(),
    title: clean(input.title, 140),
    body: clean(input.body, 500),
    url: clean(input.url || "/chef", 200) || "/chef",
    createdAt: now(),
  };
  await put(K.notification(notification.id), notification);
  await wakeChefPushSubscribers();
  return notification;
}

export async function latestChefNotification() {
  const notifications = await list("chef:notification:", 20);
  return (
    notifications.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] ||
    null
  );
}

export async function upsertChefPush(req, value) {
  const subscription = normalizeSchnellPushSubscription(value);
  const config = getSchnellPushConfig();
  if (!config.configured) throw new Error("PUSH_NOT_CONFIGURED");
  if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys.auth) {
    throw new Error("INVALID_SUBSCRIPTION");
  }

  const tenantId = await getTenantId();
  const old = await prisma.pushSubscription.findFirst({
    where: { tenantId, endpoint: subscription.endpoint },
  });
  if (old && old.appScope !== CHEF_PUSH_SCOPE) {
    throw new Error("SUBSCRIPTION_SCOPE_CONFLICT");
  }

  const userAgent = clean(req.headers.get("user-agent"), 500);
  const data = {
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    expirationTime: subscription.expirationTime
      ? new Date(subscription.expirationTime)
      : null,
    deviceTokenHash: createHash("sha256").update(subscription.endpoint).digest("hex"),
    platform: /iphone|ipad|ipod/i.test(userAgent)
      ? "ios"
      : /android/i.test(userAgent)
        ? "android"
        : /windows/i.test(userAgent)
          ? "windows"
          : /mac/i.test(userAgent)
            ? "macos"
            : "web",
    userAgent,
    locale: clean(req.headers.get("accept-language")?.split(",")[0] || "de", 24) || "de",
    appScope: CHEF_PUSH_SCOPE,
    active: true,
    lastSeenAt: new Date(),
    failureCount: 0,
  };

  return old
    ? prisma.pushSubscription.update({ where: { id: old.id }, data })
    : prisma.pushSubscription.create({ data: { tenantId, ...data } });
}

export async function wakeChefPushSubscribers() {
  const tenantId = await getTenantId();
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { tenantId, appScope: CHEF_PUSH_SCOPE, active: true },
    take: 20,
  });

  const results = await Promise.all(
    subscriptions.map(async (row) => {
      const result = await sendEmptySchnellPush({
        endpoint: row.endpoint,
        expirationTime: row.expirationTime
          ? new Date(row.expirationTime).getTime()
          : null,
        keys: { p256dh: row.p256dh, auth: row.auth },
      }).catch(() => ({ ok: false, expired: false }));
      const stamp = new Date();
      await prisma.pushSubscription
        .update({
          where: { id: row.id },
          data: result.ok
            ? { lastPushAt: stamp, lastSuccessAt: stamp, failureCount: 0 }
            : {
                active: result.expired ? false : true,
                lastPushAt: stamp,
                lastFailureAt: stamp,
                failureCount: { increment: 1 },
              },
        })
        .catch(() => undefined);
      return result.ok;
    }),
  );

  return {
    recipients: subscriptions.length,
    ok: results.filter(Boolean).length,
  };
}
