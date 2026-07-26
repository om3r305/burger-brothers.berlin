import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";
import {
  queueGeneralNotification,
  sendGeneralNotificationEvent,
} from "@/lib/server/general-push";

type JsonObject = Record<string, any>;

type AutomaticSource = {
  sourceKey: string;
  kind: "campaign" | "offer" | "announcement";
  active: boolean;
  allowCreate: boolean;
  title: string;
  body: string;
  url: string;
  imageUrl?: string | null;
  scheduledAt?: Date | null;
  endsAt?: Date | null;
  metadata?: JsonObject;
};

type ResolvedProductTarget = {
  id: string;
  sku: string;
  category: string;
};

const WHOLE_SETTINGS_KEYS = new Set(["settings", "bb_settings_v6", "app:settings"]);

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function cleanText(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function bool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "ja", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "nein", "off"].includes(normalized)) return false;
  return fallback;
}

function dateValue(value: unknown) {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value as any);
  return Number.isFinite(date.valueOf()) ? date : null;
}

function safeUrl(value: unknown, fallback = "/menu") {
  const raw = cleanText(value, 500);
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : fallback;
}

function safeImage(value: unknown) {
  const raw = cleanText(value, 1000);
  if (!raw) return null;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function hashSource(source: AutomaticSource) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: source.kind,
        title: source.title,
        body: source.body,
        url: source.url,
        imageUrl: source.imageUrl || null,
        scheduledAt: source.scheduledAt?.toISOString() || null,
        endsAt: source.endsAt?.toISOString() || null,
        metadata: source.metadata || {},
      }),
    )
    .digest("hex");
}

function deepMerge(base: any, override: any): any {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override === undefined ? base : override;
  }
  if (!base || typeof base !== "object" || !override || typeof override !== "object") {
    return override === undefined ? base : override;
  }
  const next: JsonObject = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) continue;
    next[key] = deepMerge(next[key], value);
  }
  return next;
}

export async function readTenantSettingsForNotifications(tenantId?: string) {
  const resolvedTenantId = tenantId || (await getTenantId());
  const rows = await prisma.setting.findMany({
    where: { tenantId: resolvedTenantId },
    orderBy: { key: "asc" },
  });

  let split: JsonObject = {};
  let whole: JsonObject = {};
  for (const row of rows) {
    if (WHOLE_SETTINGS_KEYS.has(row.key)) {
      whole = deepMerge(whole, object(row.value));
    } else if (!row.key.startsWith("kv:")) {
      split[row.key] = row.value;
    }
  }
  return deepMerge(split, whole);
}

async function upsertAutomaticSource(tenantId: string, source: AutomaticSource) {
  const sourceKey = cleanText(source.sourceKey, 220);
  if (!sourceKey) return { created: false, cancelled: false, dispatched: false };

  const existing = await (prisma as any).notificationCampaign.findFirst({
    where: { tenantId, sourceKey },
  });
  const now = new Date();
  const ended = Boolean(source.endsAt && source.endsAt <= now);
  const active = source.active && !ended;

  if (!active) {
    if (existing && ["scheduled", "pending", "failed"].includes(existing.status)) {
      await (prisma as any).notificationCampaign.update({
        where: { id: existing.id },
        data: { status: "cancelled" },
      });
      return { created: false, cancelled: true, dispatched: false };
    }
    return { created: false, cancelled: false, dispatched: false };
  }

  // Daha önce gönderilmiş bir otomatik kaynak yalnızca metin değişti diye yeniden gönderilmez.
  if (existing?.sentAt || existing?.status === "sent") {
    return { created: false, cancelled: false, dispatched: false };
  }

  if (!existing && !source.allowCreate) {
    return { created: false, cancelled: false, dispatched: false };
  }

  const scheduledAt = source.scheduledAt && source.scheduledAt > now
    ? source.scheduledAt
    : now;
  const status = scheduledAt > now ? "scheduled" : "pending";
  const sourceHash = hashSource(source);
  const data = {
    kind: source.kind,
    sourceHash,
    title: cleanText(source.title, 160),
    body: cleanText(source.body, 600),
    url: safeUrl(source.url),
    imageUrl: safeImage(source.imageUrl),
    audience: json({ preference: "campaigns" }),
    metadata: json({
      ...(source.metadata || {}),
      sourceKey,
      endsAt: source.endsAt?.toISOString() || null,
      preferenceField: "campaigns",
    }),
    status,
    scheduledAt,
    createdBy: "automatic",
  };

  if (existing) {
    await (prisma as any).notificationCampaign.update({
      where: { id: existing.id },
      data,
    });
    return { created: false, cancelled: false, dispatched: false };
  }

  await (prisma as any).notificationCampaign.create({
    data: {
      tenantId,
      sourceKey,
      ...data,
    },
  });
  return { created: true, cancelled: false, dispatched: false };
}

