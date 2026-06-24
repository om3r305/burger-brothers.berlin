// app/admin/settings/page.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { WeekSchedule, TimeRange } from "@/lib/settings";
import { LS_SETTINGS, readSettings } from "@/lib/settings";


  //const [schema, setSchema] = useState<any | null>(null);
  //useEffect(() => {
    //import("@/config/settings.schema.json")
      //.then((m) => setSchema(m.default || m))
      //.catch(() => setSchema(null));
  //}, []);
/* ───────────────────────── constants ───────────────────────── */
const CATS = [
  "burger",
  "vegan",
  "extras",
  "sauces",
  "drinks",
  "hotdogs",
  "donuts",
  "bubbleTea",
] as const;

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_LABELS: Record<(typeof DAY_KEYS)[number], string> = {
  mon: "Montag",
  tue: "Dienstag",
  wed: "Mittwoch",
  thu: "Donnerstag",
  fri: "Freitag",
  sat: "Samstag",
  sun: "Sonntag",
};
const DAY_ABBR: Record<
  (typeof DAY_KEYS)[number],
  "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"
> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

/* ─────────────────────── debounced autosave ─────────────────────── */
function useDebouncedAutosave(model: any, enabled: boolean, delay = 300) {
  const tRef = useRef<number | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (!enabled) return;
    if (first.current) {
      first.current = false;
      return;
    }
    if (tRef.current) window.clearTimeout(tRef.current);
    tRef.current = window.setTimeout(() => {
      try {
        const next = normalizeForSave(model);
        localStorage.setItem(LS_SETTINGS, JSON.stringify(next));
        try {
          window.dispatchEvent(
            new StorageEvent("storage", {
              key: LS_SETTINGS,
              newValue: JSON.stringify(next),
            })
          );
        } catch {}
        window.dispatchEvent(new CustomEvent("bb_settings_changed", { detail: next }));
      } catch {}
    }, delay);
    return () => {
      if (tRef.current) window.clearTimeout(tRef.current);
    };
  }, [model, enabled, delay]);
}

/* ───────────────────── helper: hours plan <-> week ───────────────────── */
type PlanEntry = { day: string; open: string; close: string };

function toWeekScheduleFromPlan(plan?: {
  pickup?: PlanEntry[];
  delivery?: PlanEntry[];
}): {
  pickup?: WeekSchedule;
  delivery?: WeekSchedule;
} {
  if (!plan) return {};
  const parse = (arr?: PlanEntry[]) => {
    const ws: WeekSchedule = {};
    if (!Array.isArray(arr)) return ws;
    arr.forEach((p) => {
      const days = p.day.includes("-")
        ? DAY_KEYS
        : (Object.entries(DAY_ABBR).find(([, ab]) => ab === (p.day as any))?.[0] as
            | (typeof DAY_KEYS)[number]
            | undefined)
        ? [
            (Object.entries(DAY_ABBR).find(([, ab]) => ab === (p.day as any))![0] as
              (typeof DAY_KEYS)[number]),
          ]
        : [];
      days.forEach((dk) => {
        const list = ws[dk] || [];
        list.push({ start: p.open, end: p.close });
        ws[dk] = list;
      });
    });
    return ws;
  };
  return { pickup: parse(plan.pickup), delivery: parse(plan.delivery) };
}

function toPlanFromWeekSchedule(week?: {
  pickup?: WeekSchedule;
  delivery?: WeekSchedule;
}) {
  const build = (ws?: WeekSchedule): PlanEntry[] => {
    if (!ws) return [];
    const out: PlanEntry[] = [];
    DAY_KEYS.forEach((dk) => {
      const ranges = ws[dk] || [];
      ranges.forEach((r) => out.push({ day: DAY_ABBR[dk], open: r.start, close: r.end }));
    });
    return out;
  };
  return { pickup: build(week?.pickup), delivery: build(week?.delivery) };
}

