"use client";

import { orderHasDrinks } from "@/lib/driver/domain";
import type { DriverOrder } from "@/types/driver";

export function DrinkOrderNotice({ order }: { order: DriverOrder }) {
  if (!orderHasDrinks(order)) return null;

  return (
    <div className="mt-2 rounded-xl border border-amber-300/35 bg-amber-400/10 px-3 py-2 text-sm font-semibold text-amber-50">
      ⚠️ Getränke dabei – bitte beachten.
    </div>
  );
}
