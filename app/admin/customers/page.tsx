// app/admin/customers/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

/** Keys / APIs */
const LS_CUSTOMERS = "bb_customers_v1";
const API_CUSTOMERS = "/api/admin/customers";
const API_ORDERS = "/api/admin/orders";

/** Types */
type Stats = {
  orders: number;
  totalSpent: number;
};

type Customer = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  plz?: string | null;
  notes?: string | null;
  vip?: boolean;
  blocked?: boolean;
  emailOptIn?: boolean;
  createdAt?: number | string | null;
  updatedAt?: number | string | null;
  lastOrderAt?: number | string | null;
  stats?: Stats | null;
};

type Order = {
  id?: string;
  ts?: number;
  createdAt?: string | null;
  mode?: "pickup" | "delivery";
  plz?: string | null;
  merchandise?: number;
  discount?: number;
  surcharges?: number;
  total?: number;
  customer?: {
    name?: string;
    phone?: string;
    address?: string;
  };
};

type Source = "db" | "cache" | "empty";

/** Utils */
const rid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const fmtEur = (n: number) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(Number.isFinite(Number(n)) ? Number(n) : 0);

async function copy(text: string) {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {}
}

function toMs(value: any): number | undefined {
  if (!value) return undefined;

  if (typeof value === "number" && Number.isFinite(value)) return value;

  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;

  const date = new Date(value);
  if (Number.isFinite(date.valueOf())) return date.getTime();

  return undefined;
}

function normalizePhone(value: any) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeEmail(value: any) {
  const email = String(value || "").trim().toLowerCase();
  return email.includes("@") ? email : "";
}

function normalizeStats(value: any): Stats {
  const stats = value && typeof value === "object" ? value : {};

  return {
    orders: Math.max(0, Number(stats.orders ?? stats.orderCount ?? stats.count ?? 0) || 0),
    totalSpent: Math.max(
      0,
      Number(stats.totalSpent ?? stats.revenue ?? stats.sum ?? 0) || 0,
    ),
  };
}

function normalizeCustomer(value: any): Customer | null {
  if (!value || typeof value !== "object") return null;

  const id = String(value.id || value.phone || value.email || rid()).trim();
  const name = String(value.name || "Unbekannt").trim();

  if (!id || !name) return null;

  return {
    id,
    name,
    phone: value.phone ? String(value.phone) : null,
    email: value.email ? String(value.email) : null,
    address: value.address ? String(value.address) : null,
    plz: value.plz ? String(value.plz) : value.zip ? String(value.zip) : null,
    notes: value.notes ? String(value.notes) : value.note ? String(value.note) : null,
    vip: Boolean(value.vip),
    blocked: Boolean(value.blocked),
    emailOptIn: Boolean(value.emailOptIn ?? value.marketingOptIn ?? value.newsletterOptIn),
    createdAt: toMs(value.createdAt) ?? value.createdAt ?? Date.now(),
    updatedAt: toMs(value.updatedAt) ?? value.updatedAt ?? null,
    lastOrderAt: toMs(value.lastOrderAt) ?? value.lastOrderAt ?? null,
    stats: normalizeStats(value.stats ?? value),
  };
}

function normalizeCustomers(value: any): Customer[] {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(value?.items)
      ? value.items
      : Array.isArray(value?.customers)
        ? value.customers
        : Array.isArray(value?.data)
          ? value.data
          : Array.isArray(value?.data?.items)
            ? value.data.items
            : Array.isArray(value?.data?.customers)
              ? value.data.customers
              : [];

  return list.map(normalizeCustomer).filter(Boolean) as Customer[];
}

function normalizeOrders(value: any): Order[] {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(value?.items)
      ? value.items
      : Array.isArray(value?.orders)
        ? value.orders
        : Array.isArray(value?.allOrders)
          ? value.allOrders
          : [];

  return list as Order[];
}

function loadLocalCustomers(): Customer[] {
  try {
    const raw = localStorage.getItem(LS_CUSTOMERS);
    return normalizeCustomers(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

function saveLocalCustomers(value: Customer[]) {
  try {
    const json = JSON.stringify(value);
    localStorage.setItem(LS_CUSTOMERS, json);

    try {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: LS_CUSTOMERS,
          newValue: json,
          storageArea: window.localStorage,
        }),
      );
    } catch {
      window.dispatchEvent(new Event("storage"));
    }
  } catch {}
}

