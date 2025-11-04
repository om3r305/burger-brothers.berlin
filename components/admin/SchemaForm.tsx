// components/admin/SchemaForm.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { ServerSettings } from "@/lib/server/settings";
import { readSettings, writeSettings, type ClientSettings } from "@/lib/settings";

type JsonSchema = {
  title?: string;
  type: string;
  properties?: Record<string, any>;
  description?: string;
};

type Props = {
  schema: JsonSchema;
  initial?: any;
  description?: string;
};

/** A very small schema→form renderer for nested objects with boolean, integer and string. */
export default function SchemaForm({ schema, initial }: Props) {
  const [model, setModel] = useState<any>(initial || {});
  const [search, setSearch] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTs, setSavedTs] = useState<number | null>(null);

  useEffect(() => {
    setModel(initial || {});
  }, [initial]);

  const entries = useMemo(() => {
    const props = schema.properties || {};
    return Object.entries(props) as [string, any][];
  }, [schema]);

  function isChanged(path: string[]): boolean {
    const cur = getDeep(model, path);
    const init = getDeep(initial || {}, path);
    return JSON.stringify(cur) !== JSON.stringify(init);
  }
  function setDeep(path: string[], value: any) {
    setModel((m: any) => {
      const next = { ...m };
      let cur: any = next;
      for (let i = 0; i < path.length - 1; i++) {
        const k = path[i];
        cur[k] = cur[k] ?? {};
        cur = cur[k];
      }
      cur[path[path.length - 1]] = value;
      return next;
    });
  }

  function getDeep(obj: any, path: string[], fallback?: any) {
    let cur = obj;
    for (const k of path) {
      if (!cur) return fallback;
      cur = cur[k];
    }
    return cur ?? fallback;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      // Merge shallowly into existing settings to avoid data loss
      const prev = await readSettings();
      const merged = { ...prev, ...model };
      await writeSettings(merged);
      setSavedTs(Date.now());
    } finally {
      setSaving(false);
    }
  }

  function renderField(key: string, def: any, path: string[]) {
    const t = def?.type || "string";
    const title = def?.title || key;
    const desc = def?.description;
    const min = def?.minimum; const max = def?.maximum; const pattern = def?.pattern; const enumLabels = def?.enumLabels as Record<string,string> | undefined;
    const desc = def?.description;
    const val = getDeep(model, path, t === "boolean" ? false : t === "integer" ? 0 : "");

    /* ENUM SELECT */
    if (Array.isArray(def?.enum)) {
      const val = getDeep(model, path, def.enum[0] ?? "");
      return (
        <label key={path.join(".")} className="flex flex-col gap-1 rounded-lg border border-stone-200/20 p-3">
          <span>{title}</span>{desc ? <span className="text-xs opacity-70">{desc}</span> : null}{typeof min==="number" ? <span className=\"ml-2 rounded bg-stone-800/50 px-2 py-0.5 text-[10px]\">{t('schema.min',{v:String(min)})}</span> : null}{typeof max==="number" ? <span className=\"ml-2 rounded bg-stone-800/50 px-2 py-0.5 text-[10px]\">{t('schema.max',{v:String(max)})}</span> : null}{pattern ? <span className=\"ml-2 rounded bg-stone-800/50 px-2 py-0.5 text-[10px]\">{t('schema.pattern',{v:String(pattern)})}</span> : null}
          {desc ? <span className="text-xs opacity-70">{desc}</span> : null}{typeof min==="number" ? <span className=\"ml-2 rounded bg-stone-800/50 px-2 py-0.5 text-[10px]\">{t('schema.min',{v:String(min)})}</span> : null}{typeof max==="number" ? <span className=\"ml-2 rounded bg-stone-800/50 px-2 py-0.5 text-[10px]\">{t('schema.max',{v:String(max)})}</span> : null}{pattern ? <span className=\"ml-2 rounded bg-stone-800/50 px-2 py-0.5 text-[10px]\">{t('schema.pattern',{v:String(pattern)})}</span> : null}
          <select
            className="rounded-md border border-stone-300/30 bg-transparent p-2 outline-none"
            value={val}
            onChange={(e) => setDeep(path, e.target.value)}
          >
            {def.enum.map((opt: any) => <option key={String(opt)} value={String(opt)}>{enumLabels?.[String(opt)] ?? String(opt)}</option>)}
          </select>
        </label>
      );
    }
    if (t === "object" && def.properties) {
      return (
        <fieldset key={path.join(".")} className="mb-4 rounded-xl border border-stone-200/20 p-4">
          <legend className="px-1 text-sm opacity-80">{title}</legend>
          <div className="grid gap-3 md:grid-cols-2">
            {Object.entries(def.properties).map(([k, v]) => renderField(k, v, [...path, k]))}
          </div>
        </fieldset>
      );
    }

    /* ARRAY of STRINGS */
    if (t === "array" && def.items?.type === "string") {
      const arr: string[] = getDeep(model, path, []) || [];
      const setAt = (i: number, v: string) => {
        const next = [...arr]; next[i] = v; setDeep(path, next);
      };
      const add = () => setDeep(path, [...arr, ""]);
      const rm = (i: number) => { const next = arr.slice(); next.splice(i,1); setDeep(path, next); };
      return (
        <div key={path.join(".")} className="rounded-lg border border-stone-200/20 p-3">
          <div className="mb-2">{title}</div>
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
                <button type="button" className="btn-ghost h-9 px-3" onClick={() => rm(i)}>−</button>
              </div>
            ))}
          </div>
          <div className="mt-2">
            <button type="button" className="card-cta" onClick={add}>Hinzufügen</button>
          </div>
        </div>
      );
    }
    if (t === "boolean") {
      return (
        <label key={path.join(".")} className="flex items-center justify-between rounded-lg border border-stone-200/20 p-3">
          <span>{title}</span>{desc ? <span className="text-xs opacity-70">{desc}</span> : null}{typeof min==="number" ? <span className=\"ml-2 rounded bg-stone-800/50 px-2 py-0.5 text-[10px]\">{t('schema.min',{v:String(min)})}</span> : null}{typeof max==="number" ? <span className=\"ml-2 rounded bg-stone-800/50 px-2 py-0.5 text-[10px]\">{t('schema.max',{v:String(max)})}</span> : null}{pattern ? <span className=\"ml-2 rounded bg-stone-800/50 px-2 py-0.5 text-[10px]\">{t('schema.pattern',{v:String(pattern)})}</span> : null}
          <input
            type="checkbox"
            className="h-5 w-9 cursor-pointer"
            checked={!!val}
            onChange={(e) => setDeep(path, e.target.checked)}
          />
        </label>
      );
    }

    if (t === "integer") {
      return (
        <label key={path.join(".")} className="flex flex-col gap-1 rounded-lg border border-stone-200/20 p-3">
          <span>{title}</span>{desc ? <span className="text-xs opacity-70">{desc}</span> : null}{typeof min==="number" ? <span className=\"ml-2 rounded bg-stone-800/50 px-2 py-0.5 text-[10px]\">{t('schema.min',{v:String(min)})}</span> : null}{typeof max==="number" ? <span className=\"ml-2 rounded bg-stone-800/50 px-2 py-0.5 text-[10px]\">{t('schema.max',{v:String(max)})}</span> : null}{pattern ? <span className=\"ml-2 rounded bg-stone-800/50 px-2 py-0.5 text-[10px]\">{t('schema.pattern',{v:String(pattern)})}</span> : null}
          <input
            type="number"
            className="rounded-md border border-stone-300/30 bg-transparent p-2 outline-none"
            value={val ?? 0}
            onChange={(e) => setDeep(path, Number(e.target.value))}
          />
        </label>
      );
    }

    // string / fallback
    return (
      <label key={path.join(".")} className="flex flex-col gap-1 rounded-lg border border-stone-200/20 p-3">
        <span>{title}</span>{desc ? <span className="text-xs opacity-70">{desc}</span> : null}{typeof min==="number" ? <span className=\"ml-2 rounded bg-stone-800/50 px-2 py-0.5 text-[10px]\">{t('schema.min',{v:String(min)})}</span> : null}{typeof max==="number" ? <span className=\"ml-2 rounded bg-stone-800/50 px-2 py-0.5 text-[10px]\">{t('schema.max',{v:String(max)})}</span> : null}{pattern ? <span className=\"ml-2 rounded bg-stone-800/50 px-2 py-0.5 text-[10px]\">{t('schema.pattern',{v:String(pattern)})}</span> : null}
        <input
          type="text"
          className="rounded-md border border-stone-300/30 bg-transparent p-2 outline-none"
          value={val ?? ""}
          onChange={(e) => setDeep(path, e.target.value)}
          placeholder={def?.examples?.[0] || ""}
        />
      </label>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" placeholder={t('schema.search_placeholder')} value={search} onChange={(e)=>setSearch(e.target.value)} className="min-w-[240px] rounded-md border border-stone-300/30 bg-transparent p-2 outline-none" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={changedOnly} onChange={(e)=>setChangedOnly(e.target.checked)} /> {t('schema.changed_only')}</label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {(changedOnly ? filteredEntries.filter(([k,v])=>isChanged([k])) : filteredEntries).map(([k, v]) => renderField(k, v, [k]))}
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" className="card-cta">{saving ? "Speichert..." : "Speichern"}</button>
        {savedTs ? <span className="text-sm opacity-70">Gespeichert.</span> : null}
      </div>
    </form>
  );
}

  const filteredEntries = useMemo(() => {
    const base = entries;
    return base.filter(([k, v]) => {
      const hit = !search || k.toLowerCase().includes(search.toLowerCase());
      return hit;
    });
  }, [entries, search]);
