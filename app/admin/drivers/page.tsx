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

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [form, setForm] = useState({ name: "", password: "", role: "fahrer" });
  const [editId, setEditId] = useState<string | null>(null);

  // localStorage'dan oku
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setDrivers(JSON.parse(raw));
    } catch (e) {
      console.error("Ladefehler Fahrer:", e);
    }
  }, []);

  // kaydet
  const saveDrivers = (list: Driver[]) => {
    setDrivers(list);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  };

  const handleAdd = () => {
    if (!form.name || !form.password) return alert("Bitte Name & Passwort eingeben.");
    const id = editId ?? Math.random().toString(36).slice(2, 10);
    const updated: Driver = { id, name: form.name, password: form.password, role: form.role as any };

    let next = [];
    if (editId) {
      next = drivers.map((d) => (d.id === editId ? updated : d));
      setEditId(null);
    } else {
      next = [...drivers, updated];
    }

    saveDrivers(next);
    setForm({ name: "", password: "", role: "fahrer" });
  };

  const handleEdit = (d: Driver) => {
    setForm({ name: d.name, password: d.password, role: d.role });
    setEditId(d.id);
  };

  const handleDelete = (id: string) => {
    if (!confirm("Diesen Fahrer wirklich löschen?")) return;
    saveDrivers(drivers.filter((d) => d.id !== id));
  };

  return (
    <main className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Fahrer-Verwaltung</h1>
        <p className="text-sm text-stone-400">Fahrer hinzufügen, bearbeiten oder löschen.</p>
      </div>

      {/* Form */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4 max-w-lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-stone-300">Name</label>
            <input
              className="w-full mt-1 rounded-md bg-black/20 border border-white/10 p-2"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Fahrername"
            />
          </div>
          <div>
            <label className="text-sm text-stone-300">Passwort</label>
            <input
              type="password"
              className="w-full mt-1 rounded-md bg-black/20 border border-white/10 p-2"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="••••••"
            />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <label className="text-sm text-stone-300">Rolle:</label>
          <select
            className="rounded-md bg-black/20 border border-white/10 p-2"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            <option value="fahrer">Fahrer</option>
            <option value="admin">Admin</option>
          </select>

          <button
            onClick={handleAdd}
            className="ml-auto bg-orange-600 hover:bg-orange-700 px-4 py-2 rounded-md text-white font-semibold"
          >
            {editId ? "Änderung speichern" : "Hinzufügen"}
          </button>
        </div>
      </div>

      {/* Liste */}
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
              {drivers.map((d) => (
                <tr key={d.id} className="border-t border-white/5 hover:bg-white/5">
                  <td className="py-2">{d.name}</td>
                  <td className="py-2">{"•".repeat(d.password.length)}</td>
                  <td className="py-2 capitalize">{d.role}</td>
                  <td className="py-2 text-right space-x-2">
                    <button
                      className="text-amber-400 hover:text-amber-300"
                      onClick={() => handleEdit(d)}
                    >
                      Bearbeiten
                    </button>
                    <button
                      className="text-rose-400 hover:text-rose-300"
                      onClick={() => handleDelete(d.id)}
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
