"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function AdminLogin() {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [loading, setLoading] = useState(false);
  const r = useRouter();
  const sp = useSearchParams();
  const backTo = sp.get("from") || "/admin";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: u.trim(), pass: p }),
      });
      if (res.ok) {
        r.replace(backTo);
      } else {
        alert("Falsche Zugangsdaten");
      }
    } catch {
      alert("Netzwerkfehler, bitte erneut versuchen.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-[var(--bg)] text-[var(--text)]">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-stone-700/60 bg-stone-900/60 p-6">
        <div className="text-xl font-semibold mb-4">Admin Login</div>

        <input
          className="w-full mb-3 rounded-md bg-stone-800/70 px-3 py-2 outline-none"
          placeholder="Benutzername"
          value={u}
          onChange={(e) => setU(e.target.value)}
          autoComplete="username"
        />
        <input
          className="w-full mb-4 rounded-md bg-stone-800/70 px-3 py-2 outline-none"
          type="password"
          placeholder="Passwort"
          value={p}
          onChange={(e) => setP(e.target.value)}
          autoComplete="current-password"
        />

        <button
          disabled={loading}
          className={`w-full rounded-md bg-amber-600 text-black py-2 font-semibold ${loading ? "opacity-60" : ""}`}
        >
          {loading ? "Wird angemeldet…" : "Anmelden"}
        </button>

        <div className="mt-3 text-xs text-stone-400">
          Standard: <code>admin</code> / <code>123456</code> (in <code>.env</code> ändern)
        </div>
      </form>
    </div>
  );
}
