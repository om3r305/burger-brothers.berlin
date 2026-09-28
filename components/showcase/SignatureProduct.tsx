"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  optimizedLocalImageUrl,
  restoreLocalImageFallback,
} from "@/lib/media/local-optimized-image";
import {
  SIGNATURE_LAYER_LABELS,
  isLayerAnimation,
  isSignatureSauce,
  signatureLayerOverlap,
  signatureLayerUrl,
  signatureStackHeightFactor,
  type SignatureAnimation,
  type SignatureLayerKey,
} from "@/lib/showcase/signature";
import styles from "./SignatureProduct.module.css";

type Props = {
  animation: SignatureAnimation;
  name: string;
  imageUrl?: string;
  layers: SignatureLayerKey[];
  seconds: number;
  eyebrow?: string;
  ingredients: string[];
  price?: ReactNode;
  badge?: string;
  counter?: string;
};

type Vars = CSSProperties & Record<`--${string}`, string | number>;

// Deterministik "rastgele": her yüklemede aynı parçacık düzeni.
function seeded(index: number, salt: number) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function Particles({ kind, count }: { kind: "ember" | "steam" | "crumb"; count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <span
          key={`${kind}-${index}`}
          className={styles[kind]}
          style={{
            "--x": `${Math.round(seeded(index, kind.length) * 100)}%`,
            "--drift": `${Math.round((seeded(index, 7) - 0.5) * 14)}cqw`,
            "--size": seeded(index, 3).toFixed(3),
            "--delay": `${(seeded(index, 5) * 4).toFixed(2)}s`,
            "--angle": `${Math.round(seeded(index, 9) * 360)}deg`,
          } as Vars}
        />
      ))}
    </>
  );
}

// Sos renkleri: [koyu kenar, orta, açık ton]. Burger Studio sos şeritleriyle
// aynı dil; üstte ince bir parlaklık çizgisi.
const SAUCE_COLORS: Partial<Record<SignatureLayerKey, [string, string, string]>> = {
  "bb-sauce": ["#c9803a", "#eeaa5c", "#f8cf8c"],
  "avocado-sauce": ["#5f8a2b", "#9dc55a", "#c9e48f"],
  "bbq-sauce": ["#3f140c", "#7b2d1d", "#a8472e"],
  "hot-sauce": ["#8f150a", "#d3361a", "#f06a3a"],
  mustard: ["#b88600", "#e8b914", "#f7d95a"],
  "vegan-mayo": ["#d8c792", "#efe4c2", "#fbf6e6"],
};

