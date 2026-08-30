import { getTenantId, prisma } from "@/lib/db";

type PlainObject = Record<string, any>;

export type ShopStatus = {
  closed: boolean;
  message: string;
  maintenanceStart: string;
  maintenanceEnd: string;
};

const WHOLE_SETTINGS_KEYS = new Set([
  "app:settings",
  "bb_settings_v6",
  "settings",
]);

function isPlainObject(value: any): value is PlainObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function mergeObjects(base: PlainObject, override: PlainObject) {
  return { ...base, ...override };
}

function normalizeStatus(value: any): ShopStatus {
  const site = isPlainObject(value) ? value : {};

  return {
    closed: site.closed === true,
    message: String(site.message || "").trim().slice(0, 800),
    maintenanceStart: String(site.maintenanceStart || "").trim().slice(0, 80),
    maintenanceEnd: String(site.maintenanceEnd || "").trim().slice(0, 80),
  };
}

export async function getShopStatusFresh(
  tenantIdInput?: string,
): Promise<ShopStatus> {
  const tenantId = tenantIdInput || (await getTenantId());
  const rows = await prisma.setting.findMany({
    where: {
      tenantId,
      key: {
        in: ["site", ...WHOLE_SETTINGS_KEYS],
      },
    },
    orderBy: {
      key: "asc",
    },
    select: {
      key: true,
      value: true,
    },
  });

  let legacySite: PlainObject = {};
  let wholeSite: PlainObject = {};

  for (const row of rows) {
    if (row.key === "site") {
      if (isPlainObject(row.value)) {
        legacySite = mergeObjects(legacySite, row.value);
      }
      continue;
    }

    if (!WHOLE_SETTINGS_KEYS.has(row.key) || !isPlainObject(row.value)) {
      continue;
    }

    const site = row.value.site;
    if (isPlainObject(site)) {
      wholeSite = mergeObjects(wholeSite, site);
    }
  }

  // Canonical whole-settings rows win over old standalone `site` rows, matching
  // the rest of the settings stack. The read is intentionally uncached so the
  // emergency stop propagates across devices immediately.
  return normalizeStatus(mergeObjects(legacySite, wholeSite));
}
