"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import AdminAttentionBell from "@/components/admin/AdminAttentionBell";
import AdminPwaControls from "@/components/admin/AdminPwaControls";
import { LS_SETTINGS } from "@/lib/settings";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  match: (path: string) => boolean;
};

const NAV: NavItem[] = [
  { href: "/admin", label: "Produkte & Gruppen", icon: "🍔", match: (p) => p === "/admin" },
  { href: "/admin/campaigns", label: "Kampagnen", icon: "🏷️", match: (p) => p.startsWith("/admin/campaigns") },
  { href: "/admin/notifications", label: "Bildirim Merkezi", icon: "🔔", match: (p) => p.startsWith("/admin/notifications") },
  { href: "/admin/showcase", label: "Vitrin Ekranı", icon: "📺", match: (p) => p.startsWith("/admin/showcase") },
  { href: "/admin/schnellbestellung", label: "Schnellbestellung", icon: "⚡", match: (p) => p.startsWith("/admin/schnellbestellung") },
  { href: "/admin/orders", label: "Bestellungen", icon: "🧾", match: (p) => p.startsWith("/admin/orders") },
  { href: "/admin/coupons", label: "Gutscheine", icon: "🎟️", match: (p) => p.startsWith("/admin/coupons") },
  { href: "/admin/customers", label: "Kunden", icon: "👥", match: (p) => p.startsWith("/admin/customers") },
  { href: "/admin/stats", label: "Statistiken", icon: "📊", match: (p) => p.startsWith("/admin/stats") },
  { href: "/admin/settings", label: "Einstellungen", icon: "⚙️", match: (p) => p.startsWith("/admin/settings") },
  { href: "/admin/drivers", label: "Fahrer", icon: "🚗", match: (p) => p.startsWith("/admin/drivers") },
];

function useThemeLabel() {
  const [label, setLabel] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      const settings = raw ? JSON.parse(raw) : {};
      const name = String(
        settings?.theme?.name ?? settings?.theme?.active ?? "classic",
      ).toLowerCase();
      const labels: Record<string, string> = {
        default: "Classic",
        classic: "Classic",
        neon: "Neon ✨",
        halloween: "Halloween 🎃",
        christmas: "Christmas 🎄",
      };
      setLabel(labels[name] ?? "Classic");
    } catch {
      setLabel("Classic");
    }
  }, []);

  return label;
}

function AdminNav({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="space-y-1.5" aria-label="Admin navigation">
      {NAV.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={[
              "flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 text-sm transition",
              active
                ? "bg-amber-400 font-black text-black shadow-[0_8px_28px_rgba(251,191,36,.18)]"
                : "text-stone-300 hover:bg-white/[0.07] hover:text-white",
            ].join(" ")}
            aria-current={active ? "page" : undefined}
          >
            <span className="text-lg" aria-hidden>{item.icon}</span>
            <span className="min-w-0 flex-1">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const themeLabel = useThemeLabel();
  const [menuOpen, setMenuOpen] = useState(false);

  const currentTitle = useMemo(
    () => NAV.find((item) => item.match(pathname))?.label || "Admin",
    [pathname],
  );

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  if (pathname === "/admin/login") {
    return <div className="min-h-dvh bg-[#070707]">{children}</div>;
  }

  return (
    <div className="bb-admin-app grid min-h-dvh min-w-0 grid-cols-1 bg-[#070707] text-stone-100 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="hidden min-h-dvh flex-col border-r border-stone-800/70 bg-stone-950/90 lg:sticky lg:top-0 lg:flex lg:max-h-dvh">
        <div className="flex items-center gap-3 border-b border-stone-800/70 px-5 py-5">
          <Image
            src="/admin/icons/admin-192.png"
            alt="Burger Brothers Admin"
            width={48}
            height={48}
            className="h-12 w-12 rounded-2xl"
            priority
          />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-base font-black">Burger Admin</div>
            <div className="mt-1 text-xs text-stone-500" suppressHydrationWarning>
              {themeLabel || "Classic"}
            </div>
          </div>
          <AdminAttentionBell />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <AdminNav pathname={pathname} />
        </div>

        <div className="border-t border-stone-800/70 p-4">
          <AdminPwaControls compact />
          <div className="mt-4 text-center text-[11px] text-stone-600">
            © {new Date().getFullYear()} Burger Brothers
          </div>
        </div>
      </aside>

      <section className="min-h-dvh min-w-0">
        <header className="bb-admin-mobile-header sticky top-0 z-[1200] border-b border-stone-800/80 bg-stone-950/95 px-3 pb-3 pt-[calc(env(safe-area-inset-top)+.65rem)] shadow-lg backdrop-blur-xl lg:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-xl"
              aria-label="Admin menüsünü aç"
              aria-expanded={menuOpen}
            >
              ☰
            </button>
            <Image
              src="/admin/icons/admin-192.png"
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 shrink-0 rounded-xl"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-black text-white">Burger Admin</div>
              <div className="truncate text-xs text-stone-400">{currentTitle}</div>
            </div>
            <AdminAttentionBell />
          </div>
        </header>

        {menuOpen ? (
          <div className="fixed inset-0 z-[2100] lg:hidden" role="dialog" aria-modal="true">
            <button
              type="button"
              aria-label="Menüyü kapat"
              onClick={() => setMenuOpen(false)}
              className="absolute inset-0 bg-black/75 backdrop-blur-sm"
            />
            <aside className="absolute inset-y-0 left-0 flex w-[min(88vw,360px)] flex-col border-r border-stone-800 bg-stone-950 pt-[env(safe-area-inset-top)] shadow-2xl">
              <div className="flex items-center gap-3 border-b border-stone-800 px-4 py-4">
                <Image
                  src="/admin/icons/admin-192.png"
                  alt="Burger Brothers Admin"
                  width={48}
                  height={48}
                  className="h-12 w-12 rounded-2xl"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-black">Burger Admin</div>
                  <div className="text-xs text-stone-500" suppressHydrationWarning>
                    {themeLabel || "Classic"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="grid h-11 w-11 place-items-center rounded-xl bg-white/[0.06] text-xl"
                  aria-label="Menüyü kapat"
                >
                  ✕
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <AdminNav pathname={pathname} onNavigate={() => setMenuOpen(false)} />
              </div>

              <div className="border-t border-stone-800 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                <AdminPwaControls compact onNavigate={() => setMenuOpen(false)} />
              </div>
            </aside>
          </div>
        ) : null}

        <div className="bb-admin-content min-w-0 p-3 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:p-4 lg:p-6">
          {children}
        </div>
      </section>
    </div>
  );
}
