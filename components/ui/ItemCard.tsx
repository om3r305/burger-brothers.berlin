"use client";

import * as React from "react";

type Props = {
  title: string;
  price: number;              // kampanyalı veya normal gösterilecek fiyat
  oldPrice?: number | null;   // varsa üstü çizili eski fiyat
  imageUrl?: string | null;
  description?: string | null;
  badgeText?: string | null;  // örn. "Heute nicht verfügbar" / "%20"
  disabled?: boolean;         // stok yok / bugün kapalı
  ctaLabel?: string;          // "Ekle", "Anpassen & In den Warenkorb" vs.
  onClick?: () => void;
  className?: string;         // ekstra sınıf (opsiyonel)
};

export default function ItemCard({
  title,
  price,
  oldPrice = null,
  imageUrl,
  description,
  badgeText,
  disabled = false,
  ctaLabel = "Ekle",
  onClick,
  className = "",
}: Props) {
  const hasImage = !!imageUrl;

  return (
    <article className={`card product-card flex flex-col min-h-[380px] ${className}`}>
      {/* MEDIA */}
      <div className="product-card__body">
        <div style={{ aspectRatio: "4/3", position: "relative", marginBottom: ".6rem" }}>
          {hasImage ? (
            <img
              src={imageUrl as string}
              alt={title}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                borderRadius: "12px",
              }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                borderRadius: "12px",
                background: "rgba(120,113,108,.15)",
                border: "1px dashed rgba(120,113,108,.35)",
                display: "grid",
                placeItems: "center",
                color: "#bbb",
                fontSize: ".9rem",
              }}
            >
              Kein Bild
            </div>
          )}

          {badgeText ? (
            <div
              style={{
                position: "absolute",
                top: 10,
                left: 10,
                padding: "4px 10px",
                borderRadius: 9999,
                background: "var(--panel-strong)",
                border: "1px solid var(--border)",
                fontSize: "12px",
              }}
              className="badge"
            >
              {badgeText}
            </div>
          ) : null}
        </div>

        {/* TITLE + PRICE */}
        <div className="flex items-baseline justify-between gap-2">
          <div className="font-medium truncate">{title}</div>
          <div className="shrink-0">
            {oldPrice && oldPrice > price ? (
              <div className="text-right">
                <div className="text-xs opacity-80" style={{ textDecoration: "line-through" }}>
                  {formatEur(oldPrice)}
                </div>
                <div className="font-semibold">{formatEur(price)}</div>
              </div>
            ) : (
              <div className="font-semibold">{formatEur(price)}</div>
            )}
          </div>
        </div>

        {/* DESC */}
        {description ? (
          <div className="text-sm opacity-80 mt-1 line-clamp-2">{description}</div>
        ) : null}
      </div>

      {/* CTA */}
      <div className="product-card__cta mt-auto">
        <button
          className="card-cta card-cta--lg"
          onClick={onClick}
          disabled={disabled}
          title={disabled ? "Nicht verfügbar" : ctaLabel}
          style={{ width: "100%" }}
        >
          {disabled ? "Nicht verfügbar" : ctaLabel}
        </button>
      </div>
    </article>
  );
}

/* utils */
function formatEur(n: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
}
