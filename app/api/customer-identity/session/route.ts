import { NextResponse } from "next/server";
import {
  customerIdentityConfigured,
  readTrustedCustomer,
} from "@/lib/server/customer-identity";
import { createCustomerOrderProof } from "@/lib/server/customer-order-proof";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const enabled = customerIdentityConfigured();
  if (!enabled) {
    return NextResponse.json(
      { ok: true, enabled: false, trusted: false, addresses: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const trusted = await readTrustedCustomer(req);
  return NextResponse.json(
    trusted
      ? {
          ok: true,
          enabled: true,
          trusted: true,
          customer: {
            name: trusted.customer.name,
            phone: trusted.customer.phone,
            phoneVerifiedAt: trusted.identity.phoneVerifiedAt || null,
          },
          orderProof: createCustomerOrderProof(String(trusted.customer.phone || "")),
          addresses: trusted.identity.savedAddresses,
        }
      : { ok: true, enabled: true, trusted: false, addresses: [] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