/** WhatsApp helper */
const waNumber = (value: string) => value.replace(/[^\d]/g, "");
const waHref = (phone: string, text: string) =>
  `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;

async function loadCustomersFromDb(): Promise<Customer[] | null> {
  try {
    const res = await fetch(API_CUSTOMERS, {
      method: "GET",
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || `CUSTOMERS_${res.status}`);
    }

    return normalizeCustomers(data);
  } catch {
    return null;
  }
}

async function saveCustomersToDb(list: Customer[]): Promise<Customer[] | null> {
  try {
    const res = await fetch(API_CUSTOMERS, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        items: list,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || `CUSTOMERS_SAVE_${res.status}`);
    }

    const fromResponse = normalizeCustomers(data);

    if (fromResponse.length || list.length === 0) {
      return fromResponse;
    }

    const fresh = await loadCustomersFromDb();
    return fresh ?? list;
  } catch {
    return null;
  }
}

async function deleteCustomerFromDb(customer: Customer | string) {
  try {
    const params = new URLSearchParams();

    if (typeof customer === "string") {
      params.set("id", customer);
    } else {
      if (customer.id) params.set("id", customer.id);
      if (customer.phone) params.set("phone", customer.phone);
      if (customer.email) params.set("email", customer.email);
    }

    const res = await fetch(`${API_CUSTOMERS}?${params.toString()}`, {
      method: "DELETE",
      headers: {
        accept: "application/json",
      },
    });

    const data = await res.json().catch(() => ({}));

    return res.ok && data?.ok !== false;
  } catch {
    return false;
  }
}

async function loadOrdersFromDb(): Promise<Order[]> {
  try {
    const now = Date.now();
    const fromMs = now - 90 * 86400000;
    const url = new URL(API_ORDERS, window.location.origin);

    url.searchParams.set("from", String(fromMs));
    url.searchParams.set("to", String(now));

    const res = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data?.ok === false) return [];

    return normalizeOrders(data);
  } catch {
    return [];
  }
}

function csvCell(value: any) {
  const text = String(value ?? "");

  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function mergeCustomers(keep: Customer, drop: Customer): Customer {
  return {
    ...keep,
    name: keep.name || drop.name,
    phone: keep.phone || drop.phone,
    email: keep.email || drop.email,
    address: keep.address || drop.address,
    plz: keep.plz || drop.plz,
    notes: [keep.notes, drop.notes].filter(Boolean).join(" | ") || null,
    vip: Boolean(keep.vip || drop.vip),
    blocked: Boolean(keep.blocked || drop.blocked),
    emailOptIn: Boolean(keep.emailOptIn || drop.emailOptIn),
    createdAt: Math.min(toMs(keep.createdAt) || Date.now(), toMs(drop.createdAt) || Date.now()),
    updatedAt: Date.now(),
    lastOrderAt: Math.max(toMs(keep.lastOrderAt) || 0, toMs(drop.lastOrderAt) || 0) || null,
    stats: {
      orders: (keep.stats?.orders || 0) + (drop.stats?.orders || 0),
      totalSpent: (keep.stats?.totalSpent || 0) + (drop.stats?.totalSpent || 0),
    },
  };
}

/** Component */
export default function AdminCustomersPage() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [source, setSource] = useState<Source>("empty");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);

    try {
      const fromDb = await loadCustomersFromDb();

      if (fromDb) {
        setRows(fromDb);
        setSource("db");
        saveLocalCustomers(fromDb);
      } else {
        const cached = loadLocalCustomers();
        setRows(cached);
        setSource(cached.length ? "cache" : "empty");
      }

      const dbOrders = await loadOrdersFromDb();
      setOrders(dbOrders);
    } finally {
      setLoading(false);
    }
  }

  async function requireFreshDbCustomers() {
    const fresh = await loadCustomersFromDb();

    if (!fresh) {
      alert("DB ist aktuell nicht erreichbar. Änderungen wurden nicht gespeichert.");
      return null;
    }

    setRows(fresh);
    setSource("db");
    saveLocalCustomers(fresh);

    return fresh;
  }

  async function persistCustomers(next: Customer[]) {
    const saved = await saveCustomersToDb(next);

    if (!saved) {
      alert("Kunden konnten nicht in der DB gespeichert werden.");
      return false;
    }

    setRows(saved);
    setSource("db");
    saveLocalCustomers(saved);

    return true;
  }

  useEffect(() => {
    refresh();
  }, []);

  /** filters */
  const [q, setQ] = useState("");
  const [onlyVIP, setOnlyVIP] = useState(false);
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [onlyOptIn, setOnlyOptIn] = useState(false);
  const [plzFilter, setPlzFilter] = useState("");

  const list = useMemo(() => {
    const text = q.trim().toLowerCase();
    let arr = rows.slice();

    if (onlyVIP) arr = arr.filter((customer) => customer.vip);
    if (onlyBlocked) arr = arr.filter((customer) => customer.blocked);
    if (onlyOptIn) arr = arr.filter((customer) => customer.emailOptIn);

    if (plzFilter.trim()) {
      arr = arr.filter((customer) => String(customer.plz || "").includes(plzFilter.trim()));
    }

    if (text) {
      arr = arr.filter((customer) =>
        [
          customer.name,
          customer.phone || "",
          customer.email || "",
          customer.address || "",
          customer.plz || "",
          customer.notes || "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(text),
      );
    }

    arr.sort(
      (a, b) =>
        Number(b.vip) - Number(a.vip) ||
        (toMs(b.lastOrderAt) || 0) - (toMs(a.lastOrderAt) || 0) ||
        a.name.localeCompare(b.name, "de"),
    );

    return arr;
  }, [rows, q, onlyVIP, onlyBlocked, onlyOptIn, plzFilter]);

  /** selected / bulk */
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const selectedIds = useMemo(
    () => Object.keys(selected).filter((key) => selected[key]),
    [selected],
  );

  const selectedRows = useMemo(
    () => list.filter((customer) => selectedIds.includes(customer.id)),
    [list, selectedIds],
  );

  const toggleRow = (id: string, value?: boolean) =>
    setSelected((current) => ({
      ...current,
      [id]: value ?? !current[id],
    }));

  const selectAllVisible = () => {
    const next: Record<string, boolean> = { ...selected };

    for (const customer of list) {
      next[customer.id] = true;
    }

    setSelected(next);
  };

  const clearSelection = () => setSelected({});

  /** campaign composer */
  const [campaignMsg, setCampaignMsg] = useState(
    "Hallo! 🍔 Diese Woche: 5€ Rabatt ab 20€ Bestellwert. Code: BB-WOCHE. Gültig für 7 Tage!",
  );
  const [campaignDelayMs, setCampaignDelayMs] = useState(1500);

  const selectedWithPhone = useMemo(
    () => selectedRows.filter((customer) => normalizePhone(customer.phone).length >= 10),
    [selectedRows],
  );

  const sendCampaignWhatsApp = () => {
    if (!selectedWithPhone.length) {
      alert("Kein ausgewählter Kunde mit Telefonnummer.");
      return;
    }

    let index = 0;
    const delay = Math.max(600, campaignDelayMs || 1200);

    const timer = setInterval(() => {
      if (index >= selectedWithPhone.length) {
        clearInterval(timer);
        return;
      }

      const customer = selectedWithPhone[index++];
      if (!customer) return;

      const url = waHref(String(customer.phone || ""), campaignMsg);
      window.open(url, "_blank");
    }, delay);

    alert(
      `WhatsApp-Fenster werden nacheinander geöffnet (${selectedWithPhone.length} Kunden, ca. ${Math.ceil(
        (selectedWithPhone.length * delay) / 1000,
      )} Sek.).`,
    );
  };

  const exportSelectedCSV = () => {
    if (!selectedRows.length) {
      alert("Bitte zuerst Kunden auswählen.");
      return;
    }

    const exportRows = selectedRows.map((customer) => ({
      id: customer.id,
      name: customer.name,
      phone: customer.phone || "",
      email: customer.email || "",
      plz: customer.plz || "",
      address: customer.address || "",
      optIn: customer.emailOptIn ? "yes" : "no",
      orders: customer.stats?.orders ?? 0,
      total: customer.stats?.totalSpent ?? 0,
      lastOrderAt: customer.lastOrderAt
        ? new Date(toMs(customer.lastOrderAt) || 0).toISOString()
        : "",
    }));

    const keys = Object.keys(exportRows[0] || {});

    const csv = [
      keys.join(","),
      ...exportRows.map((row) => keys.map((key) => csvCell((row as any)[key])).join(",")),
    ].join("\n");

    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "customers_selected.csv";
    link.click();

    URL.revokeObjectURL(url);
  };

  /** customer edit form */
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [plz, setPlz] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [vip, setVip] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [optin, setOptin] = useState(false);

  const resetForm = () => {
    setEditId(null);
    setName("");
    setPhone("");
    setEmail("");
    setPlz("");
    setAddress("");
    setNotes("");
    setVip(false);
    setBlocked(false);
    setOptin(false);
  };

  const loadToForm = (customer: Customer) => {
    setEditId(customer.id);
    setName(customer.name);
    setPhone(String(customer.phone || ""));
    setEmail(String(customer.email || ""));
    setPlz(String(customer.plz || ""));
    setAddress(String(customer.address || ""));
    setNotes(String(customer.notes || ""));
    setVip(Boolean(customer.vip));
    setBlocked(Boolean(customer.blocked));
    setOptin(Boolean(customer.emailOptIn));

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const saveForm = async () => {
    if (!name.trim()) {
      alert("Name ist erforderlich.");
      return;
    }

    const baseRows = source === "db" ? rows : await requireFreshDbCustomers();
    if (!baseRows) return;

    const previous = baseRows.find((row) => row.id === editId);

    const customer: Customer = {
      id: editId || rid(),
      name: name.trim(),
      phone: phone.trim() || null,
      email: normalizeEmail(email) || null,
      plz: plz.trim() || null,
      address: address.trim() || null,
      notes: notes.trim() || null,
      vip,
      blocked,
      emailOptIn: optin,
      createdAt: previous?.createdAt || Date.now(),
      updatedAt: Date.now(),
      lastOrderAt: previous?.lastOrderAt || null,
      stats: previous?.stats || {
        orders: 0,
        totalSpent: 0,
      },
    };

    const ok = await persistCustomers([customer]);
    if (ok) resetForm();
  };

  const del = async (id: string) => {
    if (!confirm("Diesen Kunden wirklich löschen?")) return;

    const customer = rows.find((row) => row.id === id) || id;
    const ok = await deleteCustomerFromDb(customer);

    if (!ok) {
      alert("Kunde konnte nicht in der DB gelöscht werden.");
      return;
    }

    await refresh();

    if (editId === id) resetForm();
  };

  /** merge */
  const [mergeA, setMergeA] = useState("");
  const [mergeB, setMergeB] = useState("");
  const [primary, setPrimary] = useState<"A" | "B">("A");

  const mergeNow = async () => {
    const baseRows = source === "db" ? rows : await requireFreshDbCustomers();
    if (!baseRows) return;

    const a = baseRows.find((row) => row.id === mergeA);
    const b = baseRows.find((row) => row.id === mergeB);

    if (!a || !b) {
      alert("Ungültige ID.");
      return;
    }

    if (a.id === b.id) {
      alert("A und B sind identisch.");
      return;
    }

    const keep = primary === "A" ? a : b;
    const drop = primary === "A" ? b : a;
    const merged = mergeCustomers(keep, drop);

    const saveOk = await persistCustomers([merged]);
    if (!saveOk) return;

    const deleteOk = await deleteCustomerFromDb(drop);

    if (!deleteOk) {
      alert("Kunde wurde zusammengeführt, aber der doppelte Datensatz konnte nicht gelöscht werden.");
    }

    await refresh();

    alert("Zusammengeführt ✅");
    setMergeA("");
    setMergeB("");
  };

  /** auto dedupe */
  const autoDeduplicate = async () => {
    const baseRows = source === "db" ? rows : await requireFreshDbCustomers();
    if (!baseRows) return;

    const byPhone = new Map<string, Customer[]>();
    const byEmail = new Map<string, Customer[]>();

    for (const customer of baseRows) {
      const phoneKey = normalizePhone(customer.phone);
      const emailKey = normalizeEmail(customer.email);

      if (phoneKey) byPhone.set(phoneKey, [...(byPhone.get(phoneKey) || []), customer]);
      if (emailKey) byEmail.set(emailKey, [...(byEmail.get(emailKey) || []), customer]);
    }

    const pairs: [Customer, Customer][] = [];

    const visitGroup = (arr: Customer[]) => {
      if (arr.length < 2) return;

      const sorted = arr
        .slice()
        .sort((a, b) => (toMs(a.createdAt) || 0) - (toMs(b.createdAt) || 0));

      const keep = sorted[0];

      if (!keep) return;

      for (let index = 1; index < sorted.length; index += 1) {
        const drop = sorted[index];
        if (drop && keep.id !== drop.id) pairs.push([keep, drop]);
      }
    };

    for (const value of byPhone.values()) visitGroup(value);
    for (const value of byEmail.values()) visitGroup(value);

    if (!pairs.length) {
      alert("Keine Duplikate gefunden.");
      return;
    }

    const byId = new Map(baseRows.map((customer) => [customer.id, customer]));
    const deleteIds = new Set<string>();

    for (const [keepOriginal, dropOriginal] of pairs) {
      if (deleteIds.has(dropOriginal.id)) continue;

      const keep = byId.get(keepOriginal.id);
      const drop = byId.get(dropOriginal.id);

      if (!keep || !drop || keep.id === drop.id) continue;

      const merged = mergeCustomers(keep, drop);

      byId.set(keep.id, merged);
      byId.delete(drop.id);
      deleteIds.add(drop.id);
    }

    if (!deleteIds.size) {
      alert("Keine Duplikate gefunden.");
      return;
    }

    const saveOk = await persistCustomers(Array.from(byId.values()));
    if (!saveOk) return;

    let failed = 0;

    for (const id of deleteIds) {
      const customer = baseRows.find((row) => row.id === id) || id;
      const ok = await deleteCustomerFromDb(customer);

      if (!ok) failed += 1;
    }

    await refresh();

    if (failed > 0) {
      alert(`Zusammengeführt, aber ${failed} doppelte Datensätze konnten nicht gelöscht werden.`);
      return;
    }

    alert(`Automatisches Zusammenführen fertig: ${deleteIds.size} Paare.`);
  };

  const toggleOptIn = async (customer: Customer) => {
    const baseRows = source === "db" ? rows : await requireFreshDbCustomers();
    if (!baseRows) return;

    const current = baseRows.find((row) => row.id === customer.id) || customer;

    const nextCustomer: Customer = {
      ...current,
      emailOptIn: !current.emailOptIn,
      updatedAt: Date.now(),
    };

    await persistCustomers([nextCustomer]);
  };

  const orderCount = orders.length;

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold">Kunden</h1>

          <Link href="/admin" className="text-sm text-stone-300 hover:text-stone-100">
            ← Admin
          </Link>
        </div>

        <div className="text-xs text-stone-400">
          Datenquelle:{" "}
          <b className={source === "db" ? "text-emerald-400" : "text-amber-400"}>
            {source === "db" ? "DB" : source === "cache" ? "Cache" : "Leer"}
          </b>

          <span className="ml-3">Bestellungen: {orderCount}</span>

          {loading && <span className="ml-2 opacity-70">· Lädt…</span>}

          <button className="btn-ghost ml-3" onClick={refresh} disabled={loading}>
            Aktualisieren
          </button>
        </div>
      </div>

      {source === "cache" && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          DB ist gerade nicht erreichbar. Die angezeigten Kunden stammen nur aus dem lokalen Cache.
          Änderungen werden erst gespeichert, wenn die DB erreichbar ist.
        </div>
      )}

      <div className="card p-4">
        <div className="mb-2 font-medium">{editId ? "Kunde bearbeiten" : "Neuer Kunde"}</div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Name *">
            <input
              className="inp"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name"
            />
          </Field>

          <Field label="Telefon">
            <input
              className="inp"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+49…"
            />
          </Field>

          <Field label="E-Mail">
            <input
              className="inp"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="mail@…"
            />
          </Field>

          <Field label="PLZ">
            <input
              className="inp"
              value={plz}
              onChange={(event) => setPlz(event.target.value)}
              placeholder="13507"
            />
          </Field>

          <Field label="Adresse">
            <input
              className="inp"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Straße Hausnr., Ort"
            />
          </Field>

          <Field label="Hinweis">
            <input
              className="inp"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Hinweis…"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={vip} onChange={(event) => setVip(event.target.checked)} />
            VIP
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={blocked}
              onChange={(event) => setBlocked(event.target.checked)}
            />
            Gesperrt
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={optin}
              onChange={(event) => setOptin(event.target.checked)}
            />
            Kampagnenfreigabe (Opt-in)
          </label>
        </div>

        <div className="mt-3 flex gap-2">
          <button className="card-cta" onClick={saveForm}>
            {editId ? "Speichern" : "Hinzufügen"}
          </button>

          {editId && (
            <button className="btn-ghost" onClick={resetForm}>
              Abbrechen
            </button>
          )}
        </div>
      </div>

      <div className="card p-4">
        <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-5">
          <input
            className="inp"
            placeholder="Suche (Name/Telefon/E-Mail/Adresse/Hinweis)…"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyVIP}
              onChange={(event) => setOnlyVIP(event.target.checked)}
            />
            VIP
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyBlocked}
              onChange={(event) => setOnlyBlocked(event.target.checked)}
            />
            Gesperrt
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyOptIn}
              onChange={(event) => setOnlyOptIn(event.target.checked)}
            />
            Nur Opt-in
          </label>

          <input
            className="inp"
            placeholder="PLZ-Filter (z. B. 13507)"
            value={plzFilter}
            onChange={(event) => setPlzFilter(event.target.value)}
          />
        </div>

        <div className="rounded-md border border-stone-700/60 p-3 bg-stone-950/50">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-sm">
              Auswahl: <b>{selectedIds.length}</b> / Gesamt: <b>{list.length}</b>
            </span>

            <button className="btn-ghost" onClick={selectAllVisible}>
              Alle auswählen
            </button>

            <button className="btn-ghost" onClick={clearSelection}>
              Auswahl löschen
            </button>

            <span className="ml-auto text-xs opacity-70">
              Tipp: Zeile auswählen und anschließend Aktion ausführen.
            </span>
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <div className="text-sm font-medium mb-1">Kampagnentext</div>

              <textarea
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 p-2 text-sm outline-none"
                rows={4}
                value={campaignMsg}
                onChange={(event) => setCampaignMsg(event.target.value)}
              />

              <div className="mt-2 flex items-center gap-2 text-xs">
                <span>Verzögerung (ms):</span>

                <input
                  type="number"
                  className="w-24 rounded border border-stone-700/60 bg-stone-950 p-1"
                  value={campaignDelayMs}
                  onChange={(event) => setCampaignDelayMs(Number(event.target.value))}
                />

                <button className="btn-ghost" onClick={() => copy(campaignMsg)}>
                  Text kopieren
                </button>

                <button
                  className="btn-ghost"
                  onClick={() =>
                    copy(
                      selectedWithPhone
                        .map((customer) => waHref(String(customer.phone || ""), campaignMsg))
                        .join("\n"),
                    )
                  }
                  disabled={!selectedWithPhone.length}
                >
                  WhatsApp-Links kopieren
                </button>
              </div>
            </div>

            <div>
              <div className="text-sm font-medium mb-1">Sammelaktionen</div>

              <div className="flex flex-col gap-2">
                <button
                  className="card-cta"
                  onClick={sendCampaignWhatsApp}
                  disabled={!selectedWithPhone.length}
                  title="Öffnet WhatsApp Web nacheinander für die Auswahl"
                >
                  Mit WhatsApp senden ({selectedWithPhone.length})
                </button>

                <button className="btn-ghost" onClick={exportSelectedCSV} disabled={!selectedRows.length}>
                  Auswahl → CSV
                </button>
              </div>

              <div className="mt-4 text-xs opacity-70">
                Hinweis: Browser-Sicherheitsregeln können mehrere Popups blockieren. Erhöhe ggf. die Verzögerung.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="mb-2 font-medium">Kunden zusammenführen</div>

        <div className="grid md:grid-cols-5 gap-2">
          <input className="inp" placeholder="ID A" value={mergeA} onChange={(event) => setMergeA(event.target.value)} />

          <input className="inp" placeholder="ID B" value={mergeB} onChange={(event) => setMergeB(event.target.value)} />

          <select
            className="inp"
            value={primary}
            onChange={(event) => setPrimary(event.target.value as "A" | "B")}
            title="Welcher Datensatz soll bleiben?"
          >
            <option value="A">A bleibt</option>
            <option value="B">B bleibt</option>
          </select>

          <button className="btn-ghost" onClick={mergeNow}>
            Zusammenführen
          </button>

          <button className="btn-ghost" onClick={autoDeduplicate}>
            Automatisch (Tel/E-Mail)
          </button>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-stone-900/80 backdrop-blur">
            <tr className="[&>th]:px-3 [&>th]:py-2 text-left">
              <th>Auswahl</th>
              <th>Name</th>
              <th>Tel</th>
              <th>E-Mail</th>
              <th>PLZ</th>
              <th>Adresse</th>
              <th>VIP</th>
              <th>Gesperrt</th>
              <th>Opt-in</th>
              <th>Anzahl</th>
              <th>Umsatz</th>
              <th>Letzte</th>
              <th className="text-right">Aktion</th>
            </tr>
          </thead>

          <tbody>
            {list.map((customer) => (
              <tr key={customer.id} className="border-t border-stone-800/60 hover:bg-stone-900/40">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={!!selected[customer.id]}
                    onChange={() => toggleRow(customer.id)}
                  />
                </td>

                <td className="px-3 py-2">
                  <button className="underline-offset-2 hover:underline" onClick={() => loadToForm(customer)}>
                    {customer.name}
                  </button>
                </td>

                <td className="px-3 py-2">{customer.phone || "—"}</td>
                <td className="px-3 py-2">{customer.email || "—"}</td>
                <td className="px-3 py-2">{customer.plz || "—"}</td>
                <td className="px-3 py-2">{customer.address || "—"}</td>
                <td className="px-3 py-2">{customer.vip ? "✓" : "—"}</td>
                <td className="px-3 py-2">{customer.blocked ? "✓" : "—"}</td>

                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={!!customer.emailOptIn}
                    onChange={() => toggleOptIn(customer)}
                    title="Kampagnenfreigabe"
                  />
                </td>

                <td className="px-3 py-2">{customer.stats?.orders ?? 0}</td>
                <td className="px-3 py-2">{fmtEur(customer.stats?.totalSpent ?? 0)}</td>

                <td className="px-3 py-2">
                  {customer.lastOrderAt
                    ? new Date(toMs(customer.lastOrderAt) || 0).toLocaleDateString("de-DE")
                    : "—"}
                </td>

                <td className="px-3 py-2">
                  <div className="flex justify-end gap-2">
                    {customer.phone && (
                      <a
                        className="btn-ghost"
                        href={waHref(String(customer.phone), campaignMsg)}
                        target="_blank"
                        rel="noreferrer"
                        title="WhatsApp an diesen Kunden"
                      >
                        WhatsApp
                      </a>
                    )}

                    <button className="btn-ghost" onClick={() => copy(customer.id)} title="ID kopieren">
                      ID
                    </button>

                    <button className="btn-ghost" onClick={() => loadToForm(customer)}>
                      Bearbeiten
                    </button>

                    <button className="btn-ghost" onClick={() => del(customer.id)}>
                      Löschen
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {!list.length && (
              <tr>
                <td className="px-3 py-4 text-sm opacity-70" colSpan={13}>
                  Keine Einträge.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <style>{`
        .card {
          border: 1px solid rgba(120, 113, 108, 0.6);
          background: rgba(28, 25, 23, 0.6);
          border-radius: 12px;
        }

        .inp {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid rgba(120, 113, 108, 0.6);
          background: #0b0b0b;
          outline: none;
        }

        .btn-ghost {
          padding: 0.4rem 0.7rem;
          border: 1px solid rgba(120, 113, 108, 0.6);
          border-radius: 999px;
          background: rgba(28, 25, 23, 0.5);
        }

        .card-cta {
          padding: 0.55rem 1rem;
          border-radius: 999px;
          font-weight: 600;
          background: #10b981;
          color: #00110a;
        }

        .btn-ghost:disabled,
        .card-cta:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
      `}</style>
    </main>
  );
}

/** Label helper */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-stone-300/80">{label}</span>
      {children}
    </label>
  );
}