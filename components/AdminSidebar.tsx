// components/AdminSidebar.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  icon?: React.ReactNode;
  match?: (p: string) => boolean;
};

const NAV: NavItem[] = [
  { href: "/admin", label: "Produkte & Gruppen", icon: "🍔", match: (p) => p === "/admin" },
  { href: "/admin/campaigns", label: "Kampagnen", icon: "🏷️", match: (p) => p.startsWith("/admin/campaigns") },
  { href: "/admin/orders", label: "Bestellungen", icon: "🧾", match: (p) => p.startsWith("/admin/orders") },
  { href: "/admin/customers", label: "Kunden", icon: "👥", match: (p) => p.startsWith("/admin/customers") },
  { href: "/admin/stats", label: "Statistiken", icon: "📊", match: (p) => p.startsWith("/admin/stats") },
  { href: "/admin/settings", label: "Einstellungen", icon: "⚙️", match: (p) => p.startsWith("/admin/settings") },
];

export default function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex flex-col border-r border-stone-800/60 bg-stone-950/60 backdrop-blur">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-stone-800/60">
        <Image
          src="/logo-burger-brothers.png"
          alt="Burger Brothers Berlin"
          width={36}
          height={36}
          className="h-9 w-9 rounded-full"
          priority
        />
        <div className="leading-tight">
          <div className="font-semibold">Admin</div>
          <div className="text-xs text-stone-400">Burger Brothers • Berlin</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="p-3 flex-1 space-y-1">
        {NAV.map((it) => {
          const active = it.match ? it.match(pathname) : pathname === it.href;
          return (
            <Link
              key={it.href}
              href={it.href}
              className={[
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition",
                active
                  ? "bg-stone-800 text-white font-semibold"
                  : "text-stone-300 hover:bg-stone-900",
              ].join(" ")}
              aria-current={active ? "page" : undefined}
            >
              <span aria-hidden>{it.icon}</span>
              <span>{it.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 pb-4 pt-2 text-xs text-stone-500">
        ©️ {new Date().getFullYear()} Burger Brothers
      </div>
    </aside>
  );
}