function normalizedCategory(value: unknown) {
  return cleanText(value, 80).toLowerCase().replace(/[^a-z0-9äöüß_-]/gi, "");
}

function categoryPath(value: unknown) {
  const category = normalizedCategory(value);
  const paths: Record<string, string> = {
    extras: "/extras",
    extra: "/extras",
    snacks: "/extras",
    drinks: "/drinks",
    getraenke: "/drinks",
    getränke: "/drinks",
    sauces: "/sauces",
    sossen: "/sauces",
    soßen: "/sauces",
    sos: "/sauces",
    hotdogs: "/hotdogs",
    hotdog: "/hotdogs",
    donuts: "/donuts",
    donut: "/donuts",
    bubbletea: "/bubble-tea",
    "bubble-tea": "/bubble-tea",
  };
  return paths[category] || "/menu";
}

function offerUrl(category: unknown, productKey?: string | null) {
  const path = categoryPath(category);
  if (productKey) return `${path}?product=${encodeURIComponent(productKey)}`;
  const normalized = normalizedCategory(category);
  if (path !== "/menu") return path;
  return normalized ? `/menu?cat=${encodeURIComponent(normalized)}` : "/menu";
}

function rawCampaignProduct(row: any) {
  const payload = object(row?.payload ?? row);
  const productIds = Array.isArray(payload.productIds)
    ? payload.productIds.map((item: unknown) => cleanText(item, 100)).filter(Boolean)
    : [];
  return productIds[0] || cleanText(payload.targetProductId, 100) || null;
}

async function resolveCampaignProduct(tenantId: string, row: any) {
  const reference = rawCampaignProduct(row);
  if (!reference) return null;
  return (prisma as any).product.findFirst({
    where: {
      tenantId,
      OR: [{ id: reference }, { sku: reference }],
    },
    select: { id: true, sku: true, category: true },
  }) as Promise<ResolvedProductTarget | null>;
}

function campaignActive(value: any) {
  const payload = object(value?.payload ?? value);
  return bool(payload.enabled ?? payload.active ?? value?.enabled ?? value?.active, false);
}

function campaignSource(
  row: any,
  allowCreate: boolean,
  resolvedProduct?: ResolvedProductTarget | null,
): AutomaticSource {
  const payload = object(row?.payload ?? row);
  const scope = cleanText(payload.scope, 30).toLowerCase();
  const productIds = Array.isArray(payload.productIds)
    ? payload.productIds.map((item: unknown) => cleanText(item, 100)).filter(Boolean)
    : [];
  const categories = Array.isArray(payload.categories)
    ? payload.categories.map((item: unknown) => cleanText(item, 80)).filter(Boolean)
    : [];
  const targetProductId = productIds[0] || cleanText(payload.targetProductId, 100);
  const targetProduct = cleanText(resolvedProduct?.sku || targetProductId, 100);
  const targetCategory =
    categories[0] ||
    cleanText(payload.targetCategory, 80) ||
    cleanText(resolvedProduct?.category, 80);
  const kind: AutomaticSource["kind"] = scope === "product" || scope === "category"
    ? "offer"
    : "campaign";
  const name = cleanText(payload.name || payload.title || row?.title, 140) || "Neue Aktion";
  const badge = cleanText(payload.badge || row?.badgeText, 120);
  const amount = Number(payload.value ?? payload.percent ?? payload.amount);
  const discount = Number.isFinite(amount) && amount > 0
    ? payload.kind === "percent" || payload.type === "percentOffCategory" || payload.type === "percentOffProduct"
      ? `${amount}% Rabatt`
      : `${amount.toFixed(2).replace(".", ",")} € Vorteil`
    : "Jetzt entdecken";
  const url = offerUrl(targetCategory, targetProduct || null);

  return {
    sourceKey: `catalog-campaign:${cleanText(row?.id || row?.code, 120)}`,
    kind,
    active: campaignActive(row),
    allowCreate,
    title: badge || (kind === "offer" ? `🔥 ${name}` : `📣 ${name}`),
    body: `${name}: ${discount}. Jetzt bei Burger Brothers bestellen.`,
    url,
    imageUrl: safeImage(payload.imageUrl || payload.image),
    scheduledAt: dateValue(row?.startsAt || payload.startAt || payload.startsAt),
    endsAt: dateValue(row?.endsAt || payload.endAt || payload.endsAt),
    metadata: {
      sourceType: "catalog_campaign",
      sourceId: row?.id || null,
      scope: scope || null,
      targetProductId: targetProductId || null,
      targetProductSku: targetProduct || null,
      targetCategory: targetCategory || null,
    },
  };
}

