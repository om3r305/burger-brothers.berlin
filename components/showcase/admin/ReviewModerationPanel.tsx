"use client";

import type { ShowcaseReview } from "@/lib/showcase/types";

type Props = {
  reviews: ShowcaseReview[];
  busy: boolean;
  onSync: () => void;
  onApproval: (id: string, approved: boolean) => void;
};

export default function ReviewModerationPanel({
  reviews,
  busy,
  onSync,
  onApproval,
}: Props) {
  const pendingCount = reviews.filter((review) => !review.approved).length;

  return (
    <section
      id="google-review-moderation"
      className="scroll-mt-24 rounded-2xl border border-amber-600/35 bg-amber-950/15 p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-black uppercase tracking-[.18em] text-amber-300">
            Google yorum merkezi
          </div>
          <h2 className="mt-1 text-lg font-black text-white">
            Yorumları kontrol et ve ekranlarda yayınla
          </h2>
          <p className="text-sm text-stone-400">
            Yeni yorumlar otomatik yayınlanmaz. TV yalnız onaylanan yorumları gösterir.
          </p>
        </div>
        <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm font-black text-amber-100">
          Bekleyen: {pendingCount}
        </span>
        <button
          type="button"
          onClick={onSync}
          disabled={busy}
          className="rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-black text-black disabled:opacity-50"
        >
          Google yorumlarını yenile
        </button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {reviews.slice(0, 12).map((review) => (
          <article
            key={review.id}
            className={`rounded-xl border p-3 ${
              review.approved
                ? "border-emerald-500/50 bg-emerald-950/20"
                : "border-stone-700 bg-stone-950/55"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                {review.authorPhotoUrl ? (
                  <img
                    src={review.authorPhotoUrl}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : null}
                <strong className="truncate text-white">{review.authorName}</strong>
              </div>
              <span className="shrink-0 text-amber-300">
                {"★".repeat(Math.round(review.rating))}
              </span>
            </div>
            <p className="mt-2 line-clamp-3 text-sm text-stone-300">
              {review.comment || "Yazısız puanlama"}
            </p>
            <button
              type="button"
              onClick={() => onApproval(review.id, !review.approved)}
              className={`mt-3 w-full rounded-lg px-3 py-2 text-xs font-black ${
                review.approved
                  ? "bg-red-950 text-red-200"
                  : "bg-emerald-500 text-black"
              }`}
            >
              {review.approved ? "Yayından kaldır" : "Onayla ve yayınla"}
            </button>
          </article>
        ))}
        {reviews.length === 0 ? (
          <div className="rounded-xl border border-dashed border-stone-700 p-4 text-sm text-stone-400">
            Henüz senkronize edilmiş yorum yok.
          </div>
        ) : null}
      </div>
    </section>
  );
}
