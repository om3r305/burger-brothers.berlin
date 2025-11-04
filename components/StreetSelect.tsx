// /components/StreetSelect.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getStreets, normalizeForSearch } from "@/lib/streets";

export default function StreetSelect({
  plz,
  value,
  onChange,
  disabled,
  placeholder = "Straße wählen...",
}: {
  plz: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    // PLZ değiştiyse query’yi sıfırla
    setQuery("");
    setOpen(false);
    // PLZ yoksa sokağı da sıfırla
    if ((plz || "").length !== 5) onChange("");
  }, [plz]);

  const options = useMemo(() => {
    const list = (plz && plz.length === 5) ? getStreets(plz) : [];
    if (!query) return list.slice(0, 200);
    const key = normalizeForSearch(query);
    return list.filter((s) => normalizeForSearch(s).includes(key)).slice(0, 200);
  }, [plz, query]);

  const exactMatch = useMemo(() => {
    const list = (plz && plz.length === 5) ? getStreets(plz) : [];
    return !!list.find((s) => s === value);
  }, [plz, value]);

  const canInteract = !disabled && (plz || "").length === 5;

  return (
    <div className={`relative ${!canInteract ? "opacity-60" : ""}`}>
      <input
        ref={inputRef}
        disabled={!canInteract}
        value={value || query}
        onChange={(e) => {
          onChange(""); // serbest yazımı state’te tutmuyoruz, seçim zorunlu
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // blur’da açık listeyi kapat
          setTimeout(() => setOpen(false), 120);
        }}
        placeholder={placeholder}
        className={`w-full rounded-md bg-stone-800/60 p-2 outline-none ${value && !exactMatch ? "ring-1 ring-rose-500/60" : ""}`}
      />

      {open && canInteract && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-stone-700/60 bg-stone-900/95 shadow-lg">
          {options.length === 0 && (
            <div className="px-3 py-2 text-sm opacity-70">Sonuç yok.</div>
          )}
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(opt);
                setQuery("");
                setOpen(false);
                inputRef.current?.blur();
              }}
              className="block w-full px-3 py-2 text-left hover:bg-stone-800/80"
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {!exactMatch && value && (
        <div className="mt-1 text-xs text-rose-300">Listeden bir sokak seçmelisin.</div>
      )}
      {(plz || "").length === 5 && getStreets(plz).length === 0 && (
        <div className="mt-1 text-xs text-amber-300">
          Bu PLZ için sokak sözlüğü yok. Admin → Adresseler sayfasından ekleyin.
        </div>
      )}
    </div>
  );
}