export async function reconcileCatalogCampaignNotifications(
  tenantId: string,
  beforeRows: any[],
  afterRows: any[],
) {
  const beforeById = new Map<string, any>();
  for (const row of beforeRows || []) {
    const key = cleanText(row?.id || row?.code, 120);
    if (key) beforeById.set(key, row);
  }

  const seen = new Set<string>();
  for (const row of afterRows || []) {
    const key = cleanText(row?.id || row?.code, 120);
    if (!key) continue;
    seen.add(key);
    const previous = beforeById.get(key);
    const allowCreate = !previous
      ? campaignActive(row)
      : !campaignActive(previous) && campaignActive(row);
    const resolvedProduct = await resolveCampaignProduct(tenantId, row);
    await upsertAutomaticSource(
      tenantId,
      campaignSource(row, allowCreate, resolvedProduct),
    );
  }

  for (const [key] of beforeById) {
    if (seen.has(key)) continue;
    await upsertAutomaticSource(tenantId, {
      ...campaignSource(beforeById.get(key), false),
      active: false,
    });
  }

  return processDueAutomaticNotifications(tenantId);
}

function settingsSourceMaps(settings: any) {
  const root = object(settings);
  const announcements = object(root.announcements);
  const announcementItems = Array.isArray(announcements.items) ? announcements.items : [];
  const announcementMap = new Map<string, any>();
  announcementItems.forEach((item: any, index: number) => {
    const id = cleanText(item?.id, 120) || `legacy-${index + 1}`;
    announcementMap.set(id, {
      ...item,
      __active: bool(announcements.enabled, false) && item?.enabled !== false,
    });
  });

  const cartOffers = Array.isArray(root.cartOffers) ? root.cartOffers : [];
  const offerMap = new Map<string, any>();
  cartOffers.forEach((item: any, index: number) => {
    const id = cleanText(item?.id, 120) || `legacy-${index + 1}`;
    offerMap.set(id, { ...item, __active: item?.enabled !== false });
  });
  return { announcementMap, offerMap };
}

function announcementSource(id: string, item: any, allowCreate: boolean): AutomaticSource {
  const title = cleanText(item?.title, 160) || "Neu bei Burger Brothers";
  const body = cleanText(item?.text || item?.body, 600) || "Es gibt Neuigkeiten bei Burger Brothers.";
  return {
    sourceKey: `announcement:${id}`,
    kind: "announcement",
    active: item?.__active === true,
    allowCreate,
    title: `📣 ${title}`,
    body,
    url: safeUrl(item?.ctaHref, "/menu"),
    imageUrl: safeImage(item?.imageUrl),
    scheduledAt: dateValue(item?.startsAt),
    endsAt: dateValue(item?.endsAt),
    metadata: { sourceType: "announcement", sourceId: id },
  };
}

function cartOfferSource(id: string, item: any, allowCreate: boolean): AutomaticSource {
  const name = cleanText(item?.name || item?.title, 160) || "Neues Angebot";
  const percent = Number(item?.percent ?? item?.value);
  const body = Number.isFinite(percent) && percent > 0
    ? `${name}: ${percent}% Rabatt. Nur für kurze Zeit.`
    : `${name} ist jetzt aktiv. Jetzt ansehen und bestellen.`;
  return {
    sourceKey: `cart-offer:${id}`,
    kind: "offer",
    active: item?.__active === true,
    allowCreate,
    title: `🔥 ${name}`,
    body,
    url: "/menu",
    scheduledAt: dateValue(item?.startAt || item?.startsAt),
    endsAt: dateValue(item?.endAt || item?.endsAt),
    metadata: { sourceType: "cart_offer", sourceId: id },
  };
}

