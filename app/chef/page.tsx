"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Bell,
  Boxes,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  LogOut,
  MessageCircle,
  Mic,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Trash2,
  Users,
} from "lucide-react";

type Me = {
  id: string;
  username: string;
  displayName: string;
  role: "ADMIN" | "CHEF";
  canOrder: boolean;
};

type Item = {
  id: string;
  name: string;
  category: string;
  mode: "QUANTITY" | "STATUS";
  unit: string;
  minStock: number | null;
  defaultOrderQty: number | null;
  supplierName: string;
  supplierWhatsapp: string;
  sortOrder: number;
  voiceAliases?: string[];
  source?: string;
};

type Need = {
  id: string;
  itemId: string;
  currentQty: number | null;
  neededQty: number | null;
  status: "LOW" | "CRITICAL" | "OUT" | null;
  state: "OPEN" | "ORDERED";
  createdByName: string;
  createdAt: string;
  orderedByName?: string;
  orderedAt?: string;
};

type Plan = {
  id: string;
  title: string;
  note: string;
  scheduledDate: string;
  recurrence: "NONE" | "WEEKLY";
  createdByName: string;
};

type State = {
  me: Me;
  items: Item[];
  needs: Need[];
  plans: Plan[];
  activity: Array<{
    id: string;
    actorName: string;
    detail: string;
    createdAt: string;
  }>;
  users: Array<Me & { active: boolean }>;
  push: { configured: boolean; publicKey: string };
  pinRequired?: boolean;
};

type Draft = {
  checked?: boolean;
  currentQty?: string;
  neededQty?: string;
  status?: "" | "LOW" | "CRITICAL" | "OUT";
  note?: string;
};

type VoiceHit = {
  itemId: string;
  category: string;
  label: string;
  patch: Draft;
};

const CATEGORY_OPTIONS = [
  "Fleisch & Protein",
  "Hähnchen & Snacks",
  "Pommes & Beilagen",
  "Brot",
  "Käse & Spezial",
  "Gemüse & Frische",
  "Soßen",
  "Boxen & Verpackung",
  "Verbrauch & Hygiene",
  "Sonstiges",
];

const glass =
  "border border-white/10 bg-white/[.055] shadow-[0_18px_50px_rgba(0,0,0,.28)] backdrop-blur-xl";

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_USER: "Benutzer nicht gefunden.",
  UNAUTHORIZED: "Bitte erneut anmelden.",
  unauthorized: "Bitte erneut anmelden.",
  ORIGIN_NOT_ALLOWED: "Diese Anfrage wurde aus Sicherheitsgründen blockiert.",
  ADMIN_REQUIRED: "Diese Funktion ist nur für Administratoren verfügbar.",
  ORDER_PERMISSION_REQUIRED: "Dieser Benutzer darf keine Bestellung auslösen.",
  NO_ORDER_ITEMS: "Bitte zuerst Bestellpositionen auswählen.",
  NO_OPEN_ORDER_ITEMS: "Es gibt keine offenen Positionen in dieser Auswahl.",
  MULTIPLE_SUPPLIERS: "Bitte pro Lieferant eine eigene Bestellung senden.",
  ITEM_NAME_REQUIRED: "Bitte einen Artikelnamen eingeben.",
  USER_FIELDS_REQUIRED: "Name und Benutzername sind erforderlich.",
  USERNAME_EXISTS: "Dieser Benutzername ist bereits vergeben.",
  PLAN_FIELDS_REQUIRED: "Bezeichnung und Datum sind erforderlich.",
  PLAN_NOT_FOUND: "Dieser Plan wurde nicht gefunden.",
  PUSH_NOT_CONFIGURED: "Push-Benachrichtigungen sind noch nicht konfiguriert.",
  INVALID_SUBSCRIPTION: "Die Push-Anmeldung konnte nicht gespeichert werden.",
};

const NUMBER_WORDS: Record<string, number> = {
  null: 0,
  ein: 1,
  eins: 1,
  eine: 1,
  einen: 1,
  einer: 1,
  einem: 1,
  zwei: 2,
  zwo: 2,
  drei: 3,
  vier: 4,
  funf: 5,
  fuenf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  elf: 11,
  zwolf: 12,
  zwoelf: 12,
  dreizehn: 13,
  vierzehn: 14,
  funfzehn: 15,
  fuenfzehn: 15,
  sechzehn: 16,
  siebzehn: 17,
  achtzehn: 18,
  neunzehn: 19,
  zwanzig: 20,
};

