/** Ordering progress only. Never includes a customer's name, phone or full address. */
export type BrosContext = {
  page: "menu" | "checkout";
  orderMode: "pickup" | "delivery";
  postalCode: string;
  addressComplete: boolean;
  nameComplete: boolean;
  phoneComplete: boolean;
  deliveryAreaKnown: boolean;
  minimumMet: boolean;
  modePaused: boolean;
  plannedRequired: boolean;
  plannedComplete: boolean;
};
export function normalizeBrosContext(value: unknown): BrosContext | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (v.page !== "checkout" && v.page !== "menu") return undefined;
  return {
    page:v.page, orderMode:v.orderMode === "delivery" ? "delivery" : "pickup",
    postalCode: typeof v.postalCode === "string" ? v.postalCode.replace(/\D/g, "").slice(0,5) : "",
    addressComplete:v.addressComplete === true, nameComplete:v.nameComplete === true,
    phoneComplete:v.phoneComplete === true, deliveryAreaKnown:v.deliveryAreaKnown === true,
    minimumMet:v.minimumMet === true, modePaused:v.modePaused === true,
    plannedRequired:v.plannedRequired === true, plannedComplete:v.plannedComplete === true,
  };
}
export const BROS_WELCOME = "Hallo! Ich bin Bros, dein Bestellhelfer. Wähle Abholung oder Lieferung, suche deinen Burger aus und passe ihn nach deinem Geschmack an. Bei Lieferung prüfe bitte deine Adresse. Wenn du Hilfe brauchst, tippe auf mich.";
export function brosCheckoutHint(c: BrosContext): string {
  if (c.modePaused) return "Diese Bestellart ist gerade pausiert. Prüfe bitte, ob die andere Bestellart verfügbar ist.";
  if (c.orderMode === "delivery") {
    if (c.postalCode.length === 5 && !c.deliveryAreaKnown) return "Diese PLZ ist aktuell nicht im Liefergebiet. Prüfe deine PLZ oder wähle Abholung.";
    if (!c.addressComplete) return "Für die Lieferung brauche ich deine PLZ, die Straße aus der Vorschlagsliste und die Hausnummer. Prüfe bitte auch, ob deine gespeicherte Adresse noch stimmt.";
    if (!c.minimumMet) return "Der Mindestbestellwert ist noch nicht erreicht. Im Warenkorb siehst du, wie viel noch fehlt.";
  }
  if (!c.nameComplete || !c.phoneComplete) return "Ergänze bitte deinen Namen und eine gültige Telefonnummer, damit wir dich bei Fragen erreichen können.";
  if (c.plannedRequired && !c.plannedComplete) return "Wähle bitte eine verfügbare Uhrzeit für deine Bestellung.";
  return "Prüfe deine Artikel und Angaben. Wähle danach deine Zahlungsart. Eine Online-Zahlung ist erst nach der Bestätigung durch den Zahlungsanbieter abgeschlossen.";
}