export async function reconcileSettingsAutomaticNotifications(
  tenantId: string,
  previousSettings: any,
  nextSettings: any,
) {
  const previous = settingsSourceMaps(previousSettings);
  const next = settingsSourceMaps(nextSettings);

  for (const [id, item] of next.announcementMap) {
    const old = previous.announcementMap.get(id);
    const allowCreate = !old ? item.__active === true : old.__active !== true && item.__active === true;
    await upsertAutomaticSource(tenantId, announcementSource(id, item, allowCreate));
  }
  for (const [id, item] of previous.announcementMap) {
    if (!next.announcementMap.has(id)) {
      await upsertAutomaticSource(tenantId, { ...announcementSource(id, item, false), active: false });
    }
  }

  for (const [id, item] of next.offerMap) {
    const old = previous.offerMap.get(id);
    const allowCreate = !old ? item.__active === true : old.__active !== true && item.__active === true;
    await upsertAutomaticSource(tenantId, cartOfferSource(id, item, allowCreate));
  }
  for (const [id, item] of previous.offerMap) {
    if (!next.offerMap.has(id)) {
      await upsertAutomaticSource(tenantId, { ...cartOfferSource(id, item, false), active: false });
    }
  }

  return processDueAutomaticNotifications(tenantId);
}

export async function processDueAutomaticNotifications(tenantIdInput?: string) {
  const tenantId = tenantIdInput || (await getTenantId());
  const now = new Date();
  const staleSendingBefore = new Date(now.getTime() - 15 * 60_000);
  const due = await (prisma as any).notificationCampaign.findMany({
    where: {
      tenantId,
      sourceKey: { not: null },
      sentAt: null,
      scheduledAt: { lte: now },
      OR: [
        { status: { in: ["pending", "scheduled", "failed"] } },
        // Bir serverless çalışması yarıda kesilirse kampanya sonsuza kadar
        // "sending" durumunda kalmasın. Tekil event anahtarları ikinci push'u önler.
        { status: "sending", updatedAt: { lte: staleSendingBefore } },
      ],
    },
    orderBy: { scheduledAt: "asc" },
    take: 20,
  });

  let processed = 0;
  for (const campaign of due) {
    const metadata = object(campaign.metadata);
    const endsAt = dateValue(metadata.endsAt);
    if (endsAt && endsAt <= now) {
      await (prisma as any).notificationCampaign.update({
        where: { id: campaign.id },
        data: { status: "cancelled" },
      });
      continue;
    }

    const claimed = await (prisma as any).notificationCampaign.updateMany({
      where: {
        id: campaign.id,
        sentAt: null,
        OR: [
          { status: { in: ["pending", "scheduled", "failed"] } },
          { status: "sending", updatedAt: { lte: staleSendingBefore } },
        ],
      },
      data: { status: "sending" },
    });
    if (!claimed.count) continue;

    try {
      const subscriptions = await (prisma as any).pushSubscription.findMany({
        where: {
          tenantId,
          active: true,
          preference: {
            is: {
              campaigns: true,
              marketingConsentedAt: { not: null },
            },
          },
        },
        take: 1000,
      });

      const eventIds = new Set<string>();
      for (const subscription of subscriptions) {
        const event = await queueGeneralNotification({
          subscriptionId: subscription.id,
          campaignId: campaign.id,
          type: campaign.kind === "offer" ? "offer" : campaign.kind,
          title: campaign.title,
          body: campaign.body,
          url: campaign.url || "/menu",
          imageUrl: campaign.imageUrl,
          dedupeKey: `automatic:${campaign.id}:${subscription.id}`,
          payload: {
            campaignId: campaign.id,
            kind: campaign.kind,
            sourceKey: campaign.sourceKey,
          },
        });
        // Crash recovery'de daha önce kuyruğa alınmış ama henüz gönderilmemiş
        // event'i tekrar kullan. sent/fetched event'leri yeniden gönderme.
        if (event?.id && ["queued", "failed"].includes(String(event.status))) {
          eventIds.add(event.id);
        }
      }

      let successCount = 0;
      let failureCount = 0;
      const ids = Array.from(eventIds);
      for (let index = 0; index < ids.length; index += 10) {
        const results = await Promise.all(
          ids.slice(index, index + 10).map((id) =>
            sendGeneralNotificationEvent(id).catch(() => ({ ok: false })),
          ),
        );
        successCount += results.filter((result: any) => result.ok).length;
        failureCount += results.filter((result: any) => !result.ok).length;
      }

      // Kampanya kaynağı bir kez tüketilir. Geçici push hataları event kuyruğunda
      // kalır ve Service Worker tarafından alınabilir; kampanyayı tekrar çalıştırıp
      // başarılı cihazlara ikinci bildirim gönderilmez.
      await (prisma as any).notificationCampaign.update({
        where: { id: campaign.id },
        data: {
          status: "sent",
          sentAt: new Date(),
          recipientCount: subscriptions.length,
          successCount,
          failureCount,
        },
      });
      processed += 1;
    } catch (error) {
      await (prisma as any).notificationCampaign
        .update({
          where: { id: campaign.id },
          data: { status: "failed" },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  return { processed };
}
