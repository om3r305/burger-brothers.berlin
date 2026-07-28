"use client";

import { useCallback, useEffect, useState } from "react";

type Submission = {
  id: string;
  displayName: string;
  moderationStatus: string;
  photoStatus: string;
  hasPhoto: boolean;
  photoUrl: string | null;
  expiresAt: string;
  publishedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  rewardLabel: string;
  customerNumber: number;
  orderId: string;
};

type ApiPayload = {
  ok?: boolean;
  pendingCount?: number;
  submissions?: Submission[];
  error?: string;
};

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return "—";
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export default function RewardModerationPanel({ compact = false }: { compact?: boolean }) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      const response = await fetch("/api/admin/rewards", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as ApiPayload;
      if (!response.ok || !data.ok) throw new Error(data.error || "moderation_load_failed");
      setSubmissions(Array.isArray(data.submissions) ? data.submissions : []);
      setPendingCount(Number(data.pendingCount || 0));
    } catch {
      setError("Kazanan fotoğraf ve isim onayları yüklenemedi.");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function run(id: string, action: "approve_photo" | "approve_name" | "reject" | "republish") {
    if (busyId) return;
    setBusyId(id);
    setError("");
    try {
      const response = await fetch("/api/admin/rewards", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const data = (await response.json().catch(() => ({}))) as ApiPayload;
      if (!response.ok || !data.ok) throw new Error(data.error || "moderation_failed");
      setSubmissions(Array.isArray(data.submissions) ? data.submissions : []);
      setPendingCount(Number(data.pendingCount || 0));
    } catch {
      setError("Onay işlemi tamamlanamadı. Fotoğrafın süresi dolmuş olabilir.");
    } finally {
      setBusyId("");
    }
  }

  const visible = compact ? submissions.slice(0, 12) : submissions.slice(0, 30);

  return (
    <section id="reward-moderation" className="rounded-3xl border border-fuchsia-400/25 bg-gradient-to-br from-fuchsia-500/10 via-black/20 to-amber-500/10 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black">📸 Kazanan isim ve fotoğraf onayı</h2>
          <p className="mt-1 text-sm text-stone-400">
            Fotoğraflar private ve geçicidir. Reddedildiğinde, yayından sonra veya süre dolunca gerçek dosya otomatik silinir.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-fuchsia-400/40 bg-fuchsia-400/15 px-3 py-1.5 text-sm font-black text-fuchsia-100">
            Bekleyen: {pendingCount}
          </span>
          <button type="button" onClick={() => void load()} className="rounded-xl border border-stone-600 px-3 py-2 text-sm font-bold">
            Yenile
          </button>
        </div>
      </div>

      {error ? <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-700 p-6 text-center text-stone-400 lg:col-span-2">
            Henüz isim veya fotoğraf gönderimi yok.
          </div>
        ) : null}

        {visible.map((item) => {
          const pending = item.moderationStatus === "pending";
          const expired = new Date(item.expiresAt).getTime() <= Date.now();
          return (
            <article key={item.id} className={`rounded-2xl border p-4 ${pending ? "border-amber-400/40 bg-amber-400/5" : "border-stone-700 bg-black/25"}`}>
              <div className={`grid gap-4 ${item.hasPhoto ? "grid-cols-[110px_minmax(0,1fr)]" : "grid-cols-1"}`}>
                {item.hasPhoto && item.photoUrl ? (
                  <div className="aspect-square overflow-hidden rounded-2xl border border-white/20 bg-black">
                    <img src={item.photoUrl} alt={item.displayName} className="h-full w-full object-cover" />
                  </div>
                ) : null}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="truncate text-lg">{item.displayName}</strong>
                    <span className="rounded-full bg-stone-800 px-2 py-1 text-xs font-bold">No. {item.customerNumber || "—"}</span>
                  </div>
                  <p className="mt-2 text-sm font-bold text-emerald-200">{item.rewardLabel}</p>
                  <p className="mt-2 text-xs text-stone-400">Gönderildi: {dateTime(item.createdAt)}</p>
                  <p className="text-xs text-stone-400">Fotoğraf son süre: {dateTime(item.expiresAt)}</p>
                  <p className="mt-2 text-xs font-bold uppercase tracking-wide text-stone-300">
                    Durum: {item.moderationStatus} {expired ? "· süre doldu" : ""}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {pending && item.hasPhoto && !expired ? (
                  <button
                    type="button"
                    disabled={Boolean(busyId)}
                    onClick={() => void run(item.id, "approve_photo")}
                    className="rounded-xl bg-emerald-500 px-3 py-2 text-sm font-black text-black disabled:opacity-50"
                  >
                    Fotoğrafla yayınla
                  </button>
                ) : null}
                {pending ? (
                  <button
                    type="button"
                    disabled={Boolean(busyId)}
                    onClick={() => void run(item.id, "approve_name")}
                    className="rounded-xl bg-blue-500 px-3 py-2 text-sm font-black text-white disabled:opacity-50"
                  >
                    Yalnız adı yayınla
                  </button>
                ) : null}
                {pending ? (
                  <button
                    type="button"
                    disabled={Boolean(busyId)}
                    onClick={() => void run(item.id, "reject")}
                    className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm font-black text-red-200 disabled:opacity-50"
                  >
                    Reddet ve sil
                  </button>
                ) : null}
                {!pending && item.moderationStatus.startsWith("approved") ? (
                  <button
                    type="button"
                    disabled={Boolean(busyId)}
                    onClick={() => void run(item.id, "republish")}
                    className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm font-black text-amber-100 disabled:opacity-50"
                  >
                    Tekrar yayınla
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
