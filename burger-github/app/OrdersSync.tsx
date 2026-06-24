// app/OrdersSync.tsx
"use client";
import { useEffect } from "react";

const LS = "bb_orders_v1";

function hash(s: string) { let h=0; for (let i=0;i<s.length;i++) h=(h*31 + s.charCodeAt(i))|0; return String(h>>>0); }

export default function OrdersSync() {
  useEffect(() => {
    let last = "";
    const push = async () => {
      try {
        const raw = localStorage.getItem(LS) || "[]";
        const h = hash(raw);
        if (h === last) return;
        last = h;
        await fetch("/api/orders", { method: "PUT", headers: {"Content-Type":"application/json"}, body: raw });
      } catch {}
    };
    const pull = async () => {
      try {
        const r = await fetch("/api/orders", { cache: "no-store" });
        const j = await r.json().catch(()=>({items:[]}));
        const server = JSON.stringify(j.items || []);
        const ls = localStorage.getItem(LS) || "[]";
        if (hash(server) !== hash(ls)) {
          localStorage.setItem(LS, server);
          window.dispatchEvent(new StorageEvent("storage", { key: LS, newValue: server } as any));
        }
      } catch {}
    };

    pull().then(()=>push());
    const onVis = () => { if (document.visibilityState === "visible") pull(); };
    document.addEventListener("visibilitychange", onVis);
    const onStorage = (e: StorageEvent) => { if (!e.key || e.key === LS) push(); };
    window.addEventListener("storage", onStorage);
    const id = setInterval(push, 2000); // orders daha sık güncellensin
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("storage", onStorage); };
  }, []);
  return null;
}
