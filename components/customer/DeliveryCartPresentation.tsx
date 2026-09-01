"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useCart } from "@/components/store";

const CUSTOMER_MENU_PATHS = new Set([
  "/menu",
  "/extras",
  "/drinks",
  "/sauces",
  "/hotdogs",
  "/donuts",
  "/bubble-tea",
]);

export default function DeliveryCartPresentation() {
  const pathname = usePathname();
  const orderMode = useCart((state) => state.orderMode);
  const active = CUSTOMER_MENU_PATHS.has(pathname) && orderMode === "delivery";

  useEffect(() => {
    if (!active) return;

    const syncCopy = () => {
      for (const element of Array.from(document.querySelectorAll<HTMLElement>(".bb-mobile-cart-trigger span"))) {
        const text = String(element.textContent || "").trim();
        if (text.includes("PLZ für Lieferung noch eingeben")) {
          element.textContent = "📍 Lieferadresse vor dem Checkout auswählen";
        }
      }
    };

    syncCopy();
    const observer = new MutationObserver(syncCopy);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [active]);

  if (!active) return null;

  return (
    <style jsx global>{`
      [role="dialog"][aria-label="Bestellübersicht"] div:has(> label[for="m-plz"]),
      aside div:has(> label[for="plz"]) {
        display: none !important;
      }
    `}</style>
  );
}
