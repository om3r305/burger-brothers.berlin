"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  optimizedLocalImageUrl,
  restoreLocalImageFallback,
} from "@/lib/media/local-optimized-image";
import {
  SIGNATURE_LAYER_LABELS,
  SIGNATURE_LAYER_SINK,
  isLayerAnimation,
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

const CHEESE_KEYS = new Set<SignatureLayerKey>(["cheddar", "gouda", "mozzarella", "gorgonzola"]);

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

// Üstte geniş, aşağı doğru incelip ucunda damla toplanan eriyik peynir.
function CheeseDrip({ x, length }: { x: string; length: number }) {
  return (
    <svg
      className={styles.drip}
      style={{ "--x": x, "--len": length } as Vars}
      viewBox="0 0 20 60"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="bb-cheese-drip" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#e3940c" />
          <stop offset="0.4" stopColor="#ffc53a" />
          <stop offset="0.6" stopColor="#ffd35e" />
          <stop offset="1" stopColor="#ec9f14" />
        </linearGradient>
      </defs>
      <path
        d="M0 0H20C17 7 13.5 13 13.2 27C13 38 15.8 44 15.8 50.5A5.8 5.8 0 1 1 4.2 50.5C4.2 44 7 38 6.8 27C6.5 13 3 7 0 0Z"
        fill="url(#bb-cheese-drip)"
      />
      <ellipse cx="8" cy="50" rx="1.6" ry="3" fill="rgba(255,250,225,.75)" />
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
  const extra = animation === "explode" ? (count - 1) * 0.16 : animation === "lid" ? 0.6 : 0;
  const explodeScale = fit / (fit + extra);
  const totals = new Map<SignatureLayerKey, number>();
  layers.forEach((key) => totals.set(key, (totals.get(key) || 0) + 1));
  const seen = new Set<SignatureLayerKey>();
  // Eriyen damlalar yalnızca en üstteki peynirde görünür.
  const firstCheese = layers.findIndex((key) => CHEESE_KEYS.has(key));

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
            data-cheese={CHEESE_KEYS.has(key) ? "1" : undefined}
            style={{
              "--c": (index - middle).toFixed(2),
              "--fb": count - 1 - index,
              "--sink": index > 0 ? `${-SIGNATURE_LAYER_SINK[layers[index - 1]] * 100}%` : "0%",
              zIndex: count - index,
            } as Vars}
          >
            <img src={signatureLayerUrl(key)} alt="" draggable={false} />
            {index === firstCheese ? (
              <>
                <CheeseDrip x="17%" length={1} />
                <CheeseDrip x="53%" length={1.5} />
                <CheeseDrip x="80%" length={0.8} />
              </>
            ) : null}
            {label && (animation === "explode" || (animation === "lid" && !isLid)) ? (
              <span className={styles.label} data-side={index % 2 ? "left" : "right"}>
                {label}
              </span>
            ) : null}
          </div>
        );
      })}
      <span className={styles.impact} />
      {/* Final: "pat" diye oturduktan sonra burgerden sıcak buhar yükselir. */}
      <div className={styles.finaleSteam}>
        <Particles kind="steam" count={6} />
      </div>
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
          <LayerStack animation={animation} layers={layers} />
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
