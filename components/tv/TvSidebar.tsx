"use client";

import clsx from "clsx";
import type { MouseEvent } from "react";
import type { PauseState } from "@/lib/pause";
import type {
  LeftPanel,
  ProductAvailabilityAction,
  ProductAvailabilityMap,
  StoredOrder,
  TvProduct,
} from "@/types/tv";
import { glass } from "@/lib/tv/domain";
import { PauseBlock } from "@/components/tv/PauseBlock";
import { ProductAvailabilityBlock } from "@/components/tv/ProductAvailabilityBlock";
import { SummaryGrid } from "@/components/tv/SummaryGrid";
import { TvSoundControls } from "@/components/tv/TvSoundControls";

export function TvSidebar({
  open,
  panel,
  nowMs,
  orders,
  pause,
  products,
  productAvailability,
  productBusyKey,
  productError,
  sound,
  onClose,
  onPanelChange,
  onPauseChange,
  onProductChange,
  onProductsRefresh,
}: {
  open: boolean;
  panel: LeftPanel;
  nowMs: number;
  orders: StoredOrder[];
  pause: PauseState;
  products: TvProduct[];
  productAvailability: ProductAvailabilityMap;
  productBusyKey: string;
  productError: string;
  sound: {
    enabled: boolean;
    unlocked: boolean;
    volume: number;
    error: string;
    onToggle: () => void | Promise<void>;
    onVolume: (volume: number) => void;
    onTestDelivery: () => void | Promise<void>;
    onTestPickup: () => void | Promise<void>;
  };
  onClose: () => void;
  onPanelChange: (panel: LeftPanel) => void;
  onPauseChange: (pause: PauseState) => void;
  onProductChange: (
    product: TvProduct,
    action: ProductAvailabilityAction,
  ) => void | Promise<void>;
  onProductsRefresh: () => void | Promise<void>;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50"
      onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
        if (event.currentTarget === event.target) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="TV Menü"
    >
      <div
        className={`absolute left-0 top-0 h-full w-[380px] max-w-[92vw] overflow-y-auto p-4 ${glass}`}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="text-lg font-semibold">Bestellübersicht</div>
          <button className="btn-ghost" onClick={onClose}>
            Schließen
          </button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onPanelChange("overview")}
            className={clsx(
              "rounded-xl border px-3 py-2 text-sm font-semibold",
              panel === "overview"
                ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-100"
                : "border-white/10 bg-white/5 text-stone-200",
            )}
          >
            Übersicht
          </button>

          <button
            type="button"
            onClick={() => {
              onPanelChange("articles");
              void onProductsRefresh();
            }}
            className={clsx(
              "rounded-xl border px-3 py-2 text-sm font-semibold",
              panel === "articles"
                ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-100"
                : "border-white/10 bg-white/5 text-stone-200",
            )}
          >
            Artikel
          </button>
        </div>

        {panel === "overview" ? (
          <div className="space-y-4">
            <div>
              <div className="mb-1 text-xs uppercase tracking-wider text-stone-300/70">
                Zusammenfassung
              </div>
              <SummaryGrid orders={orders} />
            </div>

            <div>
              <div className="mb-1 text-xs uppercase tracking-wider text-stone-300/70">
                Ton & Druck
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <TvSoundControls
                  enabled={sound.enabled}
                  unlocked={sound.unlocked}
                  volume={sound.volume}
                  error={sound.error}
                  onToggle={sound.onToggle}
                  onVolume={sound.onVolume}
                  onTestDelivery={sound.onTestDelivery}
                  onTestPickup={sound.onTestPickup}
                />
                <div className="mt-2 text-xs text-stone-400">
                  Standard: Ton aktiv, Lautstärke {sound.volume}%,
                  Druck über lokalen Print-Proxy.
                </div>
              </div>
            </div>

            <PauseBlock pause={pause} setPause={onPauseChange} />
          </div>
        ) : (
          <ProductAvailabilityBlock
            products={products}
            availability={productAvailability}
            nowMs={nowMs}
            busyKey={productBusyKey}
            error={productError}
            onChange={onProductChange}
            onRefresh={onProductsRefresh}
          />
        )}
      </div>
    </div>
  );
}