function SauceLayer({ sauce }: { sauce: SignatureLayerKey }) {
  const [edge, mid, light] = SAUCE_COLORS[sauce] || SAUCE_COLORS["bb-sauce"]!;
  const id = `bb-sauce-${sauce}`;
  return (
    <svg className={styles.sauce} viewBox="0 0 100 9" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="0.45" stopColor={mid} />
          <stop offset="1" stopColor={edge} />
        </linearGradient>
      </defs>
      <path
        d="M1 3.2C8 1.2 13 4.6 20 2.6S31 1 38 3.1 50 4.4 57 2.4 69 1.3 76 3.2 88 4.2 99 2.6L98.4 5.6C92 7.9 86 5.2 79 7.2S66 8.6 59 6.4 46 5.1 39 7.3 26 8.5 19 6.3 7 5.2 1.6 6.9Z"
        fill={`url(#${id})`}
      />
      <path
        d="M14 3.6C24 2.2 31 3.9 40 3.1S60 2.3 70 3.3"
        fill="none"
        stroke="rgba(255,255,255,.55)"
        strokeWidth="0.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LayerStack({ animation, layers }: { animation: SignatureAnimation; layers: SignatureLayerKey[] }) {
  const count = layers.length;
  const middle = (count - 1) / 2;
  const heightFactor = signatureStackHeightFactor(layers);
  // Birleşik burger alanı doldurur; ayrışırken/kapak kalkarken tüm yığın
  // ekrana sığacak kadar küçülür (--xs), birleşince tam boyuna döner.
  const fit = heightFactor + 0.06;
  const extra = animation === "explode" || animation === "open" ? (count - 1) * 0.16 : animation === "lid" ? 0.6 : 0;
  const explodeScale = fit / (fit + extra);
  const totals = new Map<SignatureLayerKey, number>();
  layers.forEach((key) => totals.set(key, (totals.get(key) || 0) + 1));
  const seen = new Set<SignatureLayerKey>();

  return (
    <div
      className={styles.stack}
      style={{ "--fit": fit.toFixed(3), "--xs": explodeScale.toFixed(3) } as Vars}
    >
      {layers.map((key, index) => {
        // Çift köfte/cheddar tek etiket: "2× Cheddar".
        const first = !seen.has(key);
        seen.add(key);
        const amount = totals.get(key) || 1;
        const name = SIGNATURE_LAYER_LABELS[key];
        const label = first && name ? (amount > 1 ? `${amount}× ${name}` : name) : "";
        const isLid = index === 0;
        const isBottom = index === count - 1;
        return (
          <div
            key={`${key}-${index}`}
            className={styles.layer}
            data-lid={isLid ? "1" : undefined}
            data-bottom={isBottom ? "1" : undefined}
            style={{
              "--c": (index - middle).toFixed(2),
              "--fb": count - 1 - index,
              "--sink": `${-signatureLayerOverlap(layers, index) * 100}%`,
              zIndex: count - index,
            } as Vars}
          >
            {isSignatureSauce(key) ? (
              <SauceLayer sauce={key} />
            ) : (
              <img src={signatureLayerUrl(key)} alt="" draggable={false} />
            )}
            {label && (animation === "explode" || animation === "open" || (animation === "lid" && !isLid)) ? (
              <span
                className={styles.label}
                data-side={index % 2 ? "left" : "right"}
                style={{ "--i": index } as Vars}
              >
                {label}
              </span>
            ) : null}
          </div>
        );
      })}
      <span className={styles.impact} />
      {animation === "lid" ? (
        <div className={styles.lidSteam}>
          <Particles kind="steam" count={4} />
        </div>
      ) : null}
      {animation === "drop" || animation === "explode" ? (
        <div className={styles.crumbs}>
          <Particles kind="crumb" count={12} />
        </div>
      ) : null}
    </div>
  );
}

function Photo({ animation, imageUrl, name }: { animation: SignatureAnimation; imageUrl?: string; name: string }) {
  const source = imageUrl ? optimizedLocalImageUrl(imageUrl) || imageUrl : "";
  return (
    <div className={styles.photoWrap}>
      {source ? (
        <img
          src={source}
          alt={name}
          className={styles.photo}
          onError={(event) => imageUrl && restoreLocalImageFallback(event.currentTarget, imageUrl)}
        />
      ) : (
        <div className={styles.photoMissing}>🍔</div>
      )}
      {animation === "spin" && source ? (
        <span
          className={styles.sweep}
          style={{ maskImage: `url("${source}")`, WebkitMaskImage: `url("${source}")` } as CSSProperties}
        />
      ) : null}
    </div>
  );
}

export default function SignatureProduct({
  animation,
  name,
  imageUrl,
  layers,
  seconds,
  eyebrow,
  ingredients,
  price,
  badge,
  counter,
}: Props) {
  const layered = isLayerAnimation(animation) && layers.length > 2;
  const revealSource = layered && imageUrl ? optimizedLocalImageUrl(imageUrl) || imageUrl : "";

  return (
    <div
      className={styles.root}
      data-anim={animation}
      style={{ "--dur": `${Math.max(6, seconds)}s` } as Vars}
    >
      <div className={styles.glow} />
      {animation === "sizzle" ? (
        <div className={styles.fx}>
          <Particles kind="steam" count={5} />
          <Particles kind="ember" count={16} />
        </div>
      ) : (
        <div className={styles.fx}>
          <Particles kind="ember" count={8} />
        </div>
      )}

      <div className={styles.visual}>
        {layered ? (
          <>
            <div className={styles.stackFade} data-reveal={revealSource ? "1" : undefined}>
              <LayerStack animation={animation} layers={layers} />
            </div>
            {/* Katmanlar oturunca ürünün gerçek fotoğrafına yumuşak geçiş. */}
            {revealSource ? (
              <div className={styles.reveal}>
                <img
                  src={revealSource}
                  alt={name}
                  onError={(event) => imageUrl && restoreLocalImageFallback(event.currentTarget, imageUrl)}
                />
              </div>
            ) : null}
          </>
        ) : (
          <Photo animation={animation} imageUrl={imageUrl} name={name} />
        )}
        {badge ? <div className={styles.badge}>{badge}</div> : null}
      </div>

      <div className={styles.copy}>
        {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
        <h2>{name}</h2>
        {ingredients.length ? (
          <p className={styles.ingredients}>{ingredients.slice(0, 4).join("  ·  ")}</p>
        ) : null}
        {price ? <div className={styles.price}>{price}</div> : null}
      </div>

      {counter ? <div className={styles.counter}>{counter}</div> : null}
    </div>
  );
}
