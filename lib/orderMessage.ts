
type Item = {
  name: string;
  qty: number;
  category?: string;
  add?: { label?: string; name?: string; price?: number }[];
  note?: string;
};

type Address = {
  name: string;
  phone: string;
  email?: string;
  street?: string;
  house?: string;
  zip?: string;
  city?: string;
  floor?: string;
  entrance?: string;
  note?: string; // customer note
};

type Mode = "pickup" | "delivery";

const CAT_ORDER = [
  "burger","hotdogs","pommes","fries","sides","drinks","sauces","extras","donuts","vegan","bubbleTea"
];

function catKey(name?: string) {
  const t = (name || "").toLowerCase();
  if (t.includes("burger")) return "burger";
  if (t.includes("hotdog")) return "hotdogs";
  if (t.includes("pommes") || t.includes("fries") || t.includes("kartoff")) return "pommes";
  if (t.includes("drink") || t.includes("getränk") || t.includes("wasser") || t.includes("cola") || t.includes("sprite") || t.includes("fanta") || t.includes("fritz")) return "drinks";
  if (t.includes("sauce") || t.includes("soße") || t.includes("soßen") || t.includes("sossen") || t.includes("ketchup") || t.includes("mayo")) return "sauces";
  if (t.includes("donut") || t.includes("dessert")) return "donuts";
  if (t.includes("vegan")) return "vegan";
  if (t.includes("bubble")) return "bubbleTea";
  if (t.includes("extra")) return "extras";
  return "extras";
}

export function buildGroupedMessage(params: {
  id: string;
  items: Item[];
  mode: Mode;
  address: Address;
  etaMin?: number;
}) {
  const { id, items, mode, address, etaMin } = params;

  const groups = new Map<string, Item[]>();
  for (const it of items) {
    const key = catKey(it.category || it.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(it);
  }
  const order = Array.from(groups.entries()).sort((a,b)=>CAT_ORDER.indexOf(a[0]) - CAT_ORDER.indexOf(b[0]));

  const lines: string[] = [];
  lines.push(`🧾 Bestellung #${id} — ${mode==="pickup"?"Abholung":"Lieferung"}`);
  if (typeof etaMin === "number") lines.push(`⏱️ ETA: ~${etaMin} Min`);
  lines.push("");

  for (const [ckey, list] of order) {
    const title = {
      burger: "🍔 Burger",
      hotdogs: "🌭 Hotdogs",
      pommes: "🍟 Pommes/Fries",
      drinks: "🥤 Getränke",
      sauces: "🥫 Soßen",
      extras: "➕ Extras",
      donuts: "🍩 Donuts",
      vegan: "🌱 Vegan",
      bubbleTea: "🧋 Bubble Tea",
    }[ckey] || "Weitere";
    lines.push(`— ${title} —`);
    for (const it of list) {
      const add = (it.add||[]).map(a => a?.label || a?.name).filter(Boolean).join(", ");
      const note = it.note ? ` | Hinweisiz: ${it.note}` : "";
      lines.push(`• ${it.name} × ${it.qty}${add?` — Extras: ${add}`:""}${note}`);
    }
    lines.push("");
  }

  const addr: string[] = [];
  if (mode === "delivery") {
    addr.push("📍 Adressese:");
    addr.push(`${address.name}`);
    addr.push(`${address.phone}`);
    if (address.email) addr.push(address.email);
    addr.push(`${(address.street||"").trim()} ${(address.house||"").trim()}`.trim());
    addr.push(`${(address.zip||"").trim()} ${(address.city||"").trim()}`.trim());
    const opt = [address.floor, address.entrance].filter(Boolean).join(" • ");
    if (opt) addr.push(opt);
  } else {
    addr.push("👤 Abholung:");
    addr.push(`${address.name}`);
    addr.push(`${address.phone}`);
    if (address.email) addr.push(address.email);
  }
  const lines2 = [...lines, addr.join("\n")];
  if (address.note) {
    lines2.push("");
    lines2.push(`📝 Kundenhinweis: ${address.note}`);
  }
  return lines2.join("\n");
}
