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

// Sos renkleri gerçek soslara göre: [alt/gölge, gövde, ışık alan üst yüz].
const SAUCE_COLORS: Partial<Record<SignatureLayerKey, [string, string, string]>> = {
  "bb-sauce": ["#b85a30", "#e8915e", "#f7c49b"], // kremsi burger sosu
  "avocado-sauce": ["#4f7a24", "#86b848", "#bfe084"],
  "bbq-sauce": ["#320c05", "#6a1d0b", "#a53d19"], // koyu maun, parlak
  "hot-sauce": ["#850f05", "#cf240d", "#f05a38"], // sriracha kırmızısı
  mustard: ["#b88a00", "#ecbf0c", "#fde46e"], // limon sarısı hardal
  "vegan-mayo": ["#cfbd8c", "#eee4c4", "#fffaf0"],
};

// Burgerin kenarından hafifçe taşan, parlak bir sos tabakası; alt kenarda
// küçük doğal sarkmalar.
function SauceLayer({ sauce }: { sauce: SignatureLayerKey }) {
  const [edge, body, light] = SAUCE_COLORS[sauce] || SAUCE_COLORS["bb-sauce"]!;
  const id = `bb-sauce-${sauce}`;
  return (
    <svg className={styles.sauce} viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="0.35" stopColor={body} />
          <stop offset="0.8" stopColor={body} />
          <stop offset="1" stopColor={edge} />
        </linearGradient>
      </defs>
      <path
        d="M2 5C10 2 18 4 26 3S42 1.5 50 3 66 4.5 74 2.8 90 2 98 4.5C100 6 99.4 8 97 8.6C92 9 88 8.6 84 9.4C82.4 11.6 79.4 11.9 78.4 9.6C70 9 62 10 55.4 9.2C53.6 12.2 49.8 12.5 48.8 9.6C40 9.2 30 10 22.6 9.2C20.8 11.2 17.6 11.3 16.8 9.4C10 9 5 9.4 3 8.2C0.6 7.4 0.6 5.8 2 5Z"
        fill={`url(#${id})`}
      />
      <path
        d="M9 4.4C18 3 27 4.4 36 3.4S55 2.6 63 3.8"
        fill="none"
        stroke="rgba(255,255,255,.5)"
        strokeWidth="0.8"
        strokeLinecap="round"
      />
      <ellipse cx="72" cy="4.3" rx="3" ry="0.7" fill="rgba(255,255,255,.45)" />
      <ellipse cx="22" cy="6.4" rx="1.6" ry="0.5" fill="rgba(255,255,255,.3)" />
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
