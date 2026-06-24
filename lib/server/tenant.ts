// lib/server/tenant.ts
import { prisma } from "./prisma";

const DEFAULT_TENANT_SLUG = process.env.TENANT_SLUG || "burger-brothers";
const DEFAULT_TENANT_NAME = process.env.TENANT_NAME || "Burger Brothers Berlin";

export async function ensureTenant() {
  let t = await prisma.tenant.findUnique({ where: { slug: DEFAULT_TENANT_SLUG } });
  if (!t) {
    t = await prisma.tenant.create({
      data: { slug: DEFAULT_TENANT_SLUG, name: DEFAULT_TENANT_NAME },
    });
  }
  return t;
}
