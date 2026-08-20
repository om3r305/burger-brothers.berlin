"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { writeSettings } from "@/lib/settings";

type AiControls = {
  assistantEnabled: boolean;
  voiceEnabled: boolean;
};

const DEFAULT_CONTROLS: AiControls = {
  assistantEnabled: true,
  voiceEnabled: true,
};

const SETTINGS_RESPONSE_META_KEYS = new Set([
  "ok",
  "source",
  "fallbackSaved",
  "memoryCached",
  "dbError",
  "saved",
  "keys",
  "tenant",
  "count",
  "counts",
  "updatedAt",
  "createdAt",
]);

function readAiControls(value: any): AiControls {
  const ai = value?.features?.ai;
  return {
    assistantEnabled:
      typeof ai?.assistantEnabled === "boolean"
        ? ai.assistantEnabled
        : DEFAULT_CONTROLS.assistantEnabled,
    voiceEnabled:
      typeof ai?.voiceEnabled === "boolean"
        ? ai.voiceEnabled
        : DEFAULT_CONTROLS.voiceEnabled,
  };
}

function extractSettingsPayload(value: any) {
  const out: Record<string, any> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;

  for (const [key, item] of Object.entries(value)) {
    if (SETTINGS_RESPONSE_META_KEYS.has(key)) continue;
    out[key] = item;
  }

  return out;
}

async function fetchFreshSettings() {
  const response = await fetch(`/api/settings?fresh=1&ts=${Date.now()}`, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json?.ok === false) {
    throw new Error(json?.error || `HTTP ${response.status}`);
  }

  return {
    raw: json,
    settings: extractSettingsPayload(json),
  };
}

function mirrorControlsLocally(next: AiControls) {
  writeSettings({
    features: {
      ai: {
        assistantEnabled: next.assistantEnabled,
        voiceEnabled: next.voiceEnabled,
      },
    } as any,
  });
}

function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "relative h-8 w-14 shrink-0 rounded-full border transition",
        checked
          ? "border-amber-300/50 bg-amber-400 shadow-[0_0_18px_rgba(251,191,36,.18)]"
          : "border-white/10 bg-stone-800",
        disabled ? "cursor-not-allowed opacity-45" : "active:scale-95",
      ].join(" ")}
    >
      <span
        className={[
          "absolute top-1 h-6 w-6 rounded-full shadow transition-transform",
          checked
            ? "translate-x-7 bg-black"
            : "translate-x-1 bg-stone-300",
        ].join(" ")}
      />
    </button>
  );
}

export default function AiSettingsPanel() {
  const pathname = usePathname();
  const [controls, setControls] = useState<AiControls>(DEFAULT_CONTROLS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const visible = pathname === "/admin/settings" || pathname.startsWith("/admin/settings/");

  const load = useCallback(async () => {
    if (!visible) return;

    setLoading(true);
    setStatus("");
    try {
      const { raw } = await fetchFreshSettings();
      const next = readAiControls(raw);
      setControls(next);
      mirrorControlsLocally(next);
    } catch (error) {
      console.error("[admin/ai-settings] load failed", error);
      setStatus("AI ayarları yüklenemedi. Sayfayı yenileyip tekrar dene.");
    } finally {
      setLoading(false);
    }
  }, [visible]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (next: AiControls) => {
      const previous = controls;
      setControls(next);
      setSaving(true);
      setStatus("");

      try {
        // bb_settings_v6 is the canonical settings record. A partial `features`
        // POST can be shadowed by that canonical record, so read the latest
        // authoritative settings and save the updated AI controls back as one
        // whole admin settings payload. This also avoids overwriting unrelated
        // settings with an old browser snapshot.
        const { settings: currentSettings } = await fetchFreshSettings();
        const nextSettings = {
          ...currentSettings,
          features: {
            ...(currentSettings?.features || {}),
            ai: {
              assistantEnabled: next.assistantEnabled,
              voiceEnabled: next.voiceEnabled,
            },
          },
        };

        const response = await fetch("/api/settings", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ settings: nextSettings }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || json?.ok === false) {
          throw new Error(json?.error || `HTTP ${response.status}`);
        }

        const saved = readAiControls(json);
        setControls(saved);
        mirrorControlsLocally(saved);
        setStatus("Kaydedildi");
        window.setTimeout(() => setStatus(""), 1800);
      } catch (error) {
        console.error("[admin/ai-settings] save failed", error);
        setControls(previous);
        mirrorControlsLocally(previous);
        setStatus("Kaydedilemedi. Tekrar dene.");
      } finally {
        setSaving(false);
      }
    },
    [controls],
  );

  if (!visible) return null;

  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-amber-300/15 bg-[linear-gradient(145deg,rgba(251,191,36,.08),rgba(255,255,255,.025)_45%,rgba(0,0,0,.18))] shadow-[0_16px_48px_rgba(0,0,0,.22)]">
      <div className="border-b border-white/[0.07] px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-amber-300/20 bg-amber-400/10 text-xl shadow-[0_0_22px_rgba(251,191,36,.12)]">
            ✦
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-black text-white sm:text-lg">AI Asistan</h2>
              <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.12em] text-stone-400">
                Müşteri menüsü
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-stone-400 sm:text-sm">
              Normal AI asistanını ve sesli görüşmeyi birbirinden bağımsız yönet.
            </p>
          </div>
          {loading || saving ? (
            <span className="shrink-0 text-xs font-semibold text-amber-300">
              {saving ? "Kaydediliyor…" : "Yükleniyor…"}
            </span>
          ) : null}
        </div>
      </div>

      <div className="divide-y divide-white/[0.06]">
        <div className="flex items-center gap-4 px-4 py-4 sm:px-5">
          <div className="min-w-0 flex-1">
            <div className="font-bold text-stone-100">Normal AI asistanı</div>
            <div className="mt-1 text-xs leading-relaxed text-stone-500">
              Kapatıldığında müşteri sayfalarında AI LED/butonu tamamen gizlenir.
            </div>
          </div>
          <Toggle
            label="Normal AI asistanını aç veya kapat"
            checked={controls.assistantEnabled}
            disabled={loading || saving}
            onChange={(assistantEnabled) =>
              void save({ ...controls, assistantEnabled })
            }
          />
        </div>

        <div className="flex items-center gap-4 px-4 py-4 sm:px-5">
          <div className="min-w-0 flex-1">
            <div className="font-bold text-stone-100">Sesli görüşme</div>
            <div className="mt-1 text-xs leading-relaxed text-stone-500">
              Kapatıldığında Schreiben/yazılı asistan çalışır; Sprechen seçeneği gösterilmez.
            </div>
          </div>
          <Toggle
            label="Sesli görüşmeyi aç veya kapat"
            checked={controls.voiceEnabled}
            disabled={loading || saving || !controls.assistantEnabled}
            onChange={(voiceEnabled) => void save({ ...controls, voiceEnabled })}
          />
        </div>
      </div>

      {status ? (
        <div
          className={`border-t border-white/[0.06] px-4 py-2.5 text-xs font-semibold sm:px-5 ${
            status === "Kaydedildi" ? "text-emerald-300" : "text-amber-300"
          }`}
          role="status"
        >
          {status}
        </div>
      ) : null}
    </section>
  );
}
