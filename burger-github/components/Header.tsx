"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/menu", label: "Burger", key: "burger", vegan: false },
  { href: "/drinks", label: "Getränke", key: "drinks", vegan: false },
  { href: "/sauces", label: "Soßen", key: "sauces", vegan: false },
  { href: "/hotdogs", label: "Hot Dogs", key: "hotdogs", vegan: false },
  { href: "/vegan", label: "Vegan", key: "vegan", vegan: true },
];

export default function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-stone-800/70 bg-[rgba(18,16,14,.75)] backdrop-blur supports-[backdrop-filter]:bg-[rgba(18,16,14,.55)]">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/logo-burger-brothers.png"
            alt="Burger Brothers Berlin"
            width={36}
            height={36}
            className="h-9 w-9 rounded-full"
            priority
          />
          {/* Name + Standort — Standort NUR hier unter dem Logo */}
          <div className="leading-tight">
            <div className="text-lg font-semibold">Burger Brothers</div>
            <div className="text-[11px] text-white/70">Berlin Tegel</div>
          </div>
        </Link>

        <nav className="flex items-center gap-2 overflow-x-auto no-scrollbar snap-x snap-mandatory -mx-2 px-2 scroll-ps-2">
          {tabs.map((t) => {
            const isActive = pathname === t.href;
            const className = `nav-pill${isActive ? " nav-pill--active" : ""}${
              t.vegan ? " nav-pill--vegan" : ""
            }`;
            return (
              <Link
                key={t.key}
                href={t.href}
                className={className}
                {...(isActive ? { "aria-current": "page" } : {})}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
