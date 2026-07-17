// app/tv/login/page.tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TV-Anmeldung | Burger Brothers",
};

type SearchParams =
  | {
      err?: string;
      reason?: string;
      next?: string;
      from?: string;
    }
  | Promise<{
      err?: string;
      reason?: string;
      next?: string;
      from?: string;
    }>;

function getErrorMessage(err?: string, reason?: string) {
  if (reason === "missing_pin") {
    return "Bitte PIN eingeben.";
  }

  if (reason === "expired") {
    return "Die TV-Sitzung ist abgelaufen. Bitte erneut anmelden.";
  }

  if (reason === "server_error") {
    return "Die sichere TV-Sitzung konnte nicht erstellt werden. Bitte Serverkonfiguration prüfen.";
  }

  if (reason === "invalid_pin" || (err === "1" && !reason)) {
    return "Falsche PIN. Bitte erneut versuchen.";
  }

  return "";
}

function safeNext(value?: string) {
  const fallback = "/tv";
  const raw = String(value || "").trim();

  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw.includes("://")) return fallback;

  return raw || fallback;
}

export default async function TVLoginPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const params = await Promise.resolve(searchParams || {});
  const errorMessage = getErrorMessage(params?.err, params?.reason);
  const next = safeNext(params?.next || params?.from);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0b0f14] p-4 text-stone-100">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.06] p-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,.20)] ring-1 ring-black/10">
        <div className="mb-6 flex flex-col items-center gap-3">
          <img
            src="/logo-burger-brothers.png"
            alt="Burger Brothers"
            className="h-16 w-16"
          />

          <h1 className="text-xl font-semibold">TV-Anmeldung</h1>

          <p className="text-center text-sm text-stone-300/80">
            Bitte geben Sie die TV-PIN ein.
          </p>
        </div>

        {errorMessage && (
          <div className="mb-4 rounded-md border border-rose-400/40 bg-rose-500/15 px-3 py-2 text-sm text-rose-100">
            {errorMessage}
          </div>
        )}

        <form method="POST" action="/api/tv/login" className="space-y-3">
          <input type="hidden" name="next" value={next} />

          <div className="space-y-1">
            <label htmlFor="pin" className="text-sm opacity-80">
              PIN
            </label>

            <input
              id="pin"
              name="pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]*"
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 outline-none focus:ring-2 focus:ring-sky-500/40"
              placeholder="••••••"
              required
              autoFocus
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-md border border-white/15 bg-white/10 px-3 py-2 font-semibold hover:bg-white/15"
          >
            Anmelden
          </button>
        </form>

        <p className="mt-3 text-center text-[11px] text-stone-500">
          Die PIN wird aus den zentralen TV-/Sicherheitseinstellungen gelesen.
        </p>
      </div>
    </main>
  );
}