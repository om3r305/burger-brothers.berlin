import { NextResponse } from "next/server";
import {
  newSavedAddress,
  readTrustedCustomer,
  replaceSavedAddresses,
  sanitizeAddress,
} from "@/lib/server/customer-identity";
import { hasTrustedMutationOrigin } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function requireTrusted(req: Request) {
  if (!hasTrustedMutationOrigin(req)) {
    return { session: null, response: json({ ok: false, error: "origin_not_allowed" }, 403) };
  }
  const session = await readTrustedCustomer(req);
  if (!session) {
    return { session: null, response: json({ ok: false, error: "trusted_customer_required" }, 401) };
  }
  return { session, response: null };
}

export async function POST(req: Request) {
  const auth = await requireTrusted(req);
  if (!auth.session) return auth.response!;
  const body: any = await req.json().catch(() => ({}));
  const current = auth.session.identity.savedAddresses;
  const address = newSavedAddress(body, current.length);
  if (!address) return json({ ok: false, error: "invalid_address" }, 400);

  let next = current;
  if (address.isDefault) next = current.map((item) => ({ ...item, isDefault: false }));
  next = [...next, address].slice(0, 10);
  const identity = await replaceSavedAddresses(auth.session.customer.id, auth.session.customer.stats, next);
  return json({ ok: true, addresses: identity.savedAddresses });
}

export async function PATCH(req: Request) {
  const auth = await requireTrusted(req);
  if (!auth.session) return auth.response!;
  const body: any = await req.json().catch(() => ({}));
  const id = String(body?.id || "");
  const current = auth.session.identity.savedAddresses;
  const found = current.find((item) => item.id === id);
  if (!found) return json({ ok: false, error: "address_not_found" }, 404);
  const clean = sanitizeAddress({ ...found, ...body });
  if (!clean) return json({ ok: false, error: "invalid_address" }, 400);
  const now = new Date().toISOString();
  let next = current.map((item) =>
    item.id === id ? { ...item, ...clean, updatedAt: now } : item,
  );
  if (clean.isDefault) {
    next = next.map((item) => ({ ...item, isDefault: item.id === id }));
  }
  const identity = await replaceSavedAddresses(auth.session.customer.id, auth.session.customer.stats, next);
  return json({ ok: true, addresses: identity.savedAddresses });
}

export async function DELETE(req: Request) {
  const auth = await requireTrusted(req);
  if (!auth.session) return auth.response!;
  const body: any = await req.json().catch(() => ({}));
  const id = String(body?.id || "");
  const current = auth.session.identity.savedAddresses;
  const removed = current.find((item) => item.id === id);
  if (!removed) return json({ ok: false, error: "address_not_found" }, 404);
  let next = current.filter((item) => item.id !== id);
  if (removed.isDefault && next.length) {
    next = next.map((item, index) => ({ ...item, isDefault: index === 0 }));
  }
  const identity = await replaceSavedAddresses(auth.session.customer.id, auth.session.customer.stats, next);
  return json({ ok: true, addresses: identity.savedAddresses });
}
