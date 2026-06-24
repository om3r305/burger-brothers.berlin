"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function safeBackTo(value: string | null) {
  const fallback = "/admin";
  const raw = String(value || "").trim();

  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw.includes("://")) return fallback;

  return raw || fallback;
}

function AdminLoginInner() {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [loading, setLoading] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const backTo = safeBackTo(searchParams.get("from"));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (loading) return;

    setLoading(true);

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          user: u.trim(),
          pass: p,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || json?.ok === false) {
        alert("Falsche Zugangsdaten");
        return;
      }

      router.replace(backTo);
    } catch {
      alert("Netzwerkfehler, bitte erneut versuchen.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-[var(--bg)] text-[var(--text)]">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-stone-700/60 bg-stone-900/60 p-6"
      >
        <div className="mb-4 text-xl font-semibold">Admin Login</div>

        <input
          className="mb-3 w-full rounded-md bg-stone-800/70 px-3 py-2 outline-none"
          placeholder="Benutzername"
          value={u}
          onChange={(event) => setU(event.target.value)}
          autoComplete="username"
          disabled={loading}
        />

        <input
          className="mb-4 w-full rounded-md bg-stone-800/70 px-3 py-2 outline-none"
          type="password"
          placeholder="Passwort"
          value={p}
          onChange={(event) => setP(event.target.value)}
          autoComplete="current-password"
          disabled={loading}
        />

        <button
          type="submit"
          disabled={loading}
          className={`w-full rounded-md bg-amber-600 py-2 font-semibold text-black ${
            loading ? "cursor-not-allowed opacity-60" : "hover:bg-amber-500"
          }`}
        >
          {loading ? "Wird angemeldet…" : "Anmelden"}
        </button>

        <div className="mt-3 text-xs text-stone-400">
          Zugangsdaten werden serverseitig geprüft.
        </div>
      </form>
    </div>
  );
}

export default function AdminLogin() {
  return (
    <Suspense fallback={null}>
      <AdminLoginInner />
    </Suspense>
  );
}