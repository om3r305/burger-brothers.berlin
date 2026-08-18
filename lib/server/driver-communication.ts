export const DRIVER_NEARBY_DISTANCE_METERS = 650;
export const DRIVER_MESSAGE_COOLDOWN_MS = 45_000;

export const DRIVER_MESSAGE_TEMPLATES = {
  at_door: {
    label: "Ich bin vor der Tür",
    title: "🚗 Fahrer wartet vor Ort",
    body: "Unser Fahrer ist bei Ihnen angekommen. Bitte prüfen Sie den Hauseingang.",
  },
  phone_unreachable: {
    label: "Telefon nicht erreichbar",
    title: "⚠️ Unser Fahrer ist bei Ihnen",
    body: "Wir können Sie telefonisch gerade nicht erreichen. Bitte prüfen Sie den Hauseingang.",
  },
  bell_no_answer: {
    label: "Klingel / keine Antwort",
    title: "⚠️ Unser Fahrer wartet vor Ort",
    body: "Über die Klingel konnten wir Sie gerade nicht erreichen. Bitte prüfen Sie den Hauseingang oder kommen Sie kurz nach draußen.",
  },
  unclear_address: {
    label: "Adresse nicht eindeutig",
    title: "📍 Unser Fahrer benötigt Ihre Hilfe",
    body: "Unser Fahrer ist vor Ort, kann den richtigen Eingang aber nicht eindeutig finden. Bitte prüfen Sie den Hauseingang.",
  },
  come_to_entrance: {
    label: "Bitte zum Hauseingang kommen",
    title: "🚗 Fahrer wartet vor Ort",
    body: "Bitte kommen Sie kurz zum Hauseingang. Unser Fahrer wartet auf Sie.",
  },
} as const;

export type DriverMessageTemplateId = keyof typeof DRIVER_MESSAGE_TEMPLATES;

export function driverMessageTemplate(value: unknown) {
  const id = String(value || "") as DriverMessageTemplateId;
  return Object.prototype.hasOwnProperty.call(DRIVER_MESSAGE_TEMPLATES, id)
    ? { id, ...DRIVER_MESSAGE_TEMPLATES[id] }
    : null;
}

export function currentRouteOrderId(routeOrderIds: unknown) {
  if (!Array.isArray(routeOrderIds)) return "";
  return String(routeOrderIds[0] || "").trim();
}

export function distanceMeters(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(to.lat - from.lat);
  const dLng = radians(to.lng - from.lng);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) *
    Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
