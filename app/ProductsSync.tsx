// app/ProductsSync.tsx
"use client";
import { useEffect } from "react";

const LS_PRODUCTS = "bb_products_v1";
const LS_CAMPAIGNS = "bb_campaigns_v1";

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

export default function ProductsSync() {
  useEffect(() => {
    const manual = () => (typeof localStorage!=="undefined" && localStorage.getItem("bb_products_manual")==="1");
    let stop = false;
    let lastSentHash = "";

    const pushIfChanged = async () => {
      try {
        const raw = localStorage.getItem(LS_PRODUCTS) || "[]";
        const h = hash(raw);
        if (h === lastSentHash) return;
        lastSentHash = h;
        await fetch("/api/products", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: raw
        });
      } catch {}
    };

    const pull = async () => {
      if (manual()) return;
      try {
        const res = await fetch("/api/products", { cache: "no-store" });
        const js = await res.json().catch(() => ({ items: [] }));
        const serverStr = JSON.stringify(js.items || []);
        const lsStr = localStorage.getItem(LS_PRODUCTS) || "[]";
        if (hash(serverStr) !== hash(lsStr)) {
          localStorage.setItem(LS_PRODUCTS, serverStr);
          window.dispatchEvent(new StorageEvent("storage", { key: LS_PRODUCTS, newValue: serverStr } as any));
        }
      } catch {}
    };

    // İlk açılışta sunucudan çek
    pull().then(() => pushIfChanged());

    // Görünür olunca kontrol
    const onVis = () => { if (document.visibilityState === "visible" && !manual()) pull(); };
    document.addEventListener("visibilitychange", onVis);

    // Her 3 saniyede bir LS'de değişiklik olduysa sunucuya yaz
    const id = setInterval(pushIfChanged, 3000);

    // Diğer sekmelerden gelen değişiklikleri de yakala
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === LS_PRODUCTS) pushIfChanged();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      stop = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return null;
}
