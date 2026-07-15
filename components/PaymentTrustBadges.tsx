"use client";

const methods = [
  { key: "visa", label: "Visa", src: "/payment-methods/visa.svg" },
  { key: "mastercard", label: "Mastercard", src: "/payment-methods/mastercard.svg" },
  { key: "paypal", label: "PayPal", src: "/payment-methods/paypal.svg" },
  { key: "apple-pay", label: "Apple Pay", src: "/payment-methods/apple-pay.svg" },
  { key: "google-pay", label: "Google Pay", src: "/payment-methods/google-pay.svg" },
  { key: "klarna", label: "Klarna", src: "/payment-methods/klarna.svg" },
];

export default function PaymentTrustBadges({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-white/10 bg-black/20 ${
        compact ? "p-2.5" : "p-3"
      } ${className}`}
      aria-label="Unterstützte sichere Zahlungsarten"
    >
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
        <span aria-hidden="true">🔒</span>
        Sichere Zahlung
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {methods.map((method) => (
          <span
            key={method.key}
            className="inline-flex h-8 min-w-[54px] items-center justify-center rounded-md border border-white/15 bg-white px-2 py-1 shadow-sm"
            title={method.label}
          >
            <img
              src={method.src}
              alt={method.label}
              loading="lazy"
              className="max-h-5 max-w-[72px] object-contain"
            />
          </span>
        ))}
      </div>

      {!compact && (
        <div className="mt-2 text-[11px] leading-4 text-stone-500">
          Verschlüsselte Zahlungsabwicklung über Stripe. Im Zahlungsfenster
          erscheinen nur die in Stripe tatsächlich aktivierten Methoden.
        </div>
      )}
    </div>
  );
}
