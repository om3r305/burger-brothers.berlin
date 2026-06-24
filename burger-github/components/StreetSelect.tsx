// /components/StreetSelect.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getStreets, normalize as normalizeForSearch } from "@/lib/streets";

type Props = {
  plz: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

export default function StreetSelect({
  plz,
  value,
  onChange,
  disabled,
  placeholder = "Straße wählen...",
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState(value || "");

  useEffect(() => setQ(value || ""), [value]);

  const all = useMemo(() => getStreets(plz), [plz]);

  const list = useMemo(() => {
    const term = normalizeForSearch(q);
    if (!term) return all.slice(0, 50);
    const out: string[] = [];
    for (const s of all) {
      if (normalizeForSearch(s).includes(term)) {
        out.push(s);
        if (out.length >= 50) break;
      }
    }
    return out;
  }, [all, q]);

  const listId = `streets-${plz || "none"}`;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={q}
        onChange={(e) => {
          const v = e.target.value;
          setQ(v);
          onChange(v);
        }}
        disabled={disabled || !plz}
        placeholder={placeholder}
        list={listId}
        className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
      />
      <datalist id={listId}>
        {list.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}
