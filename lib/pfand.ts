import { readSettings } from "@/lib/settings";

export type PfandType = "none" | "einweg" | "mehrweg" | "custom";

export type PfandConfig = {
  enabled: boolean;
  einwegAmount: number;
  mehrwegAmount: number;
  showInfo: boolean;
};

export type PfandLine = {
  cartItemId: string;
  name: string;
  qty: number;
  unitAmount: number;
  amount: number;
  type: PfandType;
};

const money = (value: unknown) => {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? Math.max(0, +number.toFixed(2)) : 0;
};

export function readPfandConfig(settingsInput?: any): PfandConfig {
  const settings = settingsInput ?? readSettings();
  const raw = settings?.pfand || settings?.deposit || {};

  return {
    enabled: raw?.enabled !== false,
    einwegAmount: money(raw?.einwegAmount ?? raw?.singleUseAmount ?? 0.25),
    mehrwegAmount: money(raw?.mehrwegAmount ?? raw?.reusableAmount ?? 0.15),
    showInfo: raw?.showInfo !== false,
  };
}


export function resolvePfandUnit(
  cartItemOrProduct: any,
  settingsInput?: any,
): { type: PfandType; amount: number } {
  const config = readPfandConfig(settingsInput);
  if (!config.enabled) return { type: "none", amount: 0 };

  const product = cartItemOrProduct?.item || cartItemOrProduct || {};

  const explicitType = String(
    product?.pfandType ??
      product?.depositType ??
      cartItemOrProduct?.pfandType ??
      cartItemOrProduct?.depositType ??
      "none",
  )
    .toLowerCase()
    .trim();

  const explicitAmount = money(
    product?.pfandAmount ??
      product?.depositAmount ??
      cartItemOrProduct?.pfandAmount ??
      cartItemOrProduct?.depositAmount,
  );

  if (
    product?.pfandEnabled === false ||
    product?.depositEnabled === false ||
    explicitType === "none" ||
    explicitType === "kein" ||
    explicitAmount <= 0
  ) {
    return { type: "none", amount: 0 };
  }

  return {
    type:
      explicitType === "mehrweg"
        ? "mehrweg"
        : explicitType === "einweg"
          ? "einweg"
          : "custom",
    amount: explicitAmount,
  };
}

export function computePfand(items: any[], settingsInput?: any) {
  const lines: PfandLine[] = [];

  for (const cartItem of items || []) {
    const qty = Math.max(0, Number(cartItem?.qty ?? 1) || 0);
    if (!qty) continue;

    const resolved = resolvePfandUnit(cartItem, settingsInput);
    if (resolved.amount <= 0) continue;

    lines.push({
      cartItemId: String(cartItem?.id || cartItem?.item?.sku || ""),
      name: String(cartItem?.item?.name || cartItem?.name || "Getränk"),
      qty,
      unitAmount: resolved.amount,
      amount: +(resolved.amount * qty).toFixed(2),
      type: resolved.type,
    });
  }

  return {
    enabled: readPfandConfig(settingsInput).enabled,
    amount: +lines.reduce((sum, line) => sum + line.amount, 0).toFixed(2),
    units: lines.reduce((sum, line) => sum + line.qty, 0),
    lines,
  };
}

export function attachPfandToOrderItems(items: any[], settingsInput?: any) {
  return (items || []).map((item) => {
    const resolved = resolvePfandUnit(item, settingsInput);
    return {
      ...item,
      pfandType: resolved.type,
      pfandAmount: resolved.amount,
      depositType: resolved.type,
      depositAmount: resolved.amount,
    };
  });
}
