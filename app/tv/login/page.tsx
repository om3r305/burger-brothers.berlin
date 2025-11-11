// app/tv/login/page.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

async function login(formData: FormData) {
  "use server";
  const pin = (formData.get("pin") || "").toString().trim();
  const correct = process.env.TV_PIN || process.env.NEXT_PUBLIC_TV_PIN || "";
  if (!correct) redirect("/tv/login?error=pin-missing");

  if (pin === correct) {
    cookies().set("bb_tv_sess", "ok", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    redirect("/tv/boot");
  }
  redirect("/tv/login?error=invalid");
}

export default function TVLoginPage({ searchParams }: { searchParams?: { error?: string } }) {
  const error = searchParams?.error;

  return (
    <main className="min-h-screen bg-[#0b0f14] text-stone-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 p-6 bg-white/[0.06] shadow-[inset_0_1px_0_0_rgba(255,255,255,.20)] ring-1 ring-black/10">
        <div className="flex flex-col items-center gap-3 mb-6">
          <img src="/logo-burger-brothers.png" alt="Burger Brothers" className="h-16 w-16" />
          <h1 className="text-xl font-semibold">TV Login</h1>
          <p className="text-sm text-stone-300/80 text-center">Lütfen TV&nbsp;PIN&apos;ini girin.</p>
        </div>

        {error === "invalid" && (
          <div className="mb-4 rounded-md border border-rose-400/40 bg-rose-500/15 text-rose-100 text-sm px-3 py-2">
            Hatalı PIN. Tekrar deneyin.
          </div>
        )}
        {error === "pin-missing" && (
          <div className="mb-4 rounded-md border border-amber-400/40 bg-amber-500/15 text-amber-100 text-sm px-3 py-2">
            Sunucuda TV_PIN tanımlı değil. .env dosyanıza <b>TV_PIN</b> ekleyin.
          </div>
        )}

        <form action={login} className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="pin" className="text-sm opacity-80">PIN</label>
            <input
              id="pin"
              name="pin"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              className="w-full rounded-md bg-black/30 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-sky-500/40"
              placeholder="••••••••"
              required
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-md px-3 py-2 font-semibold border border-white/15 bg-white/10 hover:bg-white/15"
          >
            Giriş yap
          </button>
        </form>
      </div>
    </main>
  );
}