/* ─────────────── normalize & defaults (kayda gitmeden önce) ─────────────── */
function normalizeForSave(raw: any) {
  const m = raw || {};
  const next: any = { ...m };

  // Validation
  next.validation = {
    ...(next.validation || {}),
    phoneDigits: Number(next.validation?.phoneDigits ?? 11),
    nameCapitalizeFirst: !!next.validation?.nameCapitalizeFirst,
  };

  // Hours normalize + mirror
  const tz = next.hours?.tz || next.hours?.timezone || "Europe/Berlin";
  const week: { pickup?: WeekSchedule; delivery?: WeekSchedule } = {
    pickup: next.hours?.pickup,
    delivery: next.hours?.delivery,
  };
  const plan = next.hours?.plan || toPlanFromWeekSchedule(week);

  const deliverySlot = Number(
    next.hours?.slotMinutesDelivery ?? next.hours?.slotMinutes ?? 15
  );
  const pickupSlot = Number(
    next.hours?.slotMinutesPickup ?? next.hours?.slotMinutes ?? 15
  );

  next.hours = {
    tz,
    timezone: tz,
    slotMinutes: deliverySlot,
    slotMinutesDelivery: deliverySlot,
    slotMinutesPickup: pickupSlot,
    daysAhead: Number(next.hours?.daysAhead ?? 0),
    allowPreorder: !!next.hours?.allowPreorder,
    avgPickupMinutes: Number(next.hours?.avgPickupMinutes ?? 10),
    avgDeliveryMinutes: Number(next.hours?.avgDeliveryMinutes ?? 35),
    plan,
    pickup: week.pickup,
    delivery: week.delivery,
  };

  // Yeni indirim alanları + geri uyumluluk
  const deliveryDR = Number(next.delivery?.discountRate ?? next.discount?.lifaRate ?? 0);
  const pickupDR = Number(next.pickup?.discountRate ?? next.discount?.apollonRate ?? 0);

  next.delivery = {
    ...(next.delivery || {}),
    discountRate: deliveryDR,
    surcharges: { ...(next.delivery?.surcharges || {}) },
    minOrderAfterDiscountByPLZ: {
      ...(next.delivery?.minOrderAfterDiscountByPLZ || {}),
    },
  };

  next.pickup = {
    ...(next.pickup || {}),
    discountRate: pickupDR,
  };

  next.discount = {
    lifaRate: deliveryDR,
    apollonRate: pickupDR,
  };

  // Printing
  next.printing = {
    logoUrl: next.printing?.logoUrl ?? "/logo.png",
    footerHinweise: next.printing?.footerHinweise ?? "Vielen Dank!",
    paper: next.printing?.paper ?? "80mm",
    showBarcode: !!next.printing?.showBarcode,
    showQR: !!next.printing?.showQR,
    groupingOrder:
      Array.isArray(next.printing?.groupingOrder) && next.printing?.groupingOrder.length
        ? next.printing.groupingOrder
        : ["burger", "vegan", "hotdogs", "extras", "drinks", "sauces"],
  };

  // Colors
  next.colors = {
    ...(next.colors || {}),
    statusColors: {
      eingegangen: next.colors?.statusColors?.eingegangen ?? "#38bdf8",
      zubereitung: next.colors?.statusColors?.zubereitung ?? "#f59e0b",
      abholbereit: next.colors?.statusColors?.abholbereit ?? "#10b981",
      unterwegs: next.colors?.statusColors?.unterwegs ?? "#22d3ee",
      abgeschlossen: next.colors?.statusColors?.abgeschlossen ?? "#9ca3af",
      storniert: next.colors?.statusColors?.storniert ?? "#ef4444",
    },
    modeColors: {
      pickup: next.colors?.modeColors?.pickup ?? "#60a5fa",
      delivery: next.colors?.modeColors?.delivery ?? "#a78bfa",
    },
  };

  // Announcements (items + tarih alanları)
  next.announcements = {
    enabled: !!next.announcements?.enabled,
    items: (next.announcements?.items || []).map((it: any) => ({
      title: it?.title || "",
      text: it?.text || "",
      imageUrl: it?.imageUrl || "",
      ctaLabel: it?.ctaLabel || "",
      ctaHref: it?.ctaHref || "",
      enabled: it?.enabled !== false,
      startsAt: it?.startsAt ? new Date(it.startsAt).toISOString() : "",
      endsAt: it?.endsAt ? new Date(it.endsAt).toISOString() : "",
    })),
  };

  // Telegram / Contact
  next.telegram = {
    enabled: !!next.telegram?.enabled,
    botToken: next.telegram?.botToken || "",
    chatId: next.telegram?.chatId || "",
  };
  next.contact = {
    phone: next.contact?.phone || "",
    email: next.contact?.email || "",
    address: next.contact?.address || "",
    whatsappNumber: next.contact?.whatsappNumber || "",
  };

  // Features / Tracking
  next.features = {
    bubbleTea: { enabled: !!next.features?.bubbleTea?.enabled },
    donuts: { enabled: !!next.features?.donuts?.enabled },
  };
  next.tracking = {
    enabled: !!next.tracking?.enabled,
    showEtaClock: !!next.tracking?.showEtaClock,
  };

  // Freebies mirror
  next.offers = next.offers || {};
  next.offers.freebies = { ...(next.freebies || next.offers.freebies || {}) };

  // Dashboard
  next.dashboard = {
    password: String(next.dashboard?.password ?? ""),
    pollSeconds: Number(next.dashboard?.pollSeconds ?? 3),
    targets: {
      deliveryMins: Number(next.dashboard?.targets?.deliveryMins ?? 30),
      pickupMins: Number(next.dashboard?.targets?.pickupMins ?? 15),
    },
    sound: {
      newOrder: String(next.dashboard?.sound?.newOrder ?? ""),
    },
  };

  // Site status (DE – kapalı mesajı + zaman aralığı)
  next.site = {
    closed: !!next.site?.closed,
    message: String(next.site?.message ?? ""),
    maintenanceStart: next.site?.maintenanceStart
      ? new Date(next.site.maintenanceStart).toISOString()
      : "",
    maintenanceEnd: next.site?.maintenanceEnd
      ? new Date(next.site.maintenanceEnd).toISOString()
      : "",
  };

  return next;
}

/* ───────────────────────── UI helpers ───────────────────────── */
function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-stone-300/90">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`inline-flex h-6 w-11 items-center rounded-full transition ${
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
        } ${checked ? "bg-emerald-500" : "bg-stone-600"}`}
      >
        <span
          className={`ml-0.5 inline-block h-5 w-5 transform rounded-full bg-white transition ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-stone-300/80">{label}</span>
      {children}
    </label>
  );
}

