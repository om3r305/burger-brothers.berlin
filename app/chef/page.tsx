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

const CATEGORY_OPTIONS = [
  "Fleisch & Protein",
  "Chicken & Snacks",
  "Fries & Beilagen",
  "Brot",
  "Käse & Special",
  "Gemüse & Frische",
  "Saucen",
  "Boxen & Verpackung",
  "Verbrauch & Hygiene",
  "Diğer",
];

const glass =
  "border border-white/10 bg-white/[.055] shadow-[0_18px_50px_rgba(0,0,0,.28)] backdrop-blur-xl";

const fmt = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("tr-TR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";

async function api(body: Record<string, unknown>) {
  const response = await fetch("/api/chef", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(String(payload?.error || "İşlem başarısız"));
  }
  return payload;
}

function b64Key(value: string) {
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
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
      setError(reason instanceof Error ? reason.message : "Giriş başarısız");
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
              <div className="text-xs text-white/45">Burger Brothers · Chef Operations</div>
            </div>
          </div>

          <label className="text-xs text-white/50">
            Kullanıcı adı
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-base outline-none focus:border-amber-300/50"
            />
          </label>

          <div className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[.06] px-3 py-2.5 text-xs text-amber-100/70">
            PIN doğrulaması test süresince geçici olarak kapalı. Kullanıcı yetkileri yine hesaba göre uygulanır.
          </div>

          {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}

          <button
            disabled={busy || !username.trim()}
            className="mt-5 w-full rounded-xl bg-amber-300 py-3.5 font-black text-black disabled:opacity-50"
          >
            {busy ? "Giriş yapılıyor…" : "Giriş yap"}
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
  const [listening, setListening] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const rec = useRef<any>(null);

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
      if (!response.ok) throw new Error(payload?.error || "Yüklenemedi");
      setState(payload);
      setChecked(true);
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : "Bağlantı hatası");
      setChecked(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3200);
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
      const key = item?.supplierName || "Lieferant seçilmedi";
      map.set(key, [...(map.get(key) || []), need]);
    }
    return [...map.entries()];
  }, [state?.needs, itemMap]);

  const patch = (id: string, next: Draft) =>
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] || {}), ...next, checked: true },
    }));

  function voiceApply(text: string) {
    if (!state) return;
    const normalized = text.toLocaleLowerCase("tr-TR");
    let found = 0;

    for (const item of state.items) {
      const name = item.name.toLocaleLowerCase("tr-TR");
      const at = normalized.indexOf(name);
      if (at < 0) continue;
      const tail = normalized.slice(at + name.length, at + name.length + 70);

      if (item.mode === "QUANTITY") {
        const match = tail.match(/\b(\d+(?:[,.]\d+)?)\b/);
        if (match) {
          patch(item.id, { neededQty: match[1].replace(",", ".") });
          found += 1;
        }
      } else {
        const status = /\b(yok|bitti|leer|aus)\b/.test(tail)
          ? "OUT"
          : /kritik|çok az|cok az/.test(tail)
            ? "CRITICAL"
            : /\b(az|wenig|knapp)\b/.test(tail)
              ? "LOW"
              : null;
        if (status) {
          patch(item.id, { status });
          found += 1;
        }
      }
    }

    setToast(
      found
        ? `${found} malzeme sesten listeye işlendi.`
        : "Ürün adı yakalanamadı; elle kontrol edebilirsin.",
    );
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
      setToast("Bu tarayıcı konuşma tanımayı desteklemiyor.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "tr-TR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event: any) => {
      let text = "";
      for (let index = 0; index < event.results.length; index += 1) {
        text += `${event.results[index][0]?.transcript || ""} `;
      }
      setVoice(text.trim());
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    rec.current = recognition;
    recognition.start();
    setListening(true);
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

    if (!entries.length && !voice.trim()) {
      setToast("Önce en az bir malzeme güncelle.");
      return;
    }

    setBusy(true);
    try {
      await api({ action: "saveReport", entries, voiceTranscript: voice });
      setDrafts({});
      setVoice("");
      setToast("Kontrol kaydedildi; şef bildirimleri tetiklendi.");
      await load();
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : "Kaydedilemedi");
    } finally {
      setBusy(false);
    }
  }

  async function order(name: string, needs: Need[]) {
    const ids = needs
      .filter((need) => need.state === "OPEN" && selected[need.id])
      .map((need) => need.id);

    if (!ids.length) {
      setToast("Önce sipariş kalemlerini işaretle.");
      return;
    }

    setBusy(true);
    try {
      const payload = await api({ action: "placeOrder", needIds: ids });
      setToast(`${name}: sipariş ${state?.me.displayName} adına kaydedildi.`);
      window.open(String(payload.whatsappUrl), "_blank", "noopener,noreferrer");
      setSelected({});
      await load();
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : "Sipariş oluşturulamadı");
    } finally {
      setBusy(false);
    }
  }

  async function receive(ids: string[]) {
    setBusy(true);
    try {
      await api({ action: "receiveNeeds", needIds: ids });
      setToast("Gelen ürünler kapatıldı.");
      await load();
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : "Güncellenemedi");
    } finally {
      setBusy(false);
    }
  }

  async function push() {
    if (!state?.push.configured) {
      setToast("Push anahtarları canlı ortamda yapılandırılmamış.");
      return;
    }

    try {
      if (
        Notification.permission !== "granted" &&
        (await Notification.requestPermission()) !== "granted"
      ) {
        setToast("Bildirim izni verilmedi.");
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
      setToast("BB Chef bildirimleri bu cihazda açık.");
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : "Bildirim açılamadı");
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
              aria-label="Bildirim"
            >
              <Bell size={18} />
            </button>
            <button
              onClick={() => void logout()}
              className="rounded-xl border border-white/10 bg-white/5 p-2.5"
              aria-label="Çıkış"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-xl space-y-4 px-3 py-4">
        <div className="grid grid-cols-3 gap-2">
          <Stat n={open} t="Sipariş gerekli" />
          <Stat n={ordered} t="Sipariş verildi" />
          <Stat n={state.plans.length} t="Plan" />
        </div>

        {tab === "stock" ? (
          <section className="space-y-3">
            <div className={`rounded-[26px] p-4 ${glass}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-black">Akşam stok kontrolü</h2>
                  <p className="mt-1 text-xs text-white/45">
                    Gruba dokun, ürünü aç. Miktarlı üründe mevcut + gereken; diğerlerinde durum seç.
                  </p>
                </div>
                <button
                  onClick={toggleMic}
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${
                    listening ? "bg-rose-500" : "bg-amber-300 text-black"
                  }`}
                >
                  <Mic size={19} />
                </button>
              </div>

              {voice ? (
                <div className="mt-3 rounded-xl bg-black/30 p-3 text-xs text-white/60">
                  <div>{voice}</div>
                  <button
                    onClick={() => voiceApply(voice)}
                    className="mt-2 rounded-lg bg-white/10 px-3 py-2 font-bold text-white"
                  >
                    Sesi listeye uygula
                  </button>
                </div>
              ) : null}
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
                        {items.length} ürün{categoryOpenNeeds ? ` · ${categoryOpenNeeds} açık eksik` : ""}
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
                          <div key={item.id} className="p-4">
                            <div className="mb-3 flex items-start justify-between gap-2">
                              <div>
                                <div className="font-bold">{item.name}</div>
                                <div className="text-[11px] text-white/40">
                                  {need
                                    ? `Açık kayıt: ${need.createdByName} · ${fmt(need.createdAt)}`
                                    : "Açık eksik yok"}
                                </div>
                                {low ? (
                                  <div className="mt-1 text-[11px] font-bold text-orange-300">
                                    Stok limiti {item.minStock} {item.unit} altında
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
                                  {need.state === "ORDERED" ? "SİPARİŞ VERİLDİ" : "AÇIK"}
                                </span>
                              ) : null}
                            </div>

                            {item.mode === "QUANTITY" ? (
                              <div className="grid grid-cols-2 gap-2">
                                <Q
                                  label="Şu anda stokta"
                                  value={draft.currentQty ?? ""}
                                  unit={item.unit}
                                  change={(value) => patch(item.id, { currentQty: value })}
                                />
                                <Q
                                  label="Sipariş lazım"
                                  value={draft.neededQty ?? ""}
                                  unit={item.unit}
                                  gold
                                  change={(value) => patch(item.id, { neededQty: value })}
                                />
                              </div>
                            ) : (
                              <div className="grid grid-cols-4 gap-1.5">
                                {[
                                  ["", "Yeterli"],
                                  ["LOW", "Az"],
                                  ["CRITICAL", "Kritik"],
                                  ["OUT", "Yok"],
                                ].map(([value, label]) => (
                                  <button
                                    key={label}
                                    onClick={() =>
                                      patch(item.id, { status: value as Draft["status"] })
                                    }
                                    className={`rounded-xl px-1 py-2 text-[11px] font-bold ${
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
              <Save size={18} /> Kontrolü kaydet
            </button>
          </section>
        ) : null}

        {tab === "orders" ? (
          <section className="space-y-4">
            <div className={`rounded-[26px] p-4 ${glass}`}>
              <h2 className="font-black">Sipariş merkezi</h2>
              <p className="mt-1 text-xs text-white/45">
                Kaydeden ve siparişi veren kişi ayrı ayrı görünür.
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
                          {openNeeds.length} açık · {doneNeeds.length} gönderildi
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
                                <b>{item?.name || "Ürün"}</b>
                                <b className="text-amber-200">
                                  {need.neededQty != null
                                    ? `${need.neededQty} ${item?.unit || ""}`
                                    : need.status || "BESTELLEN"}
                                </b>
                              </div>
                              <div className="mt-1 text-[11px] text-white/45">
                                Kaydeden: <b className="text-white/70">{need.createdByName}</b> ·{" "}
                                {fmt(need.createdAt)}
                              </div>
                              {need.currentQty != null ? (
                                <div className="text-[11px] text-white/35">
                                  Mevcut: {need.currentQty} {item?.unit}
                                </div>
                              ) : null}
                              {need.orderedByName ? (
                                <div className="mt-1 text-[11px] font-bold text-sky-300">
                                  Siparişi veren: {need.orderedByName} · {fmt(need.orderedAt)}
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
                        <PackageCheck size={16} /> Gelenleri kapat
                      </button>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <Empty text="Açık sipariş kalemi yok." />
            )}
          </section>
        ) : null}

        {tab === "plans" ? <Plans state={state} reload={load} tell={setToast} /> : null}
        {tab === "admin" && state.me.role === "ADMIN" ? (
          <Admin state={state} reload={load} tell={setToast} />
        ) : null}

        {state.activity.length ? (
          <div className={`rounded-[26px] p-4 ${glass}`}>
            <div className="mb-2 text-xs font-black text-white/50">Son hareketler</div>
            {state.activity.slice(0, 6).map((activity) => (
              <div
                key={activity.id}
                className="flex justify-between gap-2 border-t border-white/5 py-2 text-[11px]"
              >
                <span>
                  <b>{activity.actorName}</b>
                  <span className="text-white/45"> · {activity.detail}</span>
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
          <Nav
            active={tab === "stock"}
            icon={<Boxes size={19} />}
            label="Stok"
            on={() => setTab("stock")}
          />
          <Nav
            active={tab === "orders"}
            icon={<MessageCircle size={19} />}
            label={`Sipariş${open ? ` ${open}` : ""}`}
            on={() => setTab("orders")}
          />
          <Nav
            active={tab === "plans"}
            icon={<CalendarDays size={19} />}
            label="Plan"
            on={() => setTab("plans")}
          />
          {state.me.role === "ADMIN" ? (
            <Nav
              active={tab === "admin"}
              icon={<Settings size={19} />}
              label="Admin"
              on={() => setTab("admin")}
            />
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
      tell("Hazırlık planı kaydedildi.");
      await reload();
    } catch (reason) {
      tell(reason instanceof Error ? reason.message : "Plan kaydedilemedi");
    }
  }

  async function complete(id: string) {
    try {
      await api({ action: "completePlan", id });
      tell("Hazırlık tamamlandı.");
      await reload();
    } catch (reason) {
      tell(reason instanceof Error ? reason.message : "Kapatılamadı");
    }
  }

  return (
    <section className="space-y-4">
      <div className={`rounded-[26px] p-4 ${glass}`}>
        <div className="mb-3 flex items-center gap-2 font-black">
          <CalendarDays size={18} /> Hazırlık planla
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
            placeholder="Not (opsiyonel)"
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 outline-none"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-white/60">
          <label>
            <input
              type="checkbox"
              checked={form.remindDayBefore}
              onChange={(event) =>
                setForm({ ...form, remindDayBefore: event.target.checked })
              }
            />{" "}
            1 gün önce
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.remindSameDay}
              onChange={(event) => setForm({ ...form, remindSameDay: event.target.checked })}
            />{" "}
            O gün
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.recurrence === "WEEKLY"}
              onChange={(event) =>
                setForm({ ...form, recurrence: event.target.checked ? "WEEKLY" : "NONE" })
              }
            />{" "}
            Haftalık
          </label>
        </div>
        <button
          onClick={() => void savePlan()}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-300 py-3 font-black text-black"
        >
          <Plus size={17} /> Plan ekle
        </button>
      </div>

      {state.plans.map((plan) => (
        <div key={plan.id} className={`rounded-[26px] p-4 ${glass}`}>
          <div className="flex justify-between gap-3">
            <div>
              <div className="text-lg font-black">{plan.title}</div>
              <div className="text-sm font-bold text-amber-200">{plan.scheduledDate}</div>
              <div className="text-[11px] text-white/42">
                Planlayan: {plan.createdByName}
                {plan.recurrence === "WEEKLY" ? " · Haftalık" : ""}
              </div>
              {plan.note ? <p className="mt-2 text-sm text-white/60">{plan.note}</p> : null}
            </div>
            <button
              onClick={() => void complete(plan.id)}
              className="h-fit rounded-xl bg-emerald-400 px-3 py-2 text-xs font-black text-black"
            >
              Hazırlandı ✓
            </button>
          </div>
        </div>
      ))}
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
    category: "Fries & Beilagen",
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
      tell("Ürün kaydedildi.");
      await reload();
    } catch (reason) {
      tell(reason instanceof Error ? reason.message : "Ürün kaydedilemedi");
    }
  }

  async function removeItem(id: string, name: string) {
    if (!window.confirm(`${name} stok listesinden kaldırılsın mı?`)) return;
    try {
      await api({ action: "deleteItem", id });
      if (item.id === id) setItem(emptyItem);
      tell(`${name} kaldırıldı.`);
      await reload();
    } catch (reason) {
      tell(reason instanceof Error ? reason.message : "Ürün kaldırılamadı");
    }
  }

  async function saveUser() {
    try {
      await api({ action: "upsertUser", user });
      setUser({
        id: "",
        displayName: "",
        username: "",
        role: "CHEF",
        canOrder: false,
      });
      tell("Kullanıcı kaydedildi.");
      await reload();
    } catch (reason) {
      tell(reason instanceof Error ? reason.message : "Kullanıcı kaydedilemedi");
    }
  }

  return (
    <section className="space-y-4">
      <div className={`rounded-[26px] p-4 ${glass}`}>
        <div className="mb-1 flex items-center gap-2 font-black">
          <Settings size={18} /> Ürün yönetimi
        </div>
        <p className="mb-3 text-xs text-white/45">
          Ana grup seç; ürün adı altında görünür. Box ölçüsü/modeli gibi ayrıntıyı ürün adına yazabilirsin.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <input
            value={item.name}
            onChange={(event) => setItem({ ...item, name: event.target.value })}
            placeholder="Ürün adı / model / ölçü"
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
            <option value="QUANTITY">Miktar</option>
            <option value="STATUS">Durum</option>
          </select>
          <input
            value={item.unit}
            onChange={(event) => setItem({ ...item, unit: event.target.value })}
            placeholder="Birim: Karton/Kiste"
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"
          />
          <input
            value={item.minStock}
            onChange={(event) => setItem({ ...item, minStock: event.target.value })}
            placeholder="Stok limiti"
            inputMode="decimal"
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"
          />
          <input
            value={item.defaultOrderQty}
            onChange={(event) => setItem({ ...item, defaultOrderQty: event.target.value })}
            placeholder="Varsayılan sipariş"
            inputMode="decimal"
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"
          />
          <input
            value={item.supplierName}
            onChange={(event) => setItem({ ...item, supplierName: event.target.value })}
            placeholder="Firma adı"
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
            Yeni ürün
          </button>
          <button
            onClick={() => void saveItem()}
            className="rounded-xl bg-amber-300 py-3 font-black text-black"
          >
            {item.id ? "Değişikliği kaydet" : "Ürünü ekle"}
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
                        {row.mode === "QUANTITY" ? `Miktar · ${row.unit || "birim yok"}` : "Durum"}
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
                      aria-label={`${row.name} düzenle`}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => void removeItem(row.id, row.name)}
                      className="rounded-lg bg-rose-500/10 p-2 text-rose-300"
                      aria-label={`${row.name} kaldır`}
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
          <Users size={18} /> Şef kullanıcıları
        </div>
        <p className="mb-3 text-xs text-white/45">
          PIN şu an kapalı. Normal Chef hesabı Admin sekmesini göremez. “Sipariş verebilir” yalnızca seçili şeflere açılır.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <input
            value={user.displayName}
            onChange={(event) => setUser({ ...user, displayName: event.target.value })}
            placeholder="İsim"
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"
          />
          <input
            value={user.username}
            onChange={(event) => setUser({ ...user, username: event.target.value })}
            placeholder="Kullanıcı adı"
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
            Sipariş verebilir
          </label>
        </div>

        <button
          onClick={() => void saveUser()}
          className="mt-3 w-full rounded-xl bg-amber-300 py-3 font-black text-black"
        >
          Kullanıcıyı kaydet
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
                {row.role === "ADMIN" ? "Admin" : row.canOrder ? "Chef · Sipariş" : "Chef"}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
