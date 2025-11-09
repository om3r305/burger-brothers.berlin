// components/admin/SchemaForm.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { readSettings, writeSettings } from "@/lib/settings";

/** Çok küçük bir JSON-Schema form render’ı
 *  Destek: object, string, boolean, integer, number, array<string>, enum
 */

type JSONSchema = {
  title?: string;
  description?: string;
  type: "object" | "string" | "boolean" | "integer" | "number" | "array";
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  enum?: Array<string | number>;
  enumLabels?: Record<string, string>;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  examples?: string[];
};

type Props = {
  schema: JSONSchema;
  initial?: any;
  description?: string;
};

/* ------------- küçük yardımcılar ------------- */
function getDeep(obj: any, path: string[], fallback?: any) {
  let cur = obj;
  for (const k of path) {
    if (cur == null) return fallback;
    cur = cur[k];
  }
  return cur ?? fallback;
}

function setDeepIn(obj: any, path: string[], value: any) {
  const next = { ...obj };
  let cur: any = next;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    cur[k] = cur[k] ?? {};
    cur = cur[k];
  }
  cur[path[path.length - 1]] = value;
  return next;
}

/* ------------- ana bileşen ------------- */
export default function SchemaForm({ schema, initial }: Props) {
  const [model, setModel] = useState<any>(initial || {});
  const [search, setSearch] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTs, setSavedTs] = useState<number | null>(null);

  useEffect(() => {
    setModel(initial || {});
  }, [initial]);

  const entries = useMemo(() => {
    const props = schema.properties || {};
    return Object.entries(props) as [string, JSONSchema][];
  }, [schema]);

  function isChanged(path: string[]): boolean {
    const cur = getDeep(model, path);
    const init = getDeep(initial || {}, path);
    return JSON.stringify(cur) !== JSON.stringify(init);
  }

  function setDeep(path: string[], value: any) {
    setModel((m: any) => setDeepIn(m, path, value));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const prev = readSettings(); // client’ta senkron dönüyor
      const merged = { ...prev, ...model };
      writeSettings(merged);
      setSavedTs(Date.now());
    } finally {
      setSaving(false);
    }
  }

  const filteredEntries = useMemo(() => {
    const base = entries.filter(([k]) =>
      !search ? true : k.toLowerCase().includes(search.toLowerCase())
    );
    if (!changedOnly) return base;
    return base.filter(([k]) => isChanged([k]));
  }, [entries, search, changedOnly, model, initial]);

  /* -------- alan render’ı (recursive) -------- */
  function renderField(key: string, def: JSONSchema, path: string[]): React.ReactNode {
    const t = def?.type || "string";
    const title = def?.title || key;
    const desc = def?.description;
    const min = def?.minimum;
    const max = def?.maximum;
    const pattern = def?.pattern;

    // ENUM (select)
    if (Array.isArray(def.enum)) {
      const val = getDeep(model, path, String(def.enum[0] ?? ""));
      return (
        <label key={path.join(".")} className="flex flex-col gap-1 rounded-lg border border-stone-200/20 p-3">
          <span>{title}</span>
          {desc ? <span className="text-xs opacity-70">{desc}</span> : null}
          <select
            className="rounded-md border border-stone-300/30 bg-transparent p-2 outline-none"
            value={String(val)}
            onChange={(e) => setDeep(path, e.target.value)}
          >
            {def.enum.map((opt) => {
              const k = String(opt);
              return (
                <option key={k} value={k}>
                  {def.enumLabels?.[k] ?? k}
                </option>
              );
            })}
          </select>
        </label>
      );
    }

    // OBJECT
    if (t === "object" && def.properties) {
      return (
        <fieldset key={path.join(".")} className="mb-4 rounded-xl border border-stone-200/20 p-4">
          <legend className="px-1 text-sm opacity-80">{title}</legend>
          {desc ? <div className="mb-2 text-xs opacity-70">{desc}</div> : null}
          <div className="grid gap-3 md:grid-cols-2">
            {Object.entries(def.properties).map(([k, v]) =>
              renderField(k, v as JSONSchema, [...path, k])
            )}
          </div>
        </fieldset>
      );
    }

    // ARRAY<string>
    if (t === "array" && def.items?.type === "string") {
      const arr: string[] = getDeep(model, path, []) || [];
      const setAt = (i: number, v: string) => setDeep(path, Object.assign([...arr], { [i]: v }));
      const add = () => setDeep(path, [...arr, ""]);
      const rm = (i: number) => {
        const next = arr.slice();
        next.splice(i, 1);
        setDeep(path, next);
      };
      return (
        <div key={path.join(".")} className="rounded-lg border border-stone-200/20 p-3">
          <div className="mb-1">{title}</div>
          {desc ? <div className="mb-2 text-xs opacity-70">{desc}</div> : null}
          <div className="space-y-2">
            {arr.map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  className="flex-1 rounded-md border border-stone-300/30 bg-transparent p-2 outline-none"
                  value={v}
                  onChange={(e) => setAt(i, e.target.value)}
                />
                <button type="button" className="btn-ghost h-9 px-3" onClick={() => rm(i)}>
                  −
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2">
            <button type="button" className="card-cta" onClick={add}>
              Hinzufügen
            </button>
          </div>
        </div>
      );
    }

    // BOOLEAN
    if (t === "boolean") {
      const val = !!getDeep(model, path, false);
      return (
        <label key={path.join(".")} className="flex items-center justify-between rounded-lg border border-stone-200/20 p-3">
          <div>
            <span>{title}</span>
            {desc ? <span className="ml-2 text-xs opacity-70">{desc}</span> : null}
          </div>
          <input
            type="checkbox"
            className="h-5 w-9 cursor-pointer"
            checked={val}
            onChange={(e) => setDeep(path, e.target.checked)}
          />
        </label>
      );
    }

    // INTEGER / NUMBER
    if (t === "integer" || t === "number") {
      const val = getDeep(model, path, 0);
      return (
        <label key={path.join(".")} className="flex flex-col gap-1 rounded-lg border border-stone-200/20 p-3">
          <span>{title}</span>
          {desc ? <span className="text-xs opacity-70">{desc}</span> : null}
          <input
            type="number"
            className="rounded-md border border-stone-300/30 bg-transparent p-2 outline-none"
            value={val ?? 0}
            min={min as number | undefined}
            max={max as number | undefined}
            onChange={(e) => setDeep(path, Number(e.target.value))}
          />
          {pattern ? <span className="text-[10px] opacity-60">Muster: {pattern}</span> : null}
        </label>
      );
    }

    // STRING (fallback)
    const val = getDeep(model, path, "");
    return (
      <label key={path.join(".")} className="flex flex-col gap-1 rounded-lg border border-stone-200/20 p-3">
        <span>{title}</span>
        {desc ? <span className="text-xs opacity-70">{desc}</span> : null}
        <input
          type="text"
          className="rounded-md border border-stone-300/30 bg-transparent p-2 outline-none"
          value={val ?? ""}
          onChange={(e) => setDeep(path, e.target.value)}
          placeholder={def?.examples?.[0] || ""}
          pattern={pattern}
        />
      </label>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* üst bar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Ara…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[240px] rounded-md border border-stone-300/30 bg-transparent p-2 outline-none"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={changedOnly}
            onChange={(e) => setChangedOnly(e.target.checked)}
          />
          Sadece değişenler
        </label>
      </div>

      {/* ana grid */}
      <div className="grid gap-3 md:grid-cols-2">
        {filteredEntries.map(([k, v]) => renderField(k, v, [k]))}
      </div>

      {/* footer */}
      <div className="flex items-center gap-2">
        <button type="submit" className="card-cta">
          {saving ? "Speichert..." : "Speichern"}
        </button>
        {savedTs ? <span className="text-sm opacity-70">Gespeichert.</span> : null}
      </div>
    </form>
  );
}
