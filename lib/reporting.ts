export const REPORT_TIMEZONE = "Europe/Berlin";
export type ReportPeriod = "day" | "week" | "month" | "year";

export function berlinDateKey(value: Date | number = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const part = (name: string) => parts.find((p) => p.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function berlinMidnight(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("INVALID_REPORT_DATE");
  const target = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== date) {
    throw new Error("INVALID_REPORT_DATE");
  }
  let result = target;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: REPORT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(result);
    const p = (name: string) => Number(parts.find((item) => item.type === name)?.value);
    result -= Date.UTC(p("year"), p("month") - 1, p("day"), p("hour"), p("minute"), p("second")) - target;
  }
  return new Date(result);
}

export function reportRange(period: string, anchor: string) {
  berlinMidnight(anchor);
  if (!["day", "week", "month", "year"].includes(period)) throw new Error("INVALID_REPORT_PERIOD");
  const start = new Date(`${anchor}T00:00:00Z`);
  const end = new Date(start);
  if (period === "week") start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  if (period === "month") start.setUTCDate(1);
  if (period === "year") start.setUTCMonth(0, 1);
  end.setTime(start.getTime());
  if (period === "year") end.setUTCFullYear(end.getUTCFullYear() + 1);
  else if (period === "month") end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCDate(end.getUTCDate() + (period === "week" ? 7 : 1));
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  return { period: period as ReportPeriod, anchor, startDate, endDate,
    from: berlinMidnight(startDate), to: berlinMidnight(endDate) };
}

export function isCustomerAnalyticsPath(path: string) {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  return !["admin", "tv", "driver", "dashboard", "visit", "showcase", "print", "kasa", "api", "_next"]
    .some((prefix) => path === `/${prefix}` || path.startsWith(`/${prefix}/`));
}

export type PaymentReportRow = {
  id: string; created: number; type: string; amount: number; fee: number; net: number;
  status: string; sourceId: string; method: string;
};

export function summarizePaymentRows(rows: PaymentReportRow[]) {
  const result = { payments: 0, gross: 0, refunds: 0, fees: 0, other: 0, net: 0, payouts: 0 };
  for (const row of rows) {
    if (["payout", "payout_cancel", "payout_failure"].includes(row.type)) {
      result.payouts -= row.net;
      continue;
    }
    if (["charge", "payment"].includes(row.type)) {
      result.payments++;
      result.gross += row.amount;
    } else if (["refund", "payment_refund", "payment_failure_refund", "refund_failure"].includes(row.type)) {
      result.refunds -= row.amount;
    } else if (["stripe_fee", "stripe_fx_fee", "tax_fee"].includes(row.type)) {
      result.fees -= row.amount;
    } else result.other += row.amount;
    result.fees += row.fee;
    result.net += row.net;
  }
  return result;
}
