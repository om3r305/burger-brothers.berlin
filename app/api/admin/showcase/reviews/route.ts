import { NextResponse } from "next/server";
import {
  requireMutationRole,
  requireSessionRole,
} from "@/lib/server/request-security";
import {
  readShowcaseAdminState,
  requestOrigin,
  saveShowcaseSetting,
  SHOWCASE_REVIEWS_KEY,
} from "@/lib/showcase/server";
import {
  createAdminInboxNotification,
  resolveAdminInboxNotification,
} from "@/lib/server/admin-inbox";
import type { ShowcaseReview } from "@/lib/showcase/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store" };

function json(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, { status, headers: HEADERS });
}

function cleanReviews(value: unknown, fallback: ShowcaseReview[]) {
  return Array.isArray(value) ? (value.slice(0, 250) as ShowcaseReview[]) : fallback;
}

export async function GET(req: Request) {
  const auth = await requireSessionRole(req, "admin");
  if (auth) return auth;
  const state = await readShowcaseAdminState(requestOrigin(req));
  return json({ ok: true, reviews: state.reviews });
}

export async function PUT(req: Request) {
  const auth = await requireMutationRole(req, ["admin"]);
  if (auth) return auth;

  const payload = await req.json().catch(() => ({}));
  const state = await readShowcaseAdminState(requestOrigin(req));
  const reviews = cleanReviews(payload?.reviews, state.reviews);
  const previous = new Map<string, ShowcaseReview>(
    state.reviews.map((review) => [review.id, review]),
  );

  await saveShowcaseSetting(state.tenantId, SHOWCASE_REVIEWS_KEY, reviews as any);

  await Promise.all(
    reviews.map(async (review) => {
      const before = previous.get(review.id);
      if (review.approved) {
        await resolveAdminInboxNotification({
          sourceType: "google_review",
          sourceId: review.id,
          type: "google_review_approval",
        });
      } else if (before?.approved === true) {
        await createAdminInboxNotification({
          type: "google_review_approval",
          title: "Google yorumu yeniden onay bekliyor",
          body: `${review.authorName || "Google Nutzer"} yorumunun yayını kapatıldı.`,
          url: "/admin/showcase#google-review-moderation",
          sourceType: "google_review",
          sourceId: review.id,
        });
      }
    }),
  );

  return json({ ok: true, reviews });
}

export async function POST(req: Request) {
  const auth = await requireMutationRole(req, ["admin"]);
  if (auth) return auth;

  const token = process.env.GOOGLE_BUSINESS_ACCESS_TOKEN;
  const account = process.env.GOOGLE_BUSINESS_ACCOUNT_ID;
  const location = process.env.GOOGLE_BUSINESS_LOCATION_ID;
  if (!token || !account || !location) {
    return json({ ok: false, error: "GOOGLE_BUSINESS_NOT_CONFIGURED" }, 503);
  }

  const url = `https://mybusiness.googleapis.com/v4/accounts/${account}/locations/${location}/reviews?pageSize=50`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    return json({ ok: false, error: `GOOGLE_REVIEWS_${response.status}` }, 502);
  }

  const data = (await response.json().catch(() => ({}))) as {
    reviews?: Array<Record<string, any>>;
  };
  const state = await readShowcaseAdminState(requestOrigin(req));
  const old = new Map<string, ShowcaseReview>(
    state.reviews.map((review) => [review.id, review]),
  );
  const ratingMap: Record<string, number> = {
    ONE: 1,
    TWO: 2,
    THREE: 3,
    FOUR: 4,
    FIVE: 5,
  };

  const reviews: ShowcaseReview[] = (data.reviews || []).map((item) => ({
    id: String(item.reviewId || ""),
    authorName: String(item.reviewer?.displayName || "Google Nutzer"),
    authorPhotoUrl: item.reviewer?.profilePhotoUrl
      ? String(item.reviewer.profilePhotoUrl)
      : undefined,
    rating: ratingMap[String(item.starRating)] || 5,
    comment: String(item.comment || ""),
    createTime: item.createTime ? String(item.createTime) : undefined,
    updateTime: item.updateTime ? String(item.updateTime) : undefined,
    approved: old.get(String(item.reviewId || ""))?.approved === true,
    source: "google",
  }));

  await saveShowcaseSetting(state.tenantId, SHOWCASE_REVIEWS_KEY, reviews as any);

  const newUnapproved = reviews.filter(
    (review) => !review.approved && review.id && !old.has(review.id),
  );
  await Promise.all(
    newUnapproved.map((review) =>
      createAdminInboxNotification({
        type: "google_review_approval",
        title: "Yeni Google yorumu onay bekliyor",
        body: `${review.authorName || "Google Nutzer"} · ${Math.round(review.rating || 0)} yıldız`,
        url: "/admin/showcase#google-review-moderation",
        sourceType: "google_review",
        sourceId: review.id,
      }),
    ),
  );

  return json({ ok: true, reviews, newPendingCount: newUnapproved.length });
}
