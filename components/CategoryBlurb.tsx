"use client";

import { useEffect, useRef, useState } from "react";

type CategoryKey = "burger" | "vegan" | "hotdogs";

const BLURBS_DE: Record<CategoryKey, string> = {
  burger:
    "Unsere Burger bestehen aus 140 g regionalem Rinderhackfleisch und werden mit frischem Brötchen, Tomaten, Zwiebeln, Eisbergsalat und Gewürzgurken serviert.Saucen: Ketchup und Mayonnaise.Allergene: Gluten, Milch, Senf, Sesam.",
  vegan:
    "Pflanzliche Patties, Tomaten, Zwiebeln, Salat, Gurken. Vegane Mayo/Ketchup. Allergene: Gluten, Soja, Senf.",
  hotdogs:
    "Rind-Wurst im Brötchen, Röstzwiebeln, Gurken-Relish, Ketchup/Senf. Allergene: Gluten, Senf, Sellerie.",
};

export default function CategoryBlurb({
  category,
  className = "",
}: {
  category: CategoryKey;
  className?: string;
}) {
  const text = BLURBS_DE[category];
  const ref = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollHeight > el.clientHeight + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  const containerClasses = [
    "relative rounded-xl border border-stone-700/40 bg-stone-900/60 px-3 py-2",
    expanded ? "" : "max-h-[3.25rem] overflow-hidden",
    className,
  ].join(" ");

  return (
    <div className="mb-3">
      <div ref={ref} className={containerClasses}>
        <p className="text-sm leading-5 text-stone-200">{text}</p>
        {!expanded && overflowing && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-stone-900/90 to-transparent" />
        )}
      </div>

      {overflowing && (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-medium text-amber-300 hover:text-amber-200"
          >
            {expanded ? "Weniger anzeigen" : "Mehr anzeigen"}
          </button>
        </div>
      )}
    </div>
  );
}
