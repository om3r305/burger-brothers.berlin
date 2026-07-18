type PlainObject = Record<string, any>;

const ACTIVE_UNASSIGNED_STATUSES = new Set(["new", "preparing", "ready"]);

function object(value: any): PlainObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function text(value: any) {
  return String(value ?? "").trim();
}

function safeDriver(value: any) {
  const raw = object(value);
  const id = text(raw.id ?? raw.driverId ?? raw.deviceId);
  const name = text(raw.name ?? raw.driverName ?? raw.title);

  if (!id && !name) return null;

  return {
    id: id || name,
    name: name || id,
    ...(text(raw.deviceId) ? { deviceId: text(raw.deviceId) } : {}),
    ...(raw.assignedAt != null ? { assignedAt: raw.assignedAt } : {}),
  };
}

export function orderDriverId(order: any) {
  const meta = object(order?.meta);
  const driver = object(order?.driver ?? meta.driver);
  return text(driver.id ?? driver.driverId ?? meta.driverId);
}

export function orderAssignedToDriver(order: any, driverSubject: string) {
  const subject = text(driverSubject);
  return Boolean(subject && orderDriverId(order) === subject);
}

export function driverCanSeeOrder(order: any, driverSubject: string) {
  if (text(order?.mode).toLowerCase() !== "delivery") return false;

  const assignedId = orderDriverId(order);
  if (assignedId) return assignedId === text(driverSubject);

  return ACTIVE_UNASSIGNED_STATUSES.has(text(order?.status).toLowerCase());
}

function sanitizeExtras(value: any) {
  return array(value).slice(0, 100).map((entry) => {
    const extra = object(entry);
    return {
      ...(text(extra.id) ? { id: text(extra.id) } : {}),
      ...(text(extra.sku) ? { sku: text(extra.sku) } : {}),
      label: text(extra.label ?? extra.name ?? "Extra"),
      name: text(extra.name ?? extra.label ?? "Extra"),
      price: Number(extra.price) || 0,
    };
  });
}

function sanitizeItems(value: any) {
  return array(value).slice(0, 200).map((entry) => {
    const item = object(entry);
    return {
      ...(text(item.id) ? { id: text(item.id) } : {}),
      ...(text(item.sku ?? item.code) ? { sku: text(item.sku ?? item.code) } : {}),
      name: text(item.name ?? item.title ?? "Artikel"),
      ...(text(item.description) ? { description: text(item.description).slice(0, 500) } : {}),
      ...(text(item.category ?? item.cat) ? { category: text(item.category ?? item.cat) } : {}),
      price: Number(item.price ?? item.unitPrice) || 0,
      qty: Math.max(1, Number(item.qty ?? item.quantity) || 1),
      add: sanitizeExtras(item.add ?? item.extras),
      rm: array(item.rm ?? item.remove).slice(0, 50).map((part) => text(part).slice(0, 120)),
      ...(text(item.note) ? { note: text(item.note).slice(0, 500) } : {}),
    };
  });
}

function sanitizeCustomer(value: any) {
  const customer = object(value);
  const allowed = [
    "name",
    "phone",
    "address",
    "addressLine",
    "street",
    "house",
    "zip",
    "plz",
    "city",
    "floor",
    "entrance",
    "deliveryHint",
    "deliveryNote",
    "lieferhinweis",
    "orderNote",
    "note",
  ];
  const result: PlainObject = {};

  for (const key of allowed) {
    if (customer[key] !== undefined && customer[key] !== null) {
      result[key] = typeof customer[key] === "string"
        ? customer[key].slice(0, key === "note" || key.toLowerCase().includes("hint") ? 1_000 : 500)
        : customer[key];
    }
  }

  return result;
}

function pick(source: PlainObject, keys: string[]) {
  const result: PlainObject = {};
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) result[key] = source[key];
  }
  return result;
}

function sanitizePayment(value: any) {
  return pick(object(value), [
    "method",
    "type",
    "provider",
    "status",
    "paymentMethod",
    "payment_method",
    "paymentStatus",
    "payment_status",
    "tip",
    "trinkgeld",
    "tipAmount",
    "trinkgeldAmount",
    "baseTotal",
    "payableTotal",
    "total",
  ]);
}

function sanitizeMeta(value: any) {
  const meta = object(value);
  const result = pick(meta, [
    "source",
    "note",
    "orderNote",
    "customerNote",
    "deliveryNote",
    "lieferhinweis",
    "paymentMethod",
    "payment_method",
    "paymentType",
    "payment_type",
    "paymentProvider",
    "payment_provider",
    "paymentStatus",
    "payment_status",
    "tip",
    "trinkgeld",
    "tipAmount",
    "trinkgeldAmount",
    "payableTotal",
    "total",
    "eta",
    "etaMin",
    "finalEtaMin",
    "acceptedEtaMin",
    "etaAdjustMin",
    "planned",
    "plannedTime",
    "confirmedPlanned",
    "acceptedPlanned",
    "statusManual",
    "statusUpdatedAt",
    "outForDeliveryAt",
    "claimedAt",
    "claimedBy",
    "createdAtMs",
  ]);

  result.driver = safeDriver(meta.driver);
  result.payment = sanitizePayment(meta.payment);
  result.checkout = sanitizePayment(meta.checkout);
  return result;
}

/**
 * Fahrer ekranının gerçekten kullandığı operasyonel alanları döndürür.
 * E-posta, kupon ayrıntısı, yazdırma verisi, durum geçmişi ve Stripe kimlikleri
 * bilinçli olarak bu şekle alınmaz.
 */
export function sanitizeOrderForDriver(order: any) {
  const customer = sanitizeCustomer(order?.customer);
  const items = sanitizeItems(order?.items);
  const meta = sanitizeMeta(order?.meta);
  const driver = safeDriver(order?.driver ?? meta.driver);
  const payload = {
    items,
    customer,
    planned: order?.planned ?? null,
    meta,
    merchandise: Number(order?.merchandise) || 0,
    discount: Number(order?.discount) || 0,
    surcharges: Number(order?.surcharges) || 0,
    total: Number(order?.total) || 0,
  };

  return {
    id: text(order?.id ?? order?.orderId),
    orderId: text(order?.orderId ?? order?.id),
    ts: order?.ts ?? null,
    createdAt: order?.createdAt ?? null,
    updatedAt: order?.updatedAt ?? null,
    mode: order?.mode,
    channel: order?.channel,
    status: order?.status,
    legacyStatus: order?.legacyStatus,
    statusLegacy: order?.statusLegacy,
    etaMin: order?.etaMin ?? meta.etaMin ?? null,
    etaAdjustMin: order?.etaAdjustMin ?? meta.etaAdjustMin ?? 0,
    planned: order?.planned ?? null,
    plz: customer.plz ?? customer.zip ?? order?.plz ?? null,
    customerName: customer.name ?? order?.customerName ?? "",
    phone: customer.phone ?? order?.phone ?? "",
    addressLine: customer.addressLine ?? customer.address ?? order?.addressLine ?? "",
    note: order?.note ?? meta.note ?? customer.deliveryHint ?? customer.note ?? "",
    items,
    customer,
    meta,
    merchandise: payload.merchandise,
    discount: payload.discount,
    surcharges: payload.surcharges,
    total: payload.total,
    driver,
    doneAt: order?.doneAt ?? null,
    cancelledAt: order?.cancelledAt ?? null,
    order: payload,
    item: payload,
  };
}
