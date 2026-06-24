// app/admin/drivers/page.tsx
"use client";

import { useEffect, useState } from "react";

type Driver = {
  id: string;
  name: string;
  password: string;
  role: "fahrer" | "admin";
};

const STORAGE_KEY = "bb_drivers_v1";
const API_URL = "/api/drivers";

type Source = "server" | "cache";

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [form, setForm] = useState({ name: "", password: "", role: "fahrer" });
  const [editId, setEditId] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [loading, setLoading] = useState(false);

  function normalize(list: any): Driver[] {
    const arr = Array.isArray(list) ? list : [];
    const map = new Map<string, Driver>();

    for (const raw of arr) {
      const name = String(raw?.name ?? "").trim();
      const id = String(raw?.id ?? name ?? Math.random().toString(36).slice(2, 10)).trim();
      const password = String(raw?.password ?? raw?.pin ?? raw?.code ?? "").trim();
      const role = raw?.role === "admin" ? "admin" : "fahrer";

      if (!id || !name) continue;

      map.set(id, {
        id,
        name,
        password,
        role,
      });
    }

    return Array.from(map.values());
  }

  function extractDrivers(data: any): Driver[] {
    const arr = Array.isArray(data?.items)
      ? data.items
      : Array.isArray(data?.drivers)
        ? data.drivers
        : Array.isArray(data)
          ? data
          : [];

    return normalize(arr);
  }

  function loadFromLocal(): Driver[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      return normalize(JSON.parse(raw));
    } catch (error) {
      console.error("Ladefehler Fahrer (localStorage):", error);
      return [];
    }
  }

  function saveToLocal(list: Driver[]) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (error) {
      console.error("Speicherfehler Fahrer (localStorage):", error);
    }
  }

  async function loadFromServer(): Promise<Driver[] | null> {
    try {
      const res = await fetch(API_URL, {
        method: "GET",
        cache: "no-store",
        headers: {
          accept: "application/json",
        },
      });

      if (!res.ok) {
        console.warn("API /api/drivers nicht OK:", res.status);
        return null;
      }

      const data = await res.json().catch(() => ({}));
      return extractDrivers(data);
    } catch (error) {
      console.error("API /api/drivers Fehler:", error);
      return null;
    }
  }

  async function saveListToServer(list: Driver[]): Promise<Driver[] | null> {
    try {
      const res = await fetch(API_URL, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ items: list }),
      });

      if (!res.ok) {
        console.warn("API /api/drivers PUT failed:", res.status);
        return null;
      }

      const data = await res.json().catch(() => ({}));
      return extractDrivers(data);
    } catch (error) {
      console.error("API /api/drivers PUT error:", error);
      return null;
    }
  }

  async function refresh() {
    setLoading(true);

    try {
      const fromServer = await loadFromServer();

      if (fromServer) {
        setDrivers(fromServer);
        setSource("server");
        saveToLocal(fromServer);
        return;
      }

      const cached = loadFromLocal();
      setDrivers(cached);
      setSource("cache");
    } finally {
      setLoading(false);
    }
  }

  async function requireFreshServerDrivers() {
    const fromServer = await loadFromServer();

    if (!fromServer) {
      alert("DB ist aktuell nicht erreichbar. Fahrer wurden nicht gespeichert.");
      return null;
    }

    setDrivers(fromServer);
    setSource("server");
    saveToLocal(fromServer);

    return fromServer;
  }

  useEffect(() => {
    refresh();
  }, []);

  const handleAdd = async () => {
    const name = form.name.trim();
    const password = form.password.trim();

    if (!name || !password) {
      alert("Bitte Name & Passwort eingeben.");
      return;
    }

    setLoading(true);

    try {
      const base = source === "server" ? drivers : await requireFreshServerDrivers();
      if (!base) return;

      const id = editId ?? Math.random().toString(36).slice(2, 10);

      const updated: Driver = {
        id,
        name,
        password,
        role: form.role === "admin" ? "admin" : "fahrer",
      };

      const exists = base.some((driver) => driver.id === id);

      if (editId && !exists) {
        alert("Dieser Fahrer ist in der DB nicht mehr vorhanden. Bitte aktualisieren.");
        return;
      }

      const next =
        exists
          ? base.map((driver) => (driver.id === id ? updated : driver))
          : [...base, updated];

      const saved = await saveListToServer(next);

      if (!saved) {
        alert("Fahrer konnten nicht in der DB gespeichert werden.");
        return;
      }

      setDrivers(saved);
      setSource("server");
      saveToLocal(saved);

      setEditId(null);
      setForm({ name: "", password: "", role: "fahrer" });
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (driver: Driver) => {
    setForm({
      name: driver.name,
      password: driver.password,
      role: driver.role,
    });

    setEditId(driver.id);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Diesen Fahrer wirklich löschen?")) return;

    setLoading(true);

    try {
      const base = source === "server" ? drivers : await requireFreshServerDrivers();
      if (!base) return;

      const next = base.filter((driver) => driver.id !== id);
      const saved = await saveListToServer(next);

      if (!saved) {
        alert("Fahrer konnten nicht in der DB gespeichert werden.");
        return;
      }

      setDrivers(saved);
      setSource("server");
      saveToLocal(saved);

      if (editId === id) {
        setEditId(null);
        setForm({ name: "", password: "", role: "fahrer" });
      }
    } finally {
      setLoading(false);
    }
  };

  const cancelEdit = () => {
    setEditId(null);
    setForm({ name: "", password: "", role: "fahrer" });
  };

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold mb-1">Fahrer-Verwaltung</h1>
          <p className="text-sm text-stone-400">
            Fahrer hinzufügen, bearbeiten oder löschen.
          </p>
        </div>

        <div className="text-xs text-stone-400">
          Datenquelle:{" "}
          <span
            className={
              source === "server"
                ? "text-emerald-400"
                : source === "cache"
                  ? "text-amber-400"
                  : ""
            }
          >
            {source === "server"
              ? "Server (DB)"
              : source === "cache"
                ? "Lokal (Cache)"
                : "…"}
          </span>

          {loading && <span className="ml-2 opacity-70">· Lädt…</span>}

          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="ml-3 rounded-md border border-white/10 px-2 py-1 text-stone-300 hover:bg-white/10 disabled:opacity-50"
          >
            Aktualisieren
          </button>
        </div>
      </div>

      {source === "cache" && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          DB ist gerade nicht erreichbar. Die angezeigten Fahrer stammen nur aus dem lokalen Cache.
          Änderungen werden erst gespeichert, wenn die DB wieder erreichbar ist.
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4 max-w-lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-stone-300">Name</label>
            <input
              className="w-full mt-1 rounded-md bg-black/20 border border-white/10 p-2"
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Fahrername"
            />
          </div>

          <div>
            <label className="text-sm text-stone-300">Passwort</label>
            <input
              type="password"
              className="w-full mt-1 rounded-md bg-black/20 border border-white/10 p-2"
              value={form.password}
              onChange={(event) =>
                setForm((current) => ({ ...current, password: event.target.value }))
              }
              placeholder="••••••"
            />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <label className="text-sm text-stone-300">Rolle:</label>

          <select
            className="rounded-md bg-black/20 border border-white/10 p-2"
            value={form.role}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                role: event.target.value === "admin" ? "admin" : "fahrer",
              }))
            }
          >
            <option value="fahrer">Fahrer</option>
            <option value="admin">Admin</option>
          </select>

          {editId && (
            <button
              type="button"
              onClick={cancelEdit}
              disabled={loading}
              className="rounded-md border border-white/10 px-3 py-2 text-stone-300 hover:bg-white/10 disabled:opacity-60"
            >
              Abbrechen
            </button>
          )}

          <button
            type="button"
            onClick={handleAdd}
            disabled={loading}
            className="ml-auto bg-orange-600 hover:bg-orange-700 disabled:opacity-60 px-4 py-2 rounded-md text-white font-semibold"
          >
            {editId ? "Änderung speichern" : "Hinzufügen"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4 overflow-x-auto">
        {drivers.length === 0 ? (
          <div className="text-stone-400 text-sm">Keine Fahrer vorhanden.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-white/10 text-stone-300">
              <tr>
                <th className="text-left py-2">Name</th>
                <th className="text-left py-2">Passwort</th>
                <th className="text-left py-2">Rolle</th>
                <th className="py-2 text-right">Aktionen</th>
              </tr>
            </thead>

            <tbody>
              {drivers.map((driver) => (
                <tr
                  key={driver.id}
                  className="border-t border-white/5 hover:bg-white/5"
                >
                  <td className="py-2">{driver.name}</td>
                  <td className="py-2">{"•".repeat(driver.password?.length || 0)}</td>
                  <td className="py-2 capitalize">{driver.role}</td>
                  <td className="py-2 text-right space-x-2">
                    <button
                      type="button"
                      className="text-amber-400 hover:text-amber-300 disabled:opacity-50"
                      disabled={loading}
                      onClick={() => handleEdit(driver)}
                    >
                      Bearbeiten
                    </button>

                    <button
                      type="button"
                      className="text-rose-400 hover:text-rose-300 disabled:opacity-50"
                      disabled={loading}
                      onClick={() => handleDelete(driver.id)}
                    >
                      Löschen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}