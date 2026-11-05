// The existing dedicated App Review driver. Never infer demo access from a
// request parameter, display name, or a client-side flag.
export const DRIVER_REVIEW_ID = "z17crutd";
export function isDriverReviewSubject(subject: unknown): boolean {
  return subject === DRIVER_REVIEW_ID;
}

export function driverReviewRequestAllowed(req: Request): boolean {
  const path = new URL(req.url).pathname;
  const methods: Record<string, string[]> = {
    "/api/orders/list": ["GET"],
    "/api/orders/claim": ["POST"],
    "/api/orders/status": ["GET", "POST", "PUT", "PATCH"],
    "/api/orders/notification": ["POST"],
    "/api/native/driver/route": ["GET", "POST"],
    "/api/native/driver/push": ["POST", "DELETE"],
  };
  return Boolean(methods[path]?.includes(req.method)) ||
    (req.method === "POST" && /^\/api\/track\/driver_[a-zA-Z0-9_-]+$/.test(path));
}
