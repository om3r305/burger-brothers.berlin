"use client";

import type { FormEvent } from "react";
import { glass } from "@/lib/driver/domain";

export function DriverLogin({
  name,
  password,
  remember,
  busy,
  onNameChange,
  onPasswordChange,
  onRememberChange,
  onSubmit,
}: {
  name: string;
  password: string;
  remember: boolean;
  busy: boolean;
  onNameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onRememberChange: (value: boolean) => void;
  onSubmit: () => Promise<boolean>;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit();
  };

  return (
    <main className="min-h-screen text-stone-100 antialiased">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(1200px_700px_at_10%_-10%,rgba(59,130,246,.18),transparent),radial-gradient(1000px_600px_at_90%_0%,rgba(16,185,129,.14),transparent),linear-gradient(180deg,#0b0f14_0%,#0f1318_50%,#0a0d11_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(80%_80%_at_50%_20%,transparent,rgba(0,0,0,.45))]" />
      </div>

      <div
        className="mx-auto max-w-md px-4 pb-16"
        style={{
          paddingTop:
            "max(4rem, calc(env(safe-area-inset-top) + 2rem))",
        }}
      >
        <div className={`rounded-2xl p-6 ${glass}`}>
          <div className="mb-6 text-center">
            <img
              src="/logo-burger-brothers.png"
              className="mx-auto h-16 w-16"
              alt="Burger Brothers Berlin"
            />
            <h1 className="mt-3 text-2xl font-bold">Fahrer-Login</h1>
            <p className="mt-1 text-sm text-stone-300/90">
              Bitte mit vom Admin vergebenen Zugangsdaten anmelden.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <input
              className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-3 outline-none focus:ring-2 focus:ring-white/30"
              placeholder="Benutzername"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              autoComplete="username"
            />

            <input
              type="password"
              className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-3 outline-none focus:ring-2 focus:ring-white/30"
              placeholder="Passwort"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              autoComplete="current-password"
            />

            <label className="flex items-center gap-2 text-sm opacity-90">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) =>
                  onRememberChange(event.target.checked)
                }
              />
              Angemeldet bleiben
            </label>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-amber-500 py-3 font-bold text-black transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Anmeldung läuft…" : "Anmelden"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