/* ───────────────────────── Page ───────────────────────── */
export default function AdminSettingsPage() {
  const [mounted, setMounted] = useState(false);
  const [model, setModel] = useState<any>(null);

  useEffect(() => {
    setMounted(true);
    try {
      const s = readSettings() as any;
      const wk = toWeekScheduleFromPlan(s?.hours?.plan);
      const init = normalizeForSave({
        ...s,
        hours: {
          ...(s?.hours || {}),
          pickup: s?.hours?.pickup || wk.pickup,
          delivery: s?.hours?.delivery || wk.delivery,
          tz: s?.hours?.tz || s?.hours?.timezone || "Europe/Berlin",
          timezone: s?.hours?.timezone || s?.hours?.tz || "Europe/Berlin",
        },
      });
      setModel(init);
    } catch {
      setModel(normalizeForSave({}));
    }
  }, []);

  useDebouncedAutosave(model, mounted, 400);

  const doExport = () => {
    const blob = new Blob([JSON.stringify(normalizeForSave(model), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "settings.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    try {
      const txt = await f.text();
      const obj = JSON.parse(txt);
      setModel(normalizeForSave(obj));
      ev.target.value = "";
      alert("Settings import edildi ✅");
    } catch (e: any) {
      ev.target.value = "";
      alert("Import hatası: " + (e?.message || ""));
    }
  };

  const saveNow = () => {
    try {
      const next = normalizeForSave(model);
      localStorage.setItem(LS_SETTINGS, JSON.stringify(next));
      try {
        window.dispatchEvent(
          new StorageEvent("storage", { key: LS_SETTINGS, newValue: JSON.stringify(next) })
        );
      } catch {}
      window.dispatchEvent(new CustomEvent("bb_settings_changed", { detail: next }));
      alert("Kaydedildi ✅");
    } catch (e: any) {
      alert("Kaydedilemedi: " + (e?.message || ""));
    }
  };

  if (!mounted || model == null) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-semibold">Ayarlar (Settings)</h1>
            <span className="text-sm text-stone-400">yükleniyor…</span>
          </div>
          <div className="h-9 w-40 rounded-md bg-stone-800/50" />
        </div>
        <div className="grid gap-6">
          <div className="h-40 rounded-xl bg-stone-900/50" />
          <div className="h-72 rounded-xl bg-stone-900/50" />
          <div className="h-60 rounded-xl bg-stone-900/50" />
        </div>
      </main>
    );
  }

  const m = model as any;

  const setNested = (path: string[], value: any) =>
    setModel((x: any) => {
      const n = { ...(x || {}) };
      let cur: any = n;
      for (let i = 0; i < path.length - 1; i++)
        (cur[path[i]] = { ...(cur[path[i]] || {}) }), (cur = cur[path[i]]);
      cur[path[path.length - 1]] = value;
      return n;
    });

  return (
    <main className="mx-auto max-w-6xl p-6">
      {/* HEADER */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold">Ayarlar (Settings)</h1>
          <Link href="/admin" className="text-sm text-stone-300 hover:text-stone-100">
            ← Admin
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={doExport}>
            Export
          </button>
          <label className="btn-ghost cursor-pointer">
            Import
            <input type="file" accept="application/json,.json" hidden onChange={doImport} />
          </label>
          <button className="pill" onClick={saveNow}>
            Kaydet
          </button>
        </div>
      </div>

      <div className="grid gap-6">
        {/* SITE STATUS */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Site Durumu</div>
          <div className="flex items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!m.site?.closed}
                onChange={(e) => setNested(["site", "closed"], e.target.checked)}
              />
              Site Kapalı (bakım)
            </label>
          </div>
          <Field label="Duyuru (kapalıyken) – Almanca">
            <input
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              value={m.site?.message || ""}
              onChange={(e) => setNested(["site", "message"], e.target.value)}
              placeholder='z. B. "Wegen Wartungsarbeiten vorübergehend geschlossen. Wir öffnen heute um 18:00 Uhr."'
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 mt-2">
            <Field label="Bakım Başlangıç (opsiyonel)">
              <DateTimeWithPicker
                valueISO={m.site?.maintenanceStart || ""}
                onChangeISO={(v) => setNested(["site", "maintenanceStart"], v)}
              />
            </Field>
            <Field label="Bakım Bitiş (opsiyonel)">
              <DateTimeWithPicker
                valueISO={m.site?.maintenanceEnd || ""}
                onChangeISO={(v) => setNested(["site", "maintenanceEnd"], v)}
              />
            </Field>
          </div>
        </section>

        {/* FEATURES & TRACKING */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Özellikler & Tracking</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-md border border-stone-700/60 p-3">
              <div className="mb-2 font-medium">Features</div>
              <div className="space-y-2">
                <Toggle
                  label="Bubble Tea aktiv"
                  checked={!!m.features?.bubbleTea?.enabled}
                  onChange={(v) => setNested(["features", "bubbleTea", "enabled"], v)}
                />
                <Toggle
                  label="Donuts aktiv"
                  checked={!!m.features?.donuts?.enabled}
                  onChange={(v) => setNested(["features", "donuts", "enabled"], v)}
                />
              </div>
            </div>
            <div className="rounded-md border border-stone-700/60 p-3">
              <div className="mb-2 font-medium">Tracking</div>
              <div className="space-y-2">
                <Toggle
                  label="Tracking aktiv"
                  checked={!!m.tracking?.enabled}
                  onChange={(v) => setNested(["tracking", "enabled"], v)}
                />
                <Toggle
                  label="ETA saatini göster"
                  checked={!!m.tracking?.showEtaClock}
                  onChange={(v) => setNested(["tracking", "showEtaClock"], v)}
                />
              </div>
            </div>
          </div>
        </section>

        {/* VALIDATION */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Form Doğrulama</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Telefon hanesi">
              <input
                type="number"
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={String(m.validation?.phoneDigits ?? 11)}
                onChange={(e) =>
                  setNested(["validation", "phoneDigits"], Number(e.target.value || 0))
                }
              />
            </Field>
            <div className="flex items-end">
              <Toggle
                label="İsim ilk harf büyük"
                checked={!!m.validation?.nameCapitalizeFirst}
                onChange={(v) => setNested(["validation", "nameCapitalizeFirst"], v)}
              />
            </div>
          </div>
        </section>

        {/* PRICING */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Fiyatlandırma (Lifa / Delivery)</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="İndirim Oranı (Lifa — Delivery)  (0.10 = %10)">
              <input
                type="number"
                step="0.01"
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={String(m.delivery?.discountRate ?? 0)}
                onChange={(e) =>
                  setNested(["delivery", "discountRate"], Number(e.target.value || 0))
                }
              />
            </Field>
            <Field label="İndirim Oranı (Apollon — Pickup)  (0.10 = %10)">
              <input
                type="number"
                step="0.01"
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={String(m.pickup?.discountRate ?? 0)}
                onChange={(e) => setNested(["pickup", "discountRate"], Number(e.target.value || 0))}
              />
            </Field>
          </div>

          <div className="mt-3">
            <div className="mb-2 text-sm opacity-80">Etageegori Bazlı Sürşarj (Sadece Delivery)</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {CATS.map((cat) => (
                <div key={cat} className="flex items-center gap-2">
                  <div className="w-36 text-sm">{cat.toUpperCase()}</div>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                    value={String(m.delivery?.surcharges?.[cat] ?? "")}
                    onChange={(e) => {
                      const val = Number(e.target.value || 0);
                      setNested(["delivery", "surcharges"], {
                        ...(m.delivery?.surcharges || {}),
                        [cat]: val,
                      });
                    }}
                    placeholder="Örn: 1.0"
                  />
                </div>
              ))}
            </div>
          </div>

          <PLZTable
            value={m.delivery?.minOrderAfterDiscountByPLZ || {}}
            onChange={(v) => setNested(["delivery", "minOrderAfterDiscountByPLZ"], v)}
          />
        </section>

        {/* FREEBIES */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Ücretsiz Ürün Kuralı (Freebie)</div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!m.freebies?.enabled}
                onChange={(e) => setNested(["freebies", "enabled"], e.target.checked)}
              />
              Aktif
            </label>
            <label className="text-sm">
              <span className="mr-2 opacity-80">Etageegori</span>
              <select
                className="rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.freebies?.category || "sauces"}
                onChange={(e) => setNested(["freebies", "category"], e.target.value)}
              >
                <option value="sauces">Soßen</option>
                <option value="drinks">Getränke</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mr-2 opacity-80">Mod</span>
              <select
                className="rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.freebies?.mode || "both"}
                onChange={(e) => setNested(["freebies", "mode"], e.target.value)}
              >
                <option value="delivery">Lifa (Delivery)</option>
                <option value="pickup">Apollon (Pickup)</option>
                <option value="both">Her ikisi</option>
              </select>
            </label>
          </div>
          <div className="mt-3">
            <div className="mb-2 text-sm opacity-80">Eşikler</div>
            <TierEditor
              value={m.freebies?.tiers || []}
              onChange={(tiers) => setNested(["freebies", "tiers"], tiers)}
            />
          </div>
        </section>

        {/* THEME / BRAND */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Tema & Marka</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Aktif Tema">
              <select
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.theme?.active || "classic"}
                onChange={(e) => setNested(["theme", "active"], e.target.value)}
              >
                <option value="classic">Classic</option>
                <option value="neon">Neon</option>
                <option value="christmas">Christmas</option>
                <option value="halloween">Halloween</option>
              </select>
            </Field>

            <Field label="Arka Plan Video URL (.mp4)">
              <input
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.theme?.bgVideoUrl || ""}
                onChange={(e) => setNested(["theme", "bgVideoUrl"], e.target.value)}
                placeholder="https://.../background.mp4"
              />
            </Field>

            <div className="md:col-span-2 grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Logo (Classic) URL">
                <input
                  className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                  value={m.theme?.logos?.classic || ""}
                  onChange={(e) =>
                    setNested(["theme", "logos"], {
                      ...(m.theme?.logos || {}),
                      classic: e.target.value,
                    })
                  }
                  placeholder="/logo-classic.png"
                />
              </Field>
              <Field label="Logo (Neon) URL">
                <input
                  className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                  value={m.theme?.logos?.neon || ""}
                  onChange={(e) =>
                    setNested(["theme", "logos"], { ...(m.theme?.logos || {}), neon: e.target.value })
                  }
                  placeholder="/logo-neon.png"
                />
              </Field>
              <Field label="Logo (Christmas) URL">
                <input
                  className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                  value={m.theme?.logos?.christmas || ""}
                  onChange={(e) =>
                    setNested(["theme", "logos"], {
                      ...(m.theme?.logos || {}),
                      christmas: e.target.value,
                    })
                  }
                  placeholder="/logo-christmas.png"
                />
              </Field>
              <Field label="Logo (Halloween) URL">
                <input
                  className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                  value={m.theme?.logos?.halloween || ""}
                  onChange={(e) =>
                    setNested(["theme", "logos"], {
                      ...(m.theme?.logos || {}),
                      halloween: e.target.value,
                    })
                  }
                  placeholder="/logo-halloween.png"
                />
              </Field>
            </div>

            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!m.theme?.snow}
                  onChange={(e) => setNested(["theme", "snow"], e.target.checked)}
                />
                Christmas: Kar efekti
              </label>
            </div>
          </div>
        </section>

        {/* HOURS / OPENING */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Çalışma Saatleri & Planlı Sipariş</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Saat Dilimi (IANA)">
              <input
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.hours?.tz || m.hours?.timezone || "Europe/Berlin"}
                onChange={(e) => {
                  setNested(["hours", "tz"], e.target.value);
                  setNested(["hours", "timezone"], e.target.value);
                }}
                placeholder="Europe/Berlin"
              />
            </Field>

            <Field label="Slot Süresi (Lifa — Delivery, dakika)">
              <input
                type="number"
                step={1}
                min={1}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={String(m.hours?.slotMinutesDelivery ?? m.hours?.slotMinutes ?? 15)}
                onChange={(e) =>
                  setNested(
                    ["hours", "slotMinutesDelivery"],
                    Math.max(1, Number(e.target.value || 15))
                  )
                }
              />
            </Field>
            <Field label="Slot Süresi (Apollon — Pickup, dakika)">
              <input
                type="number"
                step={1}
                min={1}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={String(m.hours?.slotMinutesPickup ?? m.hours?.slotMinutes ?? 15)}
                onChange={(e) =>
                  setNested(
                    ["hours", "slotMinutesPickup"],
                    Math.max(1, Number(e.target.value || 15))
                  )
                }
              />
            </Field>

            <Field label="Ön Sipariş (allowPreorder)">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!m.hours?.allowPreorder}
                  onChange={(e) => setNested(["hours", "allowPreorder"], e.target.checked)}
                />
                Aktif
              </label>
            </Field>
            <Field label="İleri Plan Gün (daysAhead)">
              <input
                type="number"
                step={1}
                min={0}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={String(m.hours?.daysAhead ?? 0)}
                onChange={(e) =>
                  setNested(["hours", "daysAhead"], Math.max(0, Number(e.target.value || 0)))
                }
              />
            </Field>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <div className="mb-2 font-medium">Abholung (Pickup)</div>
              <HoursEditor
                value={m.hours?.pickup}
                onChange={(ws) => {
                  setNested(["hours", "pickup"], ws);
                  const plan = toPlanFromWeekSchedule({
                    pickup: ws,
                    delivery: m.hours?.delivery,
                  });
                  setNested(["hours", "plan"], {
                    ...(m.hours?.plan || {}),
                    pickup: plan.pickup,
                    delivery: plan.delivery,
                  });
                }}
              />
            </div>
            <div>
              <div className="mb-2 font-medium">Lieferung (Delivery)</div>
              <HoursEditor
                value={m.hours?.delivery}
                onChange={(ws) => {
                  setNested(["hours", "delivery"], ws);
                  const plan = toPlanFromWeekSchedule({
                    pickup: m.hours?.pickup,
                    delivery: ws,
                  });
                  setNested(["hours", "plan"], {
                    ...(m.hours?.plan || {}),
                    pickup: plan.pickup,
                    delivery: plan.delivery,
                  });
                }}
              />
            </div>
          </div>
        </section>

        {/* PRINTING */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Yazdırma (Printing)</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Logo URL">
              <input
                value={m.printing?.logoUrl || ""}
                onChange={(e) => setNested(["printing", "logoUrl"], e.target.value)}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              />
            </Field>
            <Field label="Alt not">
              <input
                value={m.printing?.footerHinweise || ""}
                onChange={(e) => setNested(["printing", "footerHinweise"], e.target.value)}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              />
            </Field>
            <Field label="Kağıt">
              <select
                value={m.printing?.paper || "80mm"}
                onChange={(e) => setNested(["printing", "paper"], e.target.value)}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              >
                <option value="80mm">80mm</option>
                <option value="A5">A5</option>
                <option value="A4">A4</option>
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Toggle
                label="Barkod göster"
                checked={!!m.printing?.showBarcode}
                onChange={(v) => setNested(["printing", "showBarcode"], v)}
              />
              <Toggle
                label="Adresse QR göster"
                checked={!!m.printing?.showQR}
                onChange={(v) => setNested(["printing", "showQR"], v)}
              />
            </div>
          </div>

          <div className="mt-3">
            <div className="mb-2 text-sm opacity-80">Grup Sırası</div>
            <GroupingEditor
              value={m.printing?.groupingOrder || []}
              onChange={(v) => setNested(["printing", "groupingOrder"], v)}
            />
          </div>
        </section>

        {/* COLORS */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Renkler</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ColorEditor
              title="Status Renkleri"
              value={m.colors?.statusColors || {}}
              onChange={(v) => setNested(["colors", "statusColors"], v)}
              keys={[
                ["eingegangen", "Eingegangen"],
                ["zubereitung", "Zubereitung"],
                ["abholbereit", "Abholbereit"],
                ["unterwegs", "Unterwegs"],
                ["abgeschlossen", "Abgeschlossen"],
                ["storniert", "Storniert"],
              ]}
            />
            <ColorEditor
              title="Mod Renkleri"
              value={m.colors?.modeColors || {}}
              onChange={(v) => setNested(["colors", "modeColors"], v)}
              keys={[
                ["pickup", "Pickup"],
                ["delivery", "Delivery"],
              ]}
            />
          </div>
        </section>

        {/* DASHBOARD */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Dashboard</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Parola (Dashboard erişim)">
              <input
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.dashboard?.password || ""}
                onChange={(e) => setNested(["dashboard", "password"], e.target.value)}
                placeholder="örn: 1234"
              />
            </Field>
            <Field label="Yenileme (saniye)">
              <input
                type="number"
                min={1}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={String(m.dashboard?.pollSeconds ?? 3)}
                onChange={(e) =>
                  setNested(["dashboard", "pollSeconds"], Math.max(1, Number(e.target.value || 3)))
                }
              />
            </Field>
            <Field label="Yeni Sipariş Sesi (URL)">
              <input
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.dashboard?.sound?.newOrder || ""}
                onChange={(e) =>
                  setNested(["dashboard", "sound"], {
                    ...(m.dashboard?.sound || {}),
                    newOrder: e.target.value,
                  })
                }
                placeholder="/sounds/new-order.mp3"
              />
            </Field>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Hedef Süre (Delivery, dakika)">
              <input
                type="number"
                min={1}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={String(m.dashboard?.targets?.deliveryMins ?? 30)}
                onChange={(e) =>
                  setNested(["dashboard", "targets"], {
                    ...(m.dashboard?.targets || {}),
                    deliveryMins: Math.max(1, Number(e.target.value || 30)),
                    pickupMins: Number(m.dashboard?.targets?.pickupMins ?? 15),
                  })
                }
              />
            </Field>
            <Field label="Hedef Süre (Pickup, dakika)">
              <input
                type="number"
                min={1}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={String(m.dashboard?.targets?.pickupMins ?? 15)}
                onChange={(e) =>
                  setNested(["dashboard", "targets"], {
                    ...(m.dashboard?.targets || {}),
                    pickupMins: Math.max(1, Number(e.target.value || 15)),
                    deliveryMins: Number(m.dashboard?.targets?.deliveryMins ?? 30),
                  })
                }
              />
            </Field>
          </div>
          <p className="mt-2 text-xs text-stone-400">
            Renkler Dashboard’da <b>Colors → modeColors / statusColors</b> alanlarından okunur.
          </p>
        </section>

        {/* ANNOUNCEMENTS */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Duyurular / Kampanya Banner</div>
          <div className="mb-2">
            <Toggle
              label="Announcements aktif"
              checked={!!m.announcements?.enabled}
              onChange={(v) => setNested(["announcements", "enabled"], v)}
            />
          </div>
          <AnnouncementsEditor
            value={m.announcements?.items || []}
            onChange={(v) => setNested(["announcements", "items"], v)}
          />
        </section>

        {/* TELEGRAM */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Telegram Bildirim</div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!m.telegram?.enabled}
                onChange={(e) => setNested(["telegram", "enabled"], e.target.checked)}
              />
              Aktif
            </label>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 mt-2">
            <Field label="Bot Token">
              <input
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.telegram?.botToken || ""}
                onChange={(e) => setNested(["telegram", "botToken"], e.target.value)}
                placeholder="123456:ABC-DEF..."
              />
            </Field>
            <Field label="Chat ID / Kanal">
              <input
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.telegram?.chatId || ""}
                onChange={(e) => setNested(["telegram", "chatId"], e.target.value)}
                placeholder="@kanalAdi veya -100123456"
              />
            </Field>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              className="rounded-md border border-stone-700/60 bg-stone-800/60 px-3 py-2 text-sm"
              onClick={async () => {
                try {
                  const token = model?.telegram?.botToken || "";
                  const chatId = model?.telegram?.chatId || "";
                  if (!model?.telegram?.enabled) {
                    alert("Önce 'Aktif' kutusunu işaretleyin.");
                    return;
                  }
                  if (!token || !chatId) {
                    alert("Bot Token ve Chat ID gerekli.");
                    return;
                  }
                  const res = await fetch("/api/telegram/send", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      token,
                      chatId,
                      text: "Testnachricht ✅\n(Burger Admin Settings)",
                      parseMode: "HTML",
                    }),
                  });
                  const j = await res.json().catch(() => ({}));
                  if (!res.ok || !j?.ok) {
                    alert("Telegram testi başarısız: " + (j?.error || res.status));
                  } else {
                    alert("Telegram testi başarılı ✅");
                  }
                } catch (e: any) {
                  alert("Hata: " + (e?.message || ""));
                }
              }}
            >
              Botu Test Et
            </button>
            <span className="text-xs text-stone-400">
              Kaydetmeye gerek yok; mevcut form değerleriyle test gönderilir.
            </span>
          </div>
        </section>

        {/* CONTACT */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">İletişim</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Field label="Telefon">
              <input
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.contact?.phone || ""}
                onChange={(e) => setNested(["contact", "phone"], e.target.value)}
              />
            </Field>
            <Field label="E-posta">
              <input
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.contact?.email || ""}
                onChange={(e) => setNested(["contact", "email"], e.target.value)}
              />
            </Field>
            <Field label="Adresse">
              <input
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.contact?.address || ""}
                onChange={(e) => setNested(["contact", "address"], e.target.value)}
              />
            </Field>
            <Field label="WhatsApp No (+49...)">
              <input
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.contact?.whatsappNumber || ""}
                onChange={(e) => setNested(["contact", "whatsappNumber"], e.target.value)}
              />
            </Field>
          </div>
        </section>
      </div>
    </main>
  );
}

