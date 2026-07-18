import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Legacy QR/order links remain compatible, but authentication and order
 * operations are handled only by the signed driver session at /driver.
 */
export default async function LegacyDriverOrderPage({
  params,
}: {
  params: Promise<{ orderId?: string; id?: string }>;
}) {
  const resolved = await params;
  const orderId = String(resolved?.orderId || resolved?.id || "").trim();
  const query = orderId ? `?legacyOrder=${encodeURIComponent(orderId)}` : "";
  redirect(`/driver${query}`);
}
