"use client";

import {
  MENU_TRANSITION_STYLES,
  createDefaultMenuTransitionSettings,
  normalizeMenuTransitionSettings,
  type MenuTransitionOverride,
  type MenuTransitionSettings,
  type MenuTransitionStyle,
} from "@/lib/menu-transitions";
import {
  MENU_NAV_KEYS,
  MENU_NAV_LABELS,
  type MenuNavKey,
} from "@/lib/menu-navigation";

type Props = {
  value: unknown;
  onChange: (value: MenuTransitionSettings) => void;
};

const STYLE_LABELS: Record<MenuTransitionStyle, string> = {
  "edge-glow": "BB Kenar Işığı",
  "color-wave": "Renk Dalgası",
  "soft-ribbon": "Yumuşak Işık Şeridi",
  "cinematic-video": "Sinematik Video",
  "theme-auto": "Temaya Uygun iOS Cam",
  minimal: "iOS Şeffaf Cam",
};

const STYLE_DESCRIPTIONS: Record<MenuTransitionStyle, string> = {
  "edge-glow": "Çektiğin kenarda kategori rengi yanar; yeni menü adı kenardan görünür.",
  "color-wave": "Kategori rengini kenarda katmanlı ve canlı bir ışık olarak gösterir.",
  "soft-ribbon": "Kenarda ince, sakin ve metalik ışık şeritleri kullanır.",
  "cinematic-video": "Mevcut gerçek kategori videosunu kaydırma yönünden gösterir.",
  "theme-auto": "iOS Liquid Glass hissini aktif temanın üç rengiyle çok hafifçe tonlar.",
  minimal: "Tema renginden bağımsız, renksiz ve ışığı yumuşakça kıran iOS tarzı cam kullanır.",
};

function TransitionSelect({
  value,
  onChange,
  allowInherit = false,
}: {
  value: MenuTransitionStyle | MenuTransitionOverride;
  onChange: (value: MenuTransitionStyle | MenuTransitionOverride) => void;
  allowInherit?: boolean;
}) {
  return (
    <select
      className="w-full rounded-xl border border-stone-700 bg-stone-950 px-3 py-2.5 text-sm outline-none"
      value={value}
      onChange={(event) =>
        onChange(event.target.value as MenuTransitionStyle | MenuTransitionOverride)
      }
    >
      {allowInherit ? <option value="inherit">Genel ayarı kullan</option> : null}
      {MENU_TRANSITION_STYLES.map((style) => (
        <option key={style} value={style}>
          {STYLE_LABELS[style]}
        </option>
      ))}
    </select>
  );
}

export default function MenuTransitionEditor({ value, onChange }: Props) {
  const settings = normalizeMenuTransitionSettings(value);

  const commit = (patch: Partial<MenuTransitionSettings>) => {
    onChange(normalizeMenuTransitionSettings({ ...settings, ...patch }));
  };

  const updateCategoryColor = (key: MenuNavKey, color: string) => {
    commit({
      categoryColors: {
        ...settings.categoryColors,
        [key]: color,
      },
    });
  };

  const updateCategoryStyle = (
    key: MenuNavKey,
    style: MenuTransitionOverride,
  ) => {
    commit({
      categoryStyles: {
        ...settings.categoryStyles,
        [key]: style,
      },
    });
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-stone-700/60 bg-stone-950/35 p-4">
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block font-semibold">Mobil kaydırma efekti</span>
              <span className="mt-1 block text-xs leading-relaxed text-stone-400">
                Sağ/sol kaydırma çalışmaya devam eder; bu anahtar yalnızca görsel geçişi açar veya kapatır.
              </span>
            </span>
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 accent-orange-500"
              checked={settings.enabled}
              onChange={(event) => commit({ enabled: event.target.checked })}
            />
          </label>

          <label className="mt-4 block text-sm">
            <span className="mb-1.5 block text-stone-300">Genel geçiş şekli</span>
            <TransitionSelect
              value={settings.style}
              onChange={(style) => commit({ style: style as MenuTransitionStyle })}
            />
          </label>

          <p className="mt-2 text-xs leading-relaxed text-stone-400">
            {STYLE_DESCRIPTIONS[settings.style]}
          </p>

          <label className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-stone-700/50 bg-stone-900/55 px-3 py-3 text-sm">
            <span>
              <span className="block font-semibold">Kategori adını göster</span>
              <span className="mt-0.5 block text-xs text-stone-400">Kaydırılan kenarda kısa ve sade başlık.</span>
            </span>
            <input
              type="checkbox"
              className="h-5 w-5 accent-orange-500"
              checked={settings.labelEnabled}
              onChange={(event) => commit({ labelEnabled: event.target.checked })}
            />
          </label>
        </div>

        <div className="rounded-2xl border border-stone-700/60 bg-stone-950/35 p-4">
          <label className="block text-sm">
            <span className="flex items-center justify-between gap-3">
              <span className="text-stone-300">Tamamlama hızı</span>
              <b>{settings.durationMs} ms</b>
            </span>
            <input
              type="range"
              min={280}
              max={900}
              step={20}
              className="mt-3 w-full accent-orange-500"
              value={settings.durationMs}
              onChange={(event) => commit({ durationMs: Number(event.target.value) })}
            />
            <span className="mt-1 flex justify-between text-[11px] text-stone-500">
              <span>Hızlı</span>
              <span>Sinematik</span>
            </span>
          </label>

          <label className="mt-5 block text-sm">
            <span className="flex items-center justify-between gap-3">
              <span className="text-stone-300">Kenar ışığı yoğunluğu</span>
              <b>%{settings.shadowStrength}</b>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              className="mt-3 w-full accent-orange-500"
              value={settings.shadowStrength}
              onChange={(event) => commit({ shadowStrength: Number(event.target.value) })}
            />
          </label>

          <button
            type="button"
            className="btn-ghost mt-5 w-full justify-center"
            onClick={() => onChange(createDefaultMenuTransitionSettings())}
          >
            Önerilen ayarlara dön
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-stone-700/60 bg-stone-950/35 p-4">
        <div className="mb-4">
          <div className="font-semibold">Kategoriye özel renk ve geçiş</div>
          <div className="mt-1 text-xs leading-relaxed text-stone-400">
            “Genel ayarı kullan” seçiliyse yukarıdaki geçiş uygulanır. İstersen yalnızca tek bir gruba video veya farklı bir efekt verebilirsin.
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {MENU_NAV_KEYS.map((key) => (
            <div
              key={key}
              className="grid grid-cols-[minmax(0,1fr)_52px] gap-3 rounded-xl border border-stone-700/50 bg-stone-900/55 p-3"
            >
              <div className="min-w-0">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <span
                    className="h-3 w-3 rounded-full shadow-[0_0_12px_currentColor]"
                    style={{
                      backgroundColor: settings.categoryColors[key],
                      color: settings.categoryColors[key],
                    }}
                  />
                  {MENU_NAV_LABELS[key]}
                </div>
                <TransitionSelect
                  allowInherit
                  value={settings.categoryStyles[key]}
                  onChange={(style) =>
                    updateCategoryStyle(key, style as MenuTransitionOverride)
                  }
                />
              </div>

              <label className="flex cursor-pointer flex-col items-center justify-end gap-1 text-[10px] text-stone-400">
                Renk
                <input
                  type="color"
                  className="h-10 w-12 cursor-pointer rounded-lg border border-stone-700 bg-transparent p-1"
                  value={settings.categoryColors[key]}
                  onChange={(event) => updateCategoryColor(key, event.target.value)}
                />
              </label>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
