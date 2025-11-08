// components/CouponBox.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ui/toast"; // ← senin hook'un
import { readSettings } from "@/lib/settings";
import {
  getAllCoupons,
  findIssuedByCode,
  type CouponDef,
  type IssuedCoupon,
} from "@/lib/coupons";

const LS_ACTIVE = "bb_active_coupon_code";
const LS_META = "bb_active_coupon_meta";

type Status = { type: "none" | "ok" | "error"; msg?: string };

type ActiveMeta = {
  kind: "static" | "issued";
  couponId: string;
  issuedId?: string | null;
  type: CouponDef["type"];
  value: number;
  title?: string;
};

function nowTs() { return Date.now(); }
function parseTs(s?: string) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export default function CouponBox() {
  const { toast, ToastNode } = useToast(); // ← ToastNode bir node, component değil
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status>({ type: "none" });

  const staticCoupons = useMemo(() => {
    const s: any = readSettings() || {};
    const list: any[] = Array.isArray(s?.coupons) ? s.coupons : [];
    return list
      .filter((c) => c && (c.code || c.kod || c.name))
      .map((c) => ({
        code: String(c.code ?? c.kod ?? c.name ?? "").trim().toUpperCase(),
        active: c.active !== false,
        type: (c.type ?? "percent") as CouponDef["type"],
        value: Number(c.value ?? c.rate ?? 0),
        validFrom: parseTs(c.validFrom ?? c.start),
        validTo: parseTs(c.validTo ?? c.end),
        title: c.title ?? c.label ?? "",
      }));
  }, []);

  const defs = useMemo(() => getAllCoupons(), []);

  useEffect(() => {
    try {
      const prev = (localStorage.getItem(LS_ACTIVE) || "").trim();
      if (!prev) return;
      validateAndPersist(prev, { silent: true });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onApply = () => validateAndPersist(code.trim(), { silent: false });

  const onClear = () => {
    try {
      localStorage.removeItem(LS_ACTIVE);
      localStorage.removeItem(LS_META);
      window.dispatchEvent(new StorageEvent("storage", { key: LS_ACTIVE } as any));
    } catch {}
    setStatus({ type: "none" });
    setCode("");
    toast?.("Gutschein entfernt");
  };

  return (
    <>
      {/* ← BİLEŞEN DEĞİL: node olduğu için doğrudan yerleştiriyoruz */}
      {ToastNode}

      <div className="rounded-xl border border-stone-700/60 bg-stone-900/60 p-3 space-y-2">
        <div className="text-sm font-semibold">Gutschein</div>

        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter") onApply(); }}
            placeholder="CODE"
            className="w-full rounded-md bg-stone-800/60 p-2 outline-none uppercase tracking-widest"
          />
          <button onClick={onApply} className="rounded-md bg-emerald-500 px-3 py-2 font-semibold text-black">
            Prüfen
          </button>
          <button onClick={onClear} className="rounded-md bg-stone-700 px-3 py-2 font-semibold" title="Kodu temizle">
            ✕
          </button>
        </div>

        {status.type !== "none" && (
          <div className={`text-sm ${status.type === "ok" ? "text-emerald-400" : "text-rose-400"}`}>
            {status.msg}
          </div>
        )}
      </div>
    </>
  );

  /* ───────── helpers ───────── */

  function validateAndPersist(rawInput: string, opts: { silent: boolean }) {
    const input = rawInput.toUpperCase().trim();
    if (!input) {
      if (!opts.silent) setStatus({ type: "error", msg: "Bitte Code eingeben." });
      return;
    }

    // 1) Issued (tekil) kod
    const issued = findIssuedByCode(input);
    if (issued) {
      const ok = validateIssued(issued);
      if (!ok.ok) {
        const m = mapErr(ok.reason);
        if (!opts.silent) setStatus({ type: "error", msg: m });
        toast?.(m);
        if (opts.silent) {
          try {
            localStorage.removeItem(LS_ACTIVE);
            localStorage.removeItem(LS_META);
            window.dispatchEvent(new StorageEvent("storage", { key: LS_ACTIVE } as any));
          } catch {}
        }
        return;
      }
      persistActive(input, {
        kind: "issued",
        couponId: issued.couponId,
        issuedId: issued.id,
        type: (defs.find((d) => d.id === issued.couponId)?.type ?? "percent") as any,
        value: Number(defs.find((d) => d.id === issued.couponId)?.value ?? 0),
        title: defs.find((d) => d.id === issued.couponId)?.title,
      });
      setCode(input);
      if (!opts.silent) {
        setStatus({ type: "ok", msg: "Gutschein akzeptiert." });
        toast?.("Gutschein akzeptiert");
      }
      return;
    }

    // 2) Statik listede
    const found = staticCoupons.find((c) => c.active && c.code === input);
    if (!found) {
      if (!opts.silent) {
        setStatus({ type: "error", msg: "Ungültiger Gutschein." });
        toast?.("Ungültiger Gutschein");
      }
      if (opts.silent) {
        try {
          localStorage.removeItem(LS_ACTIVE);
          localStorage.removeItem(LS_META);
          window.dispatchEvent(new StorageEvent("storage", { key: LS_ACTIVE } as any));
        } catch {}
      }
      return;
    }

    const now = nowTs();
    if (found.validFrom && found.validFrom > now) {
      if (!opts.silent) setStatus({ type: "error", msg: "Noch nicht gültig." });
      return;
    }
    if (found.validTo && found.validTo < now) {
      if (!opts.silent) setStatus({ type: "error", msg: "Gutschein abgelaufen." });
      return;
    }

    persistActive(input, {
      kind: "static",
      couponId: "static:" + found.code,
      type: found.type,
      value: Number(found.value || 0),
      title: found.title,
    });
    setCode(input);
    if (!opts.silent) {
      setStatus({ type: "ok", msg: "Gutschein akzeptiert." });
      toast?.("Gutschein akzeptiert");
    }
  }

  function persistActive(code: string, meta: ActiveMeta) {
    try {
      localStorage.setItem(LS_ACTIVE, code);
      localStorage.setItem(LS_META, JSON.stringify(meta));
      window.dispatchEvent(new StorageEvent("storage", { key: LS_ACTIVE } as any));
    } catch {}
  }

  function validateIssued(iss: IssuedCoupon): { ok: true } | { ok: false; reason: string } {
    const now = nowTs();
    const def = defs.find((d) => d.id === iss.couponId);
    if (!def) return { ok: false, reason: "not_found" };
    if (iss.used) return { ok: false, reason: "used" };
    if (iss.expiresAt && iss.expiresAt < now) return { ok: false, reason: "expired" };
    if (def.validFrom && now < def.validFrom) return { ok: false, reason: "not_started" };
    if (def.validUntil && now > def.validUntil) return { ok: false, reason: "expired" };
    if (iss.note === "scheduled" && iss.issuedAt > now) return { ok: false, reason: "not_available_yet" };
    return { ok: true };
  }

  function mapErr(r: string) {
    switch (r) {
      case "used": return "Dieser Gutschein wurde bereits benutzt.";
      case "expired": return "Gutschein abgelaufen.";
      case "not_started": return "Noch nicht gültig.";
      case "not_available_yet": return "Gutschein ist noch nicht freigeschaltet.";
      default: return "Gutschein kann nicht verwendet werden.";
    }
  }
}
