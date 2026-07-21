import { prisma } from "@/lib/db";

const STALE_AFTER_MS = 45_000;

export async function claimPaymentMutation(params: {
  tenantId: string;
  paymentSessionId: string;
}) {
  const where = {
    id: params.paymentSessionId,
    tenantId: params.tenantId,
  };

  let claimed = await prisma.order.updateMany({
    where: {
      ...where,
      status: { in: ["payment_pending", "payment_failed"] },
    },
    data: { status: "payment_starting" },
  });

  if (claimed.count === 0) {
    claimed = await prisma.order.updateMany({
      where: {
        ...where,
        status: "payment_starting",
        updatedAt: { lte: new Date(Date.now() - STALE_AFTER_MS) },
      },
      data: { status: "payment_starting" },
    });
  }

  if (claimed.count !== 1) {
    const current = await prisma.order.findFirst({
      where,
      select: { status: true },
    });
    if (current?.status === "payment_starting") {
      throw new Error("PAYMENT_MUTATION_IN_PROGRESS");
    }
    throw new Error("PAYMENT_SESSION_NOT_MUTABLE");
  }
}

export async function releasePaymentMutation(params: {
  tenantId: string;
  paymentSessionId: string;
}) {
  await prisma.order
    .updateMany({
      where: {
        id: params.paymentSessionId,
        tenantId: params.tenantId,
        status: "payment_starting",
      },
      data: { status: "payment_pending" },
    })
    .catch(() => null);
}

export async function withPaymentMutationClaim<T>(params: {
  tenantId: string;
  paymentSessionId: string;
  run: () => Promise<T>;
}) {
  await claimPaymentMutation(params);
  try {
    return await params.run();
  } finally {
    await releasePaymentMutation(params);
  }
}