/* ───────────────────── subcomponents ───────────────────── */

function PLZTable({
  value,
  onChange,
}: {
  value: Record<string, number>;
  onChange: (v: Record<string, number>) => void;
}) {
  const add = () => {
    const code = prompt("PLZ (5 hane):")?.replace(/\D/g, "").slice(0, 5) || "";
    if (!code) return;
    const min = Number(prompt("Mindestbestellwert (İNDİRİM SONRASI) €:") || "0");
    onChange({ ...(value || {}), [code]: Math.max(0, min || 0) });
  };
  const del = (k: string) => {
    const copy = { ...(value || {}) };
    delete copy[k];
    onChange(copy);
  };
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-2">
        <div className="text-sm opacity-80">PLZ Min (İNDİRİM SONRASI)</div>
        <button className="pill" onClick={add}>
          Yeni PLZ
        </button>
      </div>
      <div className="rounded border border-stone-700/60 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left opacity-70">
              <th className="p-2">PLZ</th>
              <th className="p-2">Min €</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(value || {}).map(([k, v]) => (
              <tr key={k} className="border-t border-stone-700/60">
                <td className="p-2">{k}</td>
                <td className="p-2">
                  <input
                    type="number"
                    step="0.01"
                    className="w-32 rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1 outline-none"
                    value={String(v)}
                    onChange={(e) =>
                      onChange({ ...(value || {}), [k]: Number(e.target.value || 0) })
                    }
                  />
                </td>
                <td className="p-2 text-right">
                  <button className="btn-ghost" onClick={() => del(k)}>
                    Löschen
                  </button>
                </td>
              </tr>
            ))}
            {Object.keys(value || {}).length === 0 && (
              <tr>
                <td className="p-2 text-sm opacity-70" colSpan={3}>
                  Kayıt yok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TierEditor({
  value,
  onChange,
}: {
  value: Array<{ minTotal: number; freeSauces: number }>;
  onChange: (v: Array<{ minTotal: number; freeSauces: number }>) => void;
}) {
  const safe = value || [];
  const add = () => onChange([...safe, { minTotal: 15, freeSauces: 1 }]);
  const del = (i: number) => onChange(safe.filter((_, idx) => idx !== i));
  const set = (i: number, patch: Partial<{ minTotal: number; freeSauces: number }>) => {
    const copy = safe.map((t, idx) => (idx === i ? { ...t, ...patch } : t));
    onChange(copy);
  };
  return (
    <div>
      <div className="mb-2">
        <button className="pill" onClick={add}>
          Eşik ekle
        </button>
      </div>
      {safe.length === 0 ? (
        <div className="text-sm opacity-70">Henüz eşik yok.</div>
      ) : (
        <div className="space-y-2">
          {safe.map((t, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <label className="text-sm">Min €</label>
              <input
                type="number"
                step="0.01"
                className="w-28 rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1 outline-none"
                value={String(t.minTotal)}
                onChange={(e) => set(i, { minTotal: Number(e.target.value || 0) })}
              />
              <label className="text-sm ml-1">Ücretsiz Adet</label>
              <input
                type="number"
                step={1}
                min={0}
                className="w-24 rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1 outline-none"
                value={String(t.freeSauces)}
                onChange={(e) =>
                  set(i, { freeSauces: Math.max(0, Number(e.target.value || 0)) })
                }
              />
              <button className="btn-ghost ml-auto" onClick={() => del(i)}>
                Löschen
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HoursEditor({
  value,
  onChange,
}: {
  value?: WeekSchedule;
  onChange: (ws: WeekSchedule) => void;
}) {
  const ws: WeekSchedule = value || {};
  const ensureDay = (day: (typeof DAY_KEYS)[number]) => ws[day] ?? [];
  const setDay = (day: (typeof DAY_KEYS)[number], ranges: TimeRange[]) => {
    const next: WeekSchedule = { ...ws, [day]: ranges };
    onChange(next);
  };
  return (
    <div className="rounded border border-stone-700/60 divide-y divide-stone-700/60">
      {DAY_KEYS.map((dayKey) => (
        <DayRow
          key={dayKey}
          label={DAY_LABELS[dayKey]}
          ranges={ensureDay(dayKey) || []}
          onChange={(r) => setDay(dayKey, r || [])}
        />
      ))}
    </div>
  );
}

function DayRow({
  label,
  ranges,
  onChange,
}: {
  label: string;
  ranges: TimeRange[] | undefined | null;
  onChange: (r: TimeRange[] | null) => void;
}) {
  const isClosed = !ranges || ranges.length === 0;
  const add = () => {
    const next = [...(ranges || []), { start: "11:00", end: "22:00" }];
    onChange(next);
  };
  const toggleClosed = (closed: boolean) => {
    onChange(closed ? [] : [{ start: "11:00", end: "22:00" }]);
  };
  const setRange = (idx: number, patch: Partial<TimeRange>) => {
    const base = ranges || [];
    const cur = base[idx] || { start: "11:00", end: "22:00" };
    const next = base.map((r, i) => (i === idx ? { ...cur, ...patch } : r));
    onChange(next);
  };
  const del = (idx: number) => onChange((ranges || []).filter((_, i) => i !== idx));

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-medium">{label}</div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!isClosed}
            onChange={(e) => toggleClosed(!e.target.checked)}
          />
          {isClosed ? "Kapalı" : "Açık"}
        </label>
      </div>

      {!isClosed && (
        <div className="space-y-2">
          {(ranges || []).map((r, i) => (
            <RangeRow
              key={i}
              range={r}
              onChange={(patch) => setRange(i, patch)}
              onDelete={() => del(i)}
            />
          ))}
          <button className="pill" onClick={add}>
            Aralık ekle
          </button>
        </div>
      )}
    </div>
  );
}

function RangeRow({
  range,
  onChange,
  onDelete,
}: {
  range: TimeRange;
  onChange: (patch: Partial<TimeRange>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="time"
        className="rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1 outline-none"
        value={range.start}
        onChange={(e) => onChange({ start: e.target.value })}
      />
      <span className="opacity-70">—</span>
      <input
        type="time"
        className="rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1 outline-none"
        value={range.end}
        onChange={(e) => onChange({ end: e.target.value })}
      />
      <button className="btn-ghost ml-auto" onClick={onDelete}>
        Löschen
      </button>
    </div>
  );
}

function GroupingEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const list = value?.length ? value : ["burger", "vegan", "hotdogs", "extras", "drinks", "sauces"];
  const move = (i: number, dir: -1 | 1) => {
    const copy = [...list];
    const j = i + dir;
    if (j < 0 || j >= copy.length) return;
    [copy[i], copy[j]] = [copy[j], copy[i]];
    onChange(copy);
  };
  const toggle = (cat: string, checked: boolean) => {
    if (checked && !list.includes(cat)) onChange([...list, cat]);
    if (!checked && list.includes(cat)) onChange(list.filter((c) => c !== cat));
  };
  return (
    <div className="space-y-2">
      {list.map((c, i) => (
        <div key={c} className="flex items-center gap-2">
          <div className="w-40">{c}</div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => move(i, -1)}>
              ↑
            </button>
            <button className="btn-ghost" onClick={() => move(i, 1)}>
              ↓
            </button>
          </div>
        </div>
      ))}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {CATS.map((c) => (
          <label key={c} className="inline-flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={list.includes(c)}
              onChange={(e) => toggle(c, e.target.checked)}
            />
            {c}
          </label>
        ))}
      </div>
    </div>
  );
}

function ColorEditor({
  title,
  value,
  onChange,
  keys,
}: {
  title: string;
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  keys: Array<[string, string]>;
}) {
  const set = (k: string, v: string) => onChange({ ...(value || {}), [k]: v });
  return (
    <div className="rounded-md border border-stone-700/60 p-3">
      <div className="mb-2 font-medium">{title}</div>
      <div className="grid grid-cols-1 gap-2">
        {keys.map(([k, label]) => (
          <div key={k} className="flex items-center gap-3">
            <div className="w-36 text-sm">{label}</div>
            <input
              type="color"
              value={value?.[k] || "#000000"}
              onChange={(e) => set(k, e.target.value)}
              className="h-8 w-12 rounded border border-stone-700/60 bg-stone-950"
            />
            <input
              value={value?.[k] || "#000000"}
              onChange={(e) => set(k, e.target.value)}
              className="w-40 rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1 outline-none"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────── helper: datetime-local + 📅 butonu ───────── */
function DateTimeWithPicker({
  valueISO,
  onChangeISO,
}: {
  valueISO: string;
  onChangeISO: (v: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const toLocal = (iso?: string) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
        d.getHours()
      )}:${pad(d.getMinutes())}`;
    } catch {
      return "";
    }
  };
  return (
    <div className="relative">
      <input
        ref={ref}
        type="datetime-local"
        className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
        value={toLocal(valueISO)}
        onChange={(e) =>
          onChangeISO(e.target.value ? new Date(e.target.value).toISOString() : "")
        }
      />
      <button
        type="button"
        className="absolute right-1.5 top-1.5 rounded-md border border-stone-700/60 bg-stone-800/60 px-2 py-1 text-xs"
        title="Takvim"
        onClick={() => (ref.current as any)?.showPicker?.()}
      >
        📅
      </button>
    </div>
  );
}

function AnnouncementsEditor({
  value,
  onChange,
}: {
  value: Array<{
    title?: string;
    text?: string;
    imageUrl?: string;
    ctaLabel?: string;
    ctaHref?: string;
    enabled?: boolean;
    startsAt?: string;
    endsAt?: string;
  }>;
  onChange: (
    v: Array<{
      title?: string;
      text?: string;
      imageUrl?: string;
      ctaLabel?: string;
      ctaHref?: string;
      enabled?: boolean;
      startsAt?: string;
      endsAt?: string;
    }>
  ) => void;
}) {
  const list = value || [];
  const add = () =>
    onChange([
      ...list,
      {
        title: "",
        text: "",
        imageUrl: "",
        ctaLabel: "",
        ctaHref: "",
        enabled: true,
        startsAt: "",
        endsAt: "",
      },
    ]);
  const del = (i: number) => onChange(list.filter((_, idx) => idx !== i));
  const set = (i: number, patch: any) =>
    onChange(list.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  return (
    <div className="space-y-3">
      <button className="pill" onClick={add}>
        Banner ekle
      </button>
      {list.length === 0 ? (
        <div className="text-sm opacity-70">Henüz öğe yok.</div>
      ) : (
        list.map((it, i) => (
          <div key={i} className="rounded-md border border-stone-700/60 p-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Başlık (DE)">
                <input
                  className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                  value={it.title || ""}
                  onChange={(e) => set(i, { title: e.target.value })}
                />
              </Field>
              <Field label="Görsel URL">
                <input
                  className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                  value={it.imageUrl || ""}
                  onChange={(e) => set(i, { imageUrl: e.target.value })}
                />
              </Field>
              <Field label="Metin (DE)">
                <input
                  className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                  value={it.text || ""}
                  onChange={(e) => set(i, { text: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="CTA Label">
                  <input
                    className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                    value={it.ctaLabel || ""}
                    onChange={(e) => set(i, { ctaLabel: e.target.value })}
                  />
                </Field>
                <Field label="CTA Href">
                  <input
                    className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                    value={it.ctaHref || ""}
                    onChange={(e) => set(i, { ctaHref: e.target.value })}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:col-span-2">
                <Field label="Aktif">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={it.enabled !== false}
                      onChange={(e) => set(i, { enabled: e.target.checked })}
                    />
                    Etkin
                  </label>
                </Field>
                <Field label="Başlangıç">
                  <DateTimeWithPicker
                    valueISO={it.startsAt || ""}
                    onChangeISO={(v) => set(i, { startsAt: v })}
                  />
                </Field>
                <Field label="Bitiş">
                  <DateTimeWithPicker
                    valueISO={it.endsAt || ""}
                    onChangeISO={(v) => set(i, { endsAt: v })}
                  />
                </Field>
              </div>
            </div>
            <div className="mt-2 text-right">
              <button className="btn-ghost" onClick={() => del(i)}>
                Löschen
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
