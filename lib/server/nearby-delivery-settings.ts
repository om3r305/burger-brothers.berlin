import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";
import { getServerSettings } from "@/lib/server/settings";

export type NearbyStreetGroup = {
  id: string;
  name: string;
  plz: string[];
  streets: string[];
  source?: "notification" | "route_deal";
};

export type NearbyDeliverySettings = {
  enabled: boolean;
  sameStreet: boolean;
  streetGroupsEnabled: boolean;
  streetGroups: NearbyStreetGroup[];
  samePlz: boolean;
  routeCluster: boolean;
  radiusEnabled: boolean;
  radiusM: number;
  minimumPastOrders: number;
  maxRecipients: number;
  cooldownHours: number;
  opportunityMinutes: number;
};

export const DEFAULT_NEARBY_DELIVERY_SETTINGS: NearbyDeliverySettings = {
  enabled: false,
  sameStreet: true,
  streetGroupsEnabled: false,
  streetGroups: [],
  samePlz: false,
  routeCluster: true,
  radiusEnabled: false,
  radiusM: 800,
  minimumPastOrders: 1,
  maxRecipients: 20,
  cooldownHours: 168,
  opportunityMinutes: 10,
};

function object(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function integer(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(min, Math.min(max, Math.round(number)))
    : fallback;
}

function cleanText(value: unknown, max = 180) {
  return String(value ?? "").trim().slice(0, max);
}

function textList(value: unknown, maxItems = 200) {
  const rows = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,;]/g)
      : [];
  return Array.from(new Set(rows.map((row) => cleanText(row)).filter(Boolean))).slice(0, maxItems);
}

function streetList(value: unknown) {
  return textList(value, 200);
}

function plzList(value: unknown) {
  return Array.from(
    new Set(
      textList(value, 50)
        .map((row) => row.replace(/\D/g, "").slice(0, 5))
        .filter((row) => row.length === 5),
    ),
  );
}

export function normalizeNearbyDeliverySettings(value: unknown): NearbyDeliverySettings {
  const raw = object(value);
  const groups = Array.isArray(raw.streetGroups) ? raw.streetGroups : [];
  return {
    enabled: bool(raw.enabled, DEFAULT_NEARBY_DELIVERY_SETTINGS.enabled),
    sameStreet: bool(raw.sameStreet, DEFAULT_NEARBY_DELIVERY_SETTINGS.sameStreet),
    streetGroupsEnabled: bool(
      raw.streetGroupsEnabled,
      DEFAULT_NEARBY_DELIVERY_SETTINGS.streetGroupsEnabled,
    ),
    streetGroups: groups
      .map<NearbyStreetGroup>((group: any, index: number): NearbyStreetGroup => ({
        id: cleanText(group?.id, 100) || `group-${index + 1}`,
        name: cleanText(group?.name, 120) || `Straßengruppe ${index + 1}`,
        plz: plzList(group?.plz ?? group?.postalCodes),
        streets: streetList(group?.streets),
        source: group?.source === "route_deal" ? "route_deal" : "notification",
      }))
      .filter((group) => group.streets.length > 0 || group.plz.length > 0)
      .slice(0, 50),
    samePlz: bool(raw.samePlz, DEFAULT_NEARBY_DELIVERY_SETTINGS.samePlz),
    routeCluster: bool(raw.routeCluster, DEFAULT_NEARBY_DELIVERY_SETTINGS.routeCluster),
    radiusEnabled: bool(raw.radiusEnabled, DEFAULT_NEARBY_DELIVERY_SETTINGS.radiusEnabled),
    radiusM: integer(raw.radiusM, DEFAULT_NEARBY_DELIVERY_SETTINGS.radiusM, 200, 5_000),
    minimumPastOrders: integer(
      raw.minimumPastOrders,
      DEFAULT_NEARBY_DELIVERY_SETTINGS.minimumPastOrders,
      0,
      100,
    ),
    maxRecipients: integer(
      raw.maxRecipients,
      DEFAULT_NEARBY_DELIVERY_SETTINGS.maxRecipients,
      1,
      200,
    ),
    cooldownHours: integer(
      raw.cooldownHours,
      DEFAULT_NEARBY_DELIVERY_SETTINGS.cooldownHours,
      1,
      24 * 90,
    ),
    opportunityMinutes: integer(
      raw.opportunityMinutes,
      DEFAULT_NEARBY_DELIVERY_SETTINGS.opportunityMinutes,
      1,
      60,
    ),
  };
}

function extractFromWholeSettings(value: unknown) {
  const root = object(value);
  return object(object(root.notifications).nearbyDelivery);
}

export async function readAdminRouteStreetGroups(): Promise<NearbyStreetGroup[]> {
  const settings = await getServerSettings();
  const rules = Array.isArray(settings.routeDeals?.rules) ? settings.routeDeals.rules : [];

  return rules
    .filter((rule) => rule?.enabled !== false)
    .map((rule, index) => ({
      id: cleanText(rule?.id, 100) || `route-deal-${index + 1}`,
      name: cleanText(rule?.name, 120) || `Rota grubu ${index + 1}`,
      plz: plzList(rule?.plz),
      streets: streetList(rule?.streets),
      source: "route_deal" as const,
    }))
    .filter((group) => group.streets.length > 0 || group.plz.length > 0)
    .slice(0, 100);
}

export async function readNearbyDeliverySettings(tenantIdInput?: string) {
  const tenantId = tenantIdInput || (await getTenantId());
  const rows = await prisma.setting.findMany({
    where: {
      tenantId,
      key: { in: ["notificationAutomation", "bb_settings_v6", "settings", "app:settings"] },
    },
  });

  let wholeSettingsValue: Record<string, any> = {};
  let automationValue: Record<string, any> = {};
  for (const row of rows) {
    if (row.key === "notificationAutomation") {
      automationValue = {
        ...automationValue,
        ...object(object(row.value).nearbyDelivery),
      };
    } else {
      wholeSettingsValue = {
        ...wholeSettingsValue,
        ...extractFromWholeSettings(row.value),
      };
    }
  }
  // Bildirim Merkezi'ndeki özel kayıt her zaman genel ayar snapshot'ından üstündür.
  return normalizeNearbyDeliverySettings({
    ...wholeSettingsValue,
    ...automationValue,
  });
}

export async function saveNearbyDeliverySettings(
  value: unknown,
  tenantIdInput?: string,
) {
  const tenantId = tenantIdInput || (await getTenantId());
  const nearbyDelivery = normalizeNearbyDeliverySettings(value);
  const payload = { nearbyDelivery } as Prisma.InputJsonValue;

  await prisma.setting.upsert({
    where: {
      tenantId_key: {
        tenantId,
        key: "notificationAutomation",
      },
    },
    update: { value: payload },
    create: {
      tenantId,
      key: "notificationAutomation",
      value: payload,
    },
  });
  return nearbyDelivery;
}