const fmt = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("de-DE", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";

function errorText(value: unknown, fallback: string) {
  const code = value instanceof Error ? value.message : String(value || "");
  return ERROR_MESSAGES[code] || code || fallback;
}

async function api(body: Record<string, unknown>) {
  const response = await fetch("/api/chef", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(String(payload?.error || "SERVER_ERROR"));
  }
  return payload;
}

function b64Key(value: string) {
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

function normalizeVoice(value: unknown) {
  return String(value || "")
    .toLocaleLowerCase("de-DE")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[’'`´]/g, "")
    .replace(/[^a-z0-9,.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function voiceAliases(item: Item) {
  const names = [item.name, ...(item.voiceAliases || [])];
  const simplified = item.name.replace(/\([^)]*\)/g, " ").trim();
  if (simplified && simplified !== item.name) names.push(simplified);

  const n = normalizeVoice(item.name);
  if (n === "fries" || n === "pommes") names.push("Pommes", "Fries", "normale Pommes");
  if (n.includes("curly fries")) names.push("Curly", "Curly Pommes");
  if (n.includes("country potatoes")) names.push("Country", "Kartoffelecken");
  if (n.includes("chicken fingers")) names.push("Chicken Finger");
  if (n.includes("chicken wings")) names.push("Chicken Wing");
  if (n.includes("mozzarella sticks")) names.push("Mozzarella Stick");
  if (n.includes("smash brot")) names.push("Smashbrot", "Smash Brötchen", "Smash Broetchen");
  if (n.includes("burger brot")) names.push("Burgerbrötchen", "Burgerbroetchen", "normales Brot");
  if (n.includes("kinder brot")) names.push("Kinderbrötchen", "Kinderbroetchen");
  if (n.includes("hotdog brot")) names.push("Hot Dog Brot", "Hotdogbrötchen", "Hotdogbroetchen");
  if (n.includes("black angus")) names.push("Angus");
  if (n.includes("chikn bites") || n.includes("chik n bites")) names.push("Chicken Bites", "Chikn Bites");

  const seen = new Set<string>();
  return names
    .map((name) => normalizeVoice(name))
    .filter((name) => {
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
}

function numberFromText(segment: string, last = false) {
  const normalized = normalizeVoice(segment);
  const tokens = normalized.split(" ").filter(Boolean);
  const found: number[] = [];
  for (const token of tokens) {
    const numeric = Number(token.replace(",", "."));
    if (Number.isFinite(numeric) && numeric >= 0) {
      found.push(numeric);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(NUMBER_WORDS, token)) {
      found.push(NUMBER_WORDS[token]);
    }
  }
  if (!found.length) return null;
  return last ? found[found.length - 1] : found[0];
}

function statusFromText(text: string): Draft["status"] | null {
  const n = normalizeVoice(text);
  if (/\b(leer|aus|nichts mehr|keine mehr|kein mehr|nicht mehr da)\b/.test(n)) return "OUT";
  if (/\b(kritisch|fast leer|sehr wenig|extrem wenig)\b/.test(n)) return "CRITICAL";
  if (/\b(wenig|knapp|wird knapp|geht zur neige|bald leer)\b/.test(n)) return "LOW";
  if (/\b(genug|ausreichend|voll|alles da)\b/.test(n)) return "";
  return null;
}

function statusLabel(status: Need["status"] | Draft["status"]) {
  if (status === "OUT") return "LEER";
  if (status === "CRITICAL") return "KRITISCH";
  if (status === "LOW") return "WENIG";
  return "AUSREICHEND";
}

function germanActivity(detail: string) {
  return String(detail || "")
    .replace(/(\d+) ürün kontrol edildi/g, "$1 Produkte geprüft")
    .replace(/(\d+) yeni eksik/g, "$1 neue offene Positionen")
    .replace(/(\d+) kalem geldi/g, "$1 Positionen eingegangen")
    .replace(/(\d+) kalem/g, "$1 Positionen");
}

function Login({ done }: { done: () => void }) {
  const [username, setUsername] = useState("omer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api({ action: "login", username });
      done();
    } catch (reason) {
      setError(errorText(reason, "Anmeldung fehlgeschlagen."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#090909] px-4 py-10 text-white">
      <div className="mx-auto flex min-h-[80vh] max-w-md items-center">
        <form onSubmit={submit} className={`w-full rounded-[30px] p-6 ${glass}`}>
          <div className="mb-7 flex items-center gap-4">
            <img src="/chef-icon.svg" alt="BB Chef" className="h-16 w-16 rounded-2xl" />
            <div>
              <div className="text-2xl font-black text-amber-200">BB Chef</div>
              <div className="text-xs text-white/45">Burger Brothers · Küchenorganisation</div>
            </div>
          </div>

          <label className="text-xs text-white/50">
            Benutzername
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-base outline-none focus:border-amber-300/50"
            />
          </label>

          <div className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[.06] px-3 py-2.5 text-xs text-amber-100/70">
            Die PIN-Prüfung ist während des Tests vorübergehend deaktiviert. Rechte werden weiterhin pro Benutzer angewendet.
          </div>

          {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}

          <button
            disabled={busy || !username.trim()}
            className="mt-5 w-full rounded-xl bg-amber-300 py-3.5 font-black text-black disabled:opacity-50"
          >
            {busy ? "Anmeldung läuft…" : "Anmelden"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function ChefPage() {
  const [state, setState] = useState<State | null>(null);
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState<"stock" | "orders" | "plans" | "admin">("stock");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [voice, setVoice] = useState("");
  const [voiceHits, setVoiceHits] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const rec = useRef<any>(null);
  const lastAppliedVoice = useRef("");

  async function load() {
    try {
      const response = await fetch("/api/chef", {
        credentials: "include",
        cache: "no-store",
      });
      if (response.status === 401) {
        setState(null);
        setChecked(true);
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "SERVER_ERROR");
      setState(payload);
      setChecked(true);
    } catch (reason) {
      setToast(errorText(reason, "Verbindung fehlgeschlagen."));
      setChecked(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3600);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (state && state.me.role !== "ADMIN" && tab === "admin") setTab("stock");
  }, [state, tab]);

  const itemMap = useMemo(
    () => new Map((state?.items || []).map((item) => [item.id, item] as const)),
    [state?.items],
  );

  const categories = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of state?.items || []) {
      const rows = map.get(item.category) || [];
      rows.push(item);
      map.set(item.category, rows);
    }
    return [...map.entries()];
  }, [state?.items]);

  const groups = useMemo(() => {
    const map = new Map<string, Need[]>();
    for (const need of state?.needs || []) {
      const item = itemMap.get(need.itemId);
      const key = item?.supplierName || "Lieferant nicht zugeordnet";
      map.set(key, [...(map.get(key) || []), need]);
    }
    return [...map.entries()];
  }, [state?.needs, itemMap]);

  function parseVoice(text: string): VoiceHit[] {
    if (!state) return [];
    const normalized = normalizeVoice(text);
    if (!normalized) return [];

    const candidates = state.items
      .flatMap((item) => voiceAliases(item).map((alias) => ({ item, alias })))
      .sort((a, b) => b.alias.length - a.alias.length);

    const occupied: Array<[number, number]> = [];
    const hitItems = new Set<string>();
    const hits: VoiceHit[] = [];
    const padded = ` ${normalized} `;

    for (const candidate of candidates) {
      if (hitItems.has(candidate.item.id)) continue;
      const needle = ` ${candidate.alias} `;
      let from = 0;
      let index = padded.indexOf(needle, from);
      while (index >= 0) {
        const start = Math.max(0, index);
        const end = start + needle.length;
        const overlaps = occupied.some(([a, b]) => start < b && end > a);
        if (!overlaps) {
          const before = padded.slice(Math.max(0, start - 42), start);
          const after = padded.slice(end, Math.min(padded.length, end + 42));
          const around = `${before} ${candidate.alias} ${after}`;
          const beforeNumber = numberFromText(before, true);
          const afterNumber = numberFromText(after, false);
          const amount = beforeNumber ?? afterNumber;
          const status = statusFromText(around);
          const stockContext = /\b(noch|bestand|lager|vorhanden|haben wir|ist da|sind da)\b/.test(
            normalizeVoice(around),
          );

          let patch: Draft | null = null;
          let label = "";
          if (candidate.item.mode === "QUANTITY" && amount != null) {
            if (stockContext) {
              patch = { currentQty: String(amount) };
              label = `${candidate.item.name}: Bestand ${amount} ${candidate.item.unit}`.trim();
            } else {
              patch = { neededQty: String(amount) };
              label = `${candidate.item.name}: bestellen ${amount} ${candidate.item.unit}`.trim();
            }
          } else if (candidate.item.mode === "STATUS" && amount != null) {
            patch = { neededQty: String(amount), status: status || "LOW" };
            label = `${candidate.item.name}: bestellen ${amount} ${candidate.item.unit}`.trim();
          } else if (status !== null) {
            patch = { status };
            label = `${candidate.item.name}: ${statusLabel(status)}`;
          }

          if (patch) {
            occupied.push([start, end]);
            hitItems.add(candidate.item.id);
            hits.push({
              itemId: candidate.item.id,
              category: candidate.item.category,
              label,
              patch,
            });
          }
          break;
        }
        from = index + needle.length;
        index = padded.indexOf(needle, from);
      }
    }

    return hits;
  }

  function applyVoice(text: string) {
    const normalized = normalizeVoice(text);
    if (!normalized || normalized === lastAppliedVoice.current) return;
    const hits = parseVoice(text);
    lastAppliedVoice.current = normalized;
    if (!hits.length) {
      setVoiceHits([]);
      setToast("Kein eindeutiger Artikel erkannt. Bitte den Produktnamen wie in der Liste sagen.");
      return;
    }

    setDrafts((current) => {
      const next = { ...current };
      for (const hit of hits) {
        next[hit.itemId] = {
          ...(next[hit.itemId] || {}),
          ...hit.patch,
          checked: true,
        };
      }
      return next;
    });

    setOpenCategories((current) => {
      const next = { ...current };
      for (const hit of hits) next[hit.category] = true;
      return next;
    });
    setVoiceHits(hits.map((hit) => hit.label));
    setToast(`${hits.length} Position${hits.length === 1 ? "" : "en"} automatisch übernommen.`);

    window.setTimeout(() => {
      document.getElementById(`chef-item-${hits[0].itemId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 180);
  }

  function toggleMic() {
    if (listening) {
      rec.current?.stop();
      setListening(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setToast("Dieser Browser unterstützt die Spracherkennung nicht.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "de-DE";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event: any) => {
      let fullText = "";
      let finalText = "";
      for (let index = 0; index < event.results.length; index += 1) {
        const transcript = String(event.results[index][0]?.transcript || "").trim();
        if (!transcript) continue;
        fullText += `${transcript} `;
        if (event.results[index].isFinal) finalText += `${transcript} `;
      }
      const clean = fullText.trim();
      setVoice(clean);
      if (finalText.trim()) applyVoice(clean);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => {
      setListening(false);
      setToast("Spracherkennung wurde beendet. Bitte erneut auf das Mikrofon tippen.");
    };
    rec.current = recognition;
    recognition.start();
    setListening(true);
    setVoiceHits([]);
    lastAppliedVoice.current = "";
  }

  async function save() {
    const entries = (Object.entries(drafts) as Array<[string, Draft]>).map(
      ([itemId, value]) => ({
        itemId,
        checked: value.checked === true,
        currentQty: value.currentQty ?? null,
        neededQty: value.neededQty ?? null,
        status: value.status || null,
        note: value.note || "",
      }),
    );

    if (!entries.length) {
      setToast("Bitte zuerst mindestens einen Artikel aktualisieren.");
      return;
    }

    setBusy(true);
    try {
      await api({ action: "saveReport", entries, voiceTranscript: voice });
      setDrafts({});
      setVoice("");
      setVoiceHits([]);
      lastAppliedVoice.current = "";
      setToast("Bestandskontrolle gespeichert.");
      await load();
    } catch (reason) {
      setToast(errorText(reason, "Bestandskontrolle konnte nicht gespeichert werden."));
    } finally {
      setBusy(false);
    }
  }

  async function order(name: string, needs: Need[]) {
    const ids = needs
      .filter((need) => need.state === "OPEN" && selected[need.id])
      .map((need) => need.id);

    if (!ids.length) {
      setToast("Bitte zuerst Bestellpositionen markieren.");
      return;
    }

    setBusy(true);
    try {
      const payload = await api({ action: "placeOrder", needIds: ids });
      setToast(`${name}: Bestellung wurde von ${state?.me.displayName} erfasst.`);
      window.open(String(payload.whatsappUrl), "_blank", "noopener,noreferrer");
      setSelected({});
      await load();
    } catch (reason) {
      setToast(errorText(reason, "Bestellung konnte nicht erstellt werden."));
    } finally {
      setBusy(false);
    }
  }

  async function receive(ids: string[]) {
    setBusy(true);
    try {
      await api({ action: "receiveNeeds", needIds: ids });
      setToast("Wareneingang bestätigt.");
      await load();
    } catch (reason) {
      setToast(errorText(reason, "Wareneingang konnte nicht aktualisiert werden."));
    } finally {
      setBusy(false);
    }
  }

  async function push() {
    if (!state?.push.configured) {
      setToast("Push-Benachrichtigungen sind auf dem Server noch nicht konfiguriert.");
      return;
    }

    try {
      if (
        Notification.permission !== "granted" &&
        (await Notification.requestPermission()) !== "granted"
      ) {
        setToast("Benachrichtigungen wurden nicht erlaubt.");
        return;
      }

      const registration = await navigator.serviceWorker.register("/chef-sw.js", {
        scope: "/chef/",
      });
      const subscription =
        (await registration.pushManager.getSubscription()) ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64Key(state.push.publicKey),
        }));

      await api({ action: "subscribePush", subscription: subscription.toJSON() });
      setToast("BB-Chef-Benachrichtigungen sind auf diesem Gerät aktiviert.");
    } catch (reason) {
      setToast(errorText(reason, "Benachrichtigungen konnten nicht aktiviert werden."));
    }
  }

  async function logout() {
    await api({ action: "logout" }).catch(() => null);
    setState(null);
  }

  if (!checked) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#090909] text-amber-200">
        <RefreshCw className="animate-spin" />
      </main>
    );
  }

  if (!state) return <Login done={() => void load()} />;

  const open = state.needs.filter((need) => need.state === "OPEN").length;
  const ordered = state.needs.filter((need) => need.state === "ORDERED").length;

  return (
    <main className="min-h-screen bg-[#090909] pb-28 text-white">
      <header className="sticky top-0 z-20 border-b border-white/8 bg-black/80 px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-xl">
        <div className="mx-auto flex max-w-xl items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/chef-icon.svg" className="h-11 w-11 rounded-xl" alt="BB Chef" />
            <div>
              <div className="font-black text-amber-200">BB Chef</div>
              <div className="text-[11px] text-white/45">
                {state.me.displayName} · {state.me.role === "ADMIN" ? "Admin" : "Chef"}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void push()}
              className="rounded-xl border border-white/10 bg-white/5 p-2.5"
              aria-label="Benachrichtigungen aktivieren"
            >
              <Bell size={18} />
            </button>
            <button
              onClick={() => void logout()}
              className="rounded-xl border border-white/10 bg-white/5 p-2.5"
              aria-label="Abmelden"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-xl space-y-4 px-3 py-4">
        <div className="grid grid-cols-3 gap-2">
          <Stat n={open} t="Bestellung nötig" />
          <Stat n={ordered} t="Bestellt" />
          <Stat n={state.plans.length} t="Geplant" />
        </div>

        {tab === "stock" ? (
          <section className="space-y-3">
            <div className={`rounded-[26px] p-4 ${glass}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-black">Abendliche Bestandskontrolle</h2>
                  <p className="mt-1 text-xs text-white/45">
                    Gruppe öffnen oder einfach auf Deutsch sprechen. Mengen werden automatisch dem passenden Artikel zugeordnet.
                  </p>
                </div>
                <button
                  onClick={toggleMic}
                  aria-label={listening ? "Spracherkennung stoppen" : "Spracherkennung starten"}
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${
                    listening ? "bg-rose-500" : "bg-amber-300 text-black"
                  }`}
                >
                  <Mic size={19} />
                </button>
              </div>

              <div className="mt-3 rounded-xl bg-black/30 p-3 text-xs text-white/60">
                <div className="font-bold text-white/75">
                  {listening ? "Hört zu…" : "Deutsche Spracheingabe"}
                </div>
                <div className="mt-1 text-white/40">
                  Beispiel: „zwei Fries, drei Curly Fries, ein Smash Brot, Ketchup fast leer“
                </div>
                {voice ? <div className="mt-2 text-white/70">„{voice}“</div> : null}
                {voiceHits.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {voiceHits.map((hit) => (
                      <span
                        key={hit}
                        className="rounded-full bg-emerald-400/12 px-2 py-1 text-[10px] font-bold text-emerald-200"
                      >
                        {hit}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            {categories.map(([category, items]) => {
              const expanded = !!openCategories[category];
              const categoryOpenNeeds = items.reduce(
                (sum, item) =>
                  sum +
                  (state.needs.some(
                    (need) => need.itemId === item.id && need.state === "OPEN",
                  )
                    ? 1
                    : 0),
                0,
              );

              return (
                <div key={category} className={`overflow-hidden rounded-[24px] ${glass}`}>
                  <button
                    onClick={() =>
                      setOpenCategories((current) => ({
                        ...current,
                        [category]: !current[category],
                      }))
                    }
                    className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
                  >
                    <div className="min-w-0">
                      <div className="font-black text-amber-200">{category}</div>
                      <div className="mt-0.5 text-[11px] text-white/40">
                        {items.length} Artikel
                        {categoryOpenNeeds ? ` · ${categoryOpenNeeds} offen` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {categoryOpenNeeds ? (
                        <span className="rounded-full bg-rose-400/15 px-2 py-1 text-[10px] font-black text-rose-300">
                          {categoryOpenNeeds}
                        </span>
                      ) : null}
                      {expanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                    </div>
                  </button>

                  {expanded ? (
                    <div className="divide-y divide-white/7 border-t border-white/8">
                      {items.map((item) => {
                        const draft = drafts[item.id] || {};
                        const need = state.needs.find((row) => row.itemId === item.id);
                        const low =
                          item.mode === "QUANTITY" &&
                          item.minStock != null &&
                          draft.currentQty !== undefined &&
                          Number(draft.currentQty) <= item.minStock;

                        return (
                          <div key={item.id} id={`chef-item-${item.id}`} className="scroll-mt-36 p-4">
                            <div className="mb-3 flex items-start justify-between gap-2">
                              <div>
                                <div className="font-bold">{item.name}</div>
                                <div className="text-[11px] text-white/40">
                                  {need
                                    ? `Offen seit ${fmt(need.createdAt)} · ${need.createdByName}`
                                    : "Keine offene Meldung"}
                                </div>
                                {low ? (
                                  <div className="mt-1 text-[11px] font-bold text-orange-300">
                                    Mindestbestand: {item.minStock} {item.unit}
                                  </div>
                                ) : null}
                              </div>
                              {need ? (
                                <span
                                  className={`rounded-full px-2 py-1 text-[10px] font-black ${
                                    need.state === "ORDERED"
                                      ? "bg-sky-400/15 text-sky-300"
                                      : "bg-rose-400/15 text-rose-300"
                                  }`}
                                >
                                  {need.state === "ORDERED" ? "BESTELLT" : "OFFEN"}
                                </span>
                              ) : null}
                            </div>

                            {item.mode === "QUANTITY" ? (
                              <div className="grid grid-cols-2 gap-2">
                                <Q
                                  label="Aktuell auf Lager"
                                  value={draft.currentQty ?? ""}
                                  unit={item.unit}
                                  change={(value) =>
                                    setDrafts((current) => ({
                                      ...current,
                                      [item.id]: {
                                        ...(current[item.id] || {}),
                                        currentQty: value,
                                        checked: true,
                                      },
                                    }))
                                  }
                                />
                                <Q
                                  label="Benötigte Bestellung"
                                  value={draft.neededQty ?? ""}
                                  unit={item.unit}
                                  gold
                                  change={(value) =>
                                    setDrafts((current) => ({
                                      ...current,
                                      [item.id]: {
                                        ...(current[item.id] || {}),
                                        neededQty: value,
                                        checked: true,
                                      },
                                    }))
                                  }
                                />
                              </div>
                            ) : (
                              <div className="grid grid-cols-4 gap-1.5">
                                {[
                                  ["", "Ausreichend"],
                                  ["LOW", "Wenig"],
                                  ["CRITICAL", "Kritisch"],
                                  ["OUT", "Leer"],
                                ].map(([value, label]) => (
                                  <button
                                    key={label}
                                    onClick={() =>
                                      setDrafts((current) => ({
                                        ...current,
                                        [item.id]: {
                                          ...(current[item.id] || {}),
                                          status: value as Draft["status"],
                                          checked: true,
                                        },
                                      }))
                                    }
                                    className={`rounded-xl px-1 py-2 text-[10px] font-bold ${
                                      draft.checked && (draft.status || "") === value
                                        ? value === "OUT"
                                          ? "bg-rose-500"
                                          : value === "CRITICAL"
                                            ? "bg-orange-400 text-black"
                                            : value === "LOW"
                                              ? "bg-amber-300 text-black"
                                              : "bg-emerald-400 text-black"
                                        : "bg-white/6 text-white/55"
                                    }`}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}

            <button
              disabled={busy}
              onClick={() => void save()}
              className="sticky bottom-24 flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-300 px-4 py-4 font-black text-black shadow-2xl disabled:opacity-50"
            >
              <Save size={18} /> Bestandskontrolle speichern
            </button>
          </section>
        ) : null}

        {tab === "orders" ? (
          <section className="space-y-4">
            <div className={`rounded-[26px] p-4 ${glass}`}>
              <h2 className="font-black">Bestellzentrale</h2>
              <p className="mt-1 text-xs text-white/45">
                Erfasst von und bestellt von werden getrennt gespeichert.
              </p>
            </div>

            {groups.length ? (
              groups.map(([name, needs]) => {
                const openNeeds = needs.filter((need) => need.state === "OPEN");
                const doneNeeds = needs.filter((need) => need.state === "ORDERED");
                const canOrder = state.me.canOrder || state.me.role === "ADMIN";

                return (
                  <div key={name} className={`overflow-hidden rounded-[26px] ${glass}`}>
                    <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
                      <div>
                        <div className="font-black">{name}</div>
                        <div className="text-[11px] text-white/40">
                          {openNeeds.length} offen · {doneNeeds.length} bestellt
                        </div>
                      </div>
                      {openNeeds.length && canOrder ? (
                        <button
                          disabled={busy}
                          onClick={() => void order(name, openNeeds)}
                          className="flex items-center gap-1.5 rounded-xl bg-emerald-400 px-3 py-2 text-xs font-black text-black"
                        >
                          <MessageCircle size={15} /> WhatsApp
                        </button>
                      ) : null}
                    </div>

                    <div className="divide-y divide-white/7">
                      {needs.map((need) => {
                        const item = itemMap.get(need.itemId);
                        return (
                          <label key={need.id} className="flex gap-3 p-4">
                            {need.state === "OPEN" && canOrder ? (
                              <input
                                type="checkbox"
                                className="mt-1 h-5 w-5 accent-amber-300"
                                checked={!!selected[need.id]}
                                onChange={(event) =>
                                  setSelected((current) => ({
                                    ...current,
                                    [need.id]: event.target.checked,
                                  }))
                                }
                              />
                            ) : (
                              <div className="mt-1 grid h-5 w-5 place-items-center rounded-full bg-sky-400/15 text-sky-300">
                                <Check size={13} />
                              </div>
                            )}

                            <div className="min-w-0 flex-1">
                              <div className="flex justify-between gap-2">
                                <b>{item?.name || "Artikel"}</b>
                                <b className="text-amber-200">
                                  {need.neededQty != null
                                    ? `${need.neededQty} ${item?.unit || ""}`
                                    : statusLabel(need.status)}
                                </b>
                              </div>
                              <div className="mt-1 text-[11px] text-white/45">
                                Erfasst von: <b className="text-white/70">{need.createdByName}</b> · {fmt(need.createdAt)}
                              </div>
                              {need.currentQty != null ? (
                                <div className="text-[11px] text-white/35">
                                  Bestand: {need.currentQty} {item?.unit}
                                </div>
                              ) : null}
                              {need.orderedByName ? (
                                <div className="mt-1 text-[11px] font-bold text-sky-300">
                                  Bestellt von: {need.orderedByName} · {fmt(need.orderedAt)}
                                </div>
                              ) : null}
                            </div>
                          </label>
                        );
                      })}
                    </div>

                    {doneNeeds.length ? (
                      <button
                        onClick={() => void receive(doneNeeds.map((need) => need.id))}
                        className="m-3 flex w-[calc(100%-1.5rem)] items-center justify-center gap-2 rounded-xl bg-sky-400/15 px-3 py-3 text-xs font-black text-sky-200"
                      >
                        <PackageCheck size={16} /> Wareneingang bestätigen
                      </button>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <Empty text="Keine offenen Bestellpositionen." />
            )}
          </section>
        ) : null}

        {tab === "plans" ? <Plans state={state} reload={load} tell={setToast} /> : null}
        {tab === "admin" && state.me.role === "ADMIN" ? (
          <Admin state={state} reload={load} tell={setToast} />
        ) : null}

        {state.activity.length ? (
          <div className={`rounded-[26px] p-4 ${glass}`}>
            <div className="mb-2 text-xs font-black text-white/50">Letzte Aktivitäten</div>
            {state.activity.slice(0, 6).map((activity) => (
              <div
                key={activity.id}
                className="flex justify-between gap-2 border-t border-white/5 py-2 text-[11px]"
              >
                <span>
                  <b>{activity.actorName}</b>
                  <span className="text-white/45"> · {germanActivity(activity.detail)}</span>
                </span>
                <span className="shrink-0 text-white/30">{fmt(activity.createdAt)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-black/85 px-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl">
        <div
          className={`mx-auto grid max-w-xl gap-1 ${
            state.me.role === "ADMIN" ? "grid-cols-4" : "grid-cols-3"
          }`}
        >
          <Nav active={tab === "stock"} icon={<Boxes size={19} />} label="Bestand" on={() => setTab("stock")} />
          <Nav
            active={tab === "orders"}
            icon={<MessageCircle size={19} />}
            label={`Bestellung${open ? ` ${open}` : ""}`}
            on={() => setTab("orders")}
          />
          <Nav active={tab === "plans"} icon={<CalendarDays size={19} />} label="Plan" on={() => setTab("plans")} />
          {state.me.role === "ADMIN" ? (
            <Nav active={tab === "admin"} icon={<Settings size={19} />} label="Admin" on={() => setTab("admin")} />
          ) : null}
        </div>
      </nav>

      {toast ? (
        <div className="fixed left-1/2 top-4 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl border border-white/10 bg-neutral-900/95 px-4 py-3 text-sm shadow-2xl">
          {toast}
        </div>
      ) : null}
    </main>
  );
}

function Stat({ n, t }: { n: number; t: string }) {
  return (
    <div className={`rounded-2xl p-3 ${glass}`}>
      <div className="text-xl font-black text-amber-200">{n}</div>
      <div className="text-[10px] text-white/45">{t}</div>
    </div>
  );
}

function Q({
  label,
  value,
  unit,
  gold,
  change,
}: {
  label: string;
  value: string;
  unit: string;
  gold?: boolean;
  change: (value: string) => void;
}) {
  return (
    <label className="text-[11px] text-white/45">
      {label}
      <div
        className={`mt-1 flex items-center rounded-xl border ${
          gold ? "border-amber-300/25 bg-amber-300/5" : "border-white/10 bg-black/25"
        }`}
      >
        <input
          inputMode="decimal"
          value={value}
          onChange={(event) => change(event.target.value)}
          className={`min-w-0 flex-1 bg-transparent px-3 py-2.5 text-base font-bold outline-none ${
            gold ? "text-amber-200" : ""
          }`}
          placeholder="0"
        />
        <span className="pr-3 text-[10px] text-white/35">{unit}</span>
      </div>
    </label>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className={`rounded-[26px] p-8 text-center text-sm text-white/40 ${glass}`}>
      {text}
    </div>
  );
}

function Nav({
  active,
  icon,
  label,
  on,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  on: () => void;
}) {
  return (
    <button
      onClick={on}
      className={`flex flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-bold ${
        active ? "bg-amber-300 text-black" : "text-white/50"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Plans({
  state,
  reload,
  tell,
}: {
  state: State;
  reload: () => Promise<void>;
  tell: (message: string) => void;
}) {
  const [form, setForm] = useState({
    title: "",
    scheduledDate: new Date().toISOString().slice(0, 10),
    note: "",
    remindDayBefore: true,
    remindSameDay: true,
    recurrence: "NONE",
  });

  async function savePlan() {
    try {
      await api({ action: "upsertPlan", plan: form });
      setForm((current) => ({ ...current, title: "", note: "" }));
      tell("Vorbereitungsplan gespeichert.");
      await reload();
    } catch (reason) {
      tell(errorText(reason, "Plan konnte nicht gespeichert werden."));
    }
  }

  async function complete(id: string) {
    try {
      await api({ action: "completePlan", id });
      tell("Vorbereitung als erledigt markiert.");
      await reload();
    } catch (reason) {
      tell(errorText(reason, "Plan konnte nicht abgeschlossen werden."));
    }
  }

  return (
    <section className="space-y-4">
      <div className={`rounded-[26px] p-4 ${glass}`}>
        <div className="mb-3 flex items-center gap-2 font-black">
          <CalendarDays size={18} /> Vorbereitung planen
        </div>
        <div className="grid gap-2">
          <input
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            placeholder="Mozzarella Special / Schwarze Sauce…"
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 outline-none"
          />
          <input
            type="date"
            value={form.scheduledDate}
            onChange={(event) => setForm({ ...form, scheduledDate: event.target.value })}
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 outline-none"
          />
          <input
            value={form.note}
            onChange={(event) => setForm({ ...form, note: event.target.value })}
            placeholder="Notiz (optional)"
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 outline-none"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-white/60">
          <label>
            <input
              type="checkbox"
              checked={form.remindDayBefore}
              onChange={(event) => setForm({ ...form, remindDayBefore: event.target.checked })}
            />{" "}
            1 Tag vorher
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.remindSameDay}
              onChange={(event) => setForm({ ...form, remindSameDay: event.target.checked })}
            />{" "}
            Am selben Tag
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.recurrence === "WEEKLY"}
              onChange={(event) =>
                setForm({ ...form, recurrence: event.target.checked ? "WEEKLY" : "NONE" })
              }
            />{" "}
            Wöchentlich
          </label>
        </div>
        <button
          onClick={() => void savePlan()}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-300 py-3 font-black text-black"
        >
          <Plus size={17} /> Plan speichern
        </button>
      </div>

      {state.plans.length ? (
        state.plans.map((plan) => (
          <div key={plan.id} className={`rounded-[26px] p-4 ${glass}`}>
            <div className="flex justify-between gap-3">
              <div>
                <div className="text-lg font-black">{plan.title}</div>
                <div className="text-sm font-bold text-amber-200">{plan.scheduledDate}</div>
                <div className="text-[11px] text-white/42">
                  Geplant von: {plan.createdByName}
                  {plan.recurrence === "WEEKLY" ? " · Wöchentlich" : ""}
                </div>
                {plan.note ? <p className="mt-2 text-sm text-white/60">{plan.note}</p> : null}
              </div>
              <button
                onClick={() => void complete(plan.id)}
                className="h-fit rounded-xl bg-emerald-400 px-3 py-2 text-xs font-black text-black"
              >
                Erledigt ✓
              </button>
            </div>
          </div>
        ))
      ) : (
        <Empty text="Keine Vorbereitung geplant." />
      )}
    </section>
  );
}

function Admin({
  state,
  reload,
  tell,
}: {
  state: State;
  reload: () => Promise<void>;
  tell: (message: string) => void;
}) {
  const emptyItem = {
    id: "",
    name: "",
    category: "Pommes & Beilagen",
    mode: "QUANTITY",
    unit: "",
    minStock: "",
    defaultOrderQty: "",
    supplierName: "",
    supplierWhatsapp: "",
  };
  const [item, setItem] = useState<any>(emptyItem);
  const [user, setUser] = useState<any>({
    id: "",
    displayName: "",
    username: "",
    role: "CHEF",
    canOrder: false,
  });

  const adminGroups = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const row of state.items) {
      map.set(row.category, [...(map.get(row.category) || []), row]);
    }
    return [...map.entries()];
  }, [state.items]);

  async function saveItem() {
    try {
      await api({ action: "upsertItem", item });
      setItem(emptyItem);
      tell("Artikel gespeichert.");
      await reload();
    } catch (reason) {
      tell(errorText(reason, "Artikel konnte nicht gespeichert werden."));
    }
  }

  async function removeItem(id: string, name: string) {
    if (!window.confirm(`${name} aus der Bestandsliste entfernen?`)) return;
    try {
      await api({ action: "deleteItem", id });
      if (item.id === id) setItem(emptyItem);
      tell(`${name} wurde entfernt.`);
      await reload();
    } catch (reason) {
      tell(errorText(reason, "Artikel konnte nicht entfernt werden."));
    }
  }

  async function saveUser() {
    try {
      await api({ action: "upsertUser", user });
      setUser({ id: "", displayName: "", username: "", role: "CHEF", canOrder: false });
      tell("Benutzer gespeichert.");
      await reload();
    } catch (reason) {
      tell(errorText(reason, "Benutzer konnte nicht gespeichert werden."));
    }
  }

  return (
    <section className="space-y-4">
      <div className={`rounded-[26px] p-4 ${glass}`}>
        <div className="mb-1 flex items-center gap-2 font-black">
          <Settings size={18} /> Artikelverwaltung
        </div>
        <p className="mb-3 text-xs text-white/45">
          Relevante Artikel aus dem Extras-Menü werden automatisch mit ihrem echten Namen synchronisiert. Weitere Lagerartikel kannst du hier ergänzen.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <input
            value={item.name}
            onChange={(event) => setItem({ ...item, name: event.target.value })}
            placeholder="Artikelname / Modell / Größe"
            className="col-span-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"
          />
          <select
            value={item.category}
            onChange={(event) => setItem({ ...item, category: event.target.value })}
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"
          >
            {CATEGORY_OPTIONS.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <select
            value={item.mode}
            onChange={(event) => setItem({ ...item, mode: event.target.value })}
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"
          >
            <option value="QUANTITY">Menge</option>
            <option value="STATUS">Status</option>
          </select>
          <input
            value={item.unit}
            onChange={(event) => setItem({ ...item, unit: event.target.value })}
            placeholder="Einheit: Karton/Kiste"
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"
          />
          <input
            value={item.minStock}
            onChange={(event) => setItem({ ...item, minStock: event.target.value })}
            placeholder="Mindestbestand"
            inputMode="decimal"
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"
          />
          <input
            value={item.defaultOrderQty}
            onChange={(event) => setItem({ ...item, defaultOrderQty: event.target.value })}
            placeholder="Standard-Bestellmenge"
            inputMode="decimal"
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"
          />
          <input
            value={item.supplierName}
            onChange={(event) => setItem({ ...item, supplierName: event.target.value })}
            placeholder="Lieferant"
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"
          />
          <input
            value={item.supplierWhatsapp}
            onChange={(event) => setItem({ ...item, supplierWhatsapp: event.target.value })}
            placeholder="WhatsApp: +49…"
            className="col-span-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"
          />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => setItem(emptyItem)}
            className="rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-bold text-white/70"
          >
            Neuer Artikel
          </button>
          <button
            onClick={() => void saveItem()}
            className="rounded-xl bg-amber-300 py-3 font-black text-black"
          >
            {item.id ? "Änderungen speichern" : "Artikel hinzufügen"}
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {adminGroups.map(([category, items]) => (
            <div key={category} className="overflow-hidden rounded-2xl border border-white/8 bg-black/20">
              <div className="border-b border-white/7 px-3 py-2 text-xs font-black text-amber-200">
                {category} · {items.length}
              </div>
              <div className="divide-y divide-white/7">
                {items.map((row) => (
                  <div key={row.id} className="flex items-center gap-2 px-3 py-2.5">
                    <button
                      onClick={() =>
                        setItem({
                          ...row,
                          minStock: row.minStock ?? "",
                          defaultOrderQty: row.defaultOrderQty ?? "",
                        })
                      }
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-sm font-bold">{row.name}</div>
                      <div className="text-[10px] text-white/35">
                        {row.mode === "QUANTITY" ? `Menge · ${row.unit || "ohne Einheit"}` : "Status"}
                        {row.source === "menu-extras" ? " · Extras-Menü" : ""}
                      </div>
                    </button>
                    <button
                      onClick={() =>
                        setItem({
                          ...row,
                          minStock: row.minStock ?? "",
                          defaultOrderQty: row.defaultOrderQty ?? "",
                        })
                      }
                      className="rounded-lg bg-white/7 p-2 text-white/55"
                      aria-label={`${row.name} bearbeiten`}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => void removeItem(row.id, row.name)}
                      className="rounded-lg bg-rose-500/10 p-2 text-rose-300"
                      aria-label={`${row.name} entfernen`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={`rounded-[26px] p-4 ${glass}`}>
        <div className="mb-1 flex items-center gap-2 font-black">
          <Users size={18} /> Chef-Benutzer
        </div>
        <p className="mb-3 text-xs text-white/45">
          Die PIN ist aktuell deaktiviert. Ein normaler Chef sieht den Admin-Bereich nicht. „Bestellung erlauben“ nur für berechtigte Personen aktivieren.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <input
            value={user.displayName}
            onChange={(event) => setUser({ ...user, displayName: event.target.value })}
            placeholder="Name"
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"
          />
          <input
            value={user.username}
            onChange={(event) => setUser({ ...user, username: event.target.value })}
            placeholder="Benutzername"
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"
          />
          <select
            value={user.role}
            onChange={(event) => setUser({ ...user, role: event.target.value })}
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"
          >
            <option value="CHEF">Chef</option>
            <option value="ADMIN">Admin</option>
          </select>
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 text-xs text-white/60">
            <input
              type="checkbox"
              checked={user.canOrder}
              onChange={(event) => setUser({ ...user, canOrder: event.target.checked })}
            />
            Bestellung erlauben
          </label>
        </div>

        <button
          onClick={() => void saveUser()}
          className="mt-3 w-full rounded-xl bg-amber-300 py-3 font-black text-black"
        >
          Benutzer speichern
        </button>

        <div className="mt-4 divide-y divide-white/7">
          {state.users.map((row) => (
            <button
              key={row.id}
              onClick={() =>
                setUser({
                  id: row.id,
                  displayName: row.displayName,
                  username: row.username,
                  role: row.role,
                  canOrder: row.canOrder,
                })
              }
              className="flex w-full justify-between gap-3 py-2 text-left text-xs"
            >
              <span>
                {row.displayName} · @{row.username}
              </span>
              <span className="text-right text-white/35">
                {row.role === "ADMIN" ? "Admin" : row.canOrder ? "Chef · Bestellung" : "Chef"}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
