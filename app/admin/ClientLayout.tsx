// app/admin/ClientLayout.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LS_SETTINGS } from "@/lib/settings";

type NavItem = {
  href: string;
  label: string;
  icon?: React.ReactNode;
  match?: (p: string) => boolean;
};

const NAV: NavItem[] = [
  { href: "/admin",           label: "Produkte & Gruppen", icon: "🍔", match: (p) => p === "/admin" },
  { href: "/admin/campaigns", label: "Kampagnen",          icon: "🏷️", match: (p) => p.startsWith("/admin/campaigns") },
  { href: "/admin/orders",    label: "Bestellungen",       icon: "🧾", match: (p) => p.startsWith("/admin/orders") },
  { href: "/admin/coupons",   label: "Gutscheinlar",           icon: "🏷️", match: (p) => p.startsWith("/admin/coupons") },
  { href: "/admin/customers", label: "Kunden",             icon: "👥", match: (p) => p.startsWith("/admin/customers") },
  { href: "/admin/stats",     label: "Statistiken",        icon: "📊", match: (p) => p.startsWith("/admin/stats") },
  { href: "/admin/settings",  label: "Einstellungen",      icon: "⚙️", match: (p) => p.startsWith("/admin/settings") },
  { href: "/admin/drivers",   label: "Fahrer",             icon: "🚗", match: (p) => p.startsWith("/admin/drivers") },
];

/** Tema etiketini yalnızca client’ta üret */
function useThemeLabel() {
  const [label, setLabel] = useState<string>("");
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      const s = raw ? JSON.parse(raw) : {};
      const name = String(s?.theme?.name ?? s?.theme?.active ?? "classic").toLowerCase();
      const map: Record<string, string> = {
        default: "Classic",
        classic: "Classic",
        neon: "Neon ✨",
        halloween: "Halloween 🎃",
        christmas: "Christmas 🎄",
      };
      setLabel(map[name] ?? "Classic");
    } catch {}
  }, []);
  return label;
}

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const themeLabel = useThemeLabel();

  return (
    <div className="min-h-dvh grid grid-cols-1 lg:grid-cols-[280px_1fr]">
      {/* Sidebar (Desktop) */}
      <aside className="hidden lg:flex flex-col border-r border-stone-800/60 bg-stone-950/70 backdrop-blur">
        {/* Brand Header */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-stone-800/60">
          <Image
            src="/logo-burger-brothers.png"
            alt="Burger Brothers Berlin"
            width={44}
            height={44}
            className="h-11 w-11 rounded-full"
            priority
          />
          <div className="leading-tight">
            <div className="text-base font-semibold">Adminbereich</div>
            <div className="text-xs text-stone-400" suppressHydrationWarning>
              {themeLabel || ""}
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="p-4 flex-1 space-y-2">
          {NAV.map((it) => {
            const active = it.match ? it.match(pathname) : pathname === it.href;
            return (
              <Link
                key={it.href}
                href={it.href}
                className={[
                  "flex items-center gap-3 rounded-lg px-4 py-3 text-base transition",
                  active ? "bg-stone-800 text-white font-semibold" : "text-stone-300 hover:bg-stone-900",
                ].join(" ")}
                aria-current={active ? "page" : undefined}
              >
                <span className="text-lg" aria-hidden>{it.icon}</span>
                <span>{it.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="px-6 pb-5 pt-3 text-xs text-stone-500">
          ©️ {new Date().getFullYear()} Burger Brothers
        </div>
      </aside>

      {/* Content */}
      <section className="min-h-dvh">
        {/* Mobile Header */}
        <div className="lg:hidden sticky top-0 z-20 border-b border-stone-800/60 bg-stone-950/80 backdrop-blur px-4 py-3">
          <div className="flex items-center gap-2">
            <Image
              src="/logo-burger-brothers.png"
              alt="Burger Brothers Berlin"
              width={32}
              height={32}
              className="h-8 w-8 rounded-full"
            />
            <div className="font-semibold">Admin</div>
            <span className="ml-auto text-xs text-stone-400" suppressHydrationWarning>
              {themeLabel || ""}
            </span>
          </div>
          <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar">
            {NAV.map((it) => {
              const active = it.match ? it.match(pathname) : pathname === it.href;
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className={["nav-pill text-sm px-3 py-1.5", active ? "nav-pill--active" : ""].join(" ")}
                >
                  <span className="mr-1" aria-hidden>{it.icon}</span>
                  {it.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="p-4 lg:p-6">{children}</div>
      </section>
    </div>
  );
}
