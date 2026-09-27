"use client";

import {
  normalizeMenuTransitionSettings,
  type MenuTransitionSettings,
} from "@/lib/menu-transitions";

type Props = {
  value: unknown;
  onChange: (value: MenuTransitionSettings) => void;
};

// Mobil kaydırma geçişi sadeleştirildi: renkli kenar, etiket ve video stilleri
// kaldırıldı. Kayıtlı ayar biçimi (stil, renkler vb.) geriye dönük uyum için
// korunur; müşteri tarafı yalnızca `enabled` alanını kullanır.
export default function MenuTransitionEditor({ value, onChange }: Props) {
  const settings = normalizeMenuTransitionSettings(value);

  return (
    <div className="rounded-2xl border border-stone-700/60 bg-stone-950/35 p-4">
      <label className="flex items-start justify-between gap-4">
        <span>
          <span className="block font-semibold">Mobil kaydırma geçişi</span>
          <span className="mt-1 block text-xs leading-relaxed text-stone-400">
            Sağ/sol kaydırma her zaman çalışır. Açıkken kategori değişirken içerik
            kısa ve sade bir yumuşak geçiş yapar; kapalıyken direkt değişir.
          </span>
        </span>
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 accent-orange-500"
          checked={settings.enabled}
          onChange={(event) =>
            onChange(
              normalizeMenuTransitionSettings({
                ...settings,
                enabled: event.target.checked,
              }),
            )
          }
        />
      </label>
    </div>
  );
}
