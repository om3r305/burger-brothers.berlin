"use client";

import type { CSSProperties, ReactNode } from "react";
import styles from "./RewardStage.module.css";

type Props = {
  mode: "tv" | "customer";
  kicker?: string;
  headline: string;
  reward: string;
  orderNumber?: string | number;
  photoUrl?: string | null;
  photoAlt?: string;
  message?: string;
  logoUrl?: string;
  children?: ReactNode;
};

const CONFETTI = Array.from({ length: 24 }, (_, index) => index);

function confettiStyle(index: number): CSSProperties {
  return {
    "--reward-x": `${(index * 41 + 7) % 101}%`,
    "--reward-delay": `${-((index * 0.31) % 3.2)}s`,
    "--reward-duration": `${2.7 + (index % 6) * 0.32}s`,
    "--reward-rotate": `${(index * 47) % 180}deg`,
    "--reward-drift": `${(index % 2 ? 1 : -1) * (12 + (index % 5) * 9)}px`,
  } as CSSProperties;
}

function PrizeIcon() {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true">
      <path d="M18 41h60v42H18z" />
      <path d="M12 29h72v18H12z" />
      <path d="M43 29h10v54H43z" className={styles.prizeRibbon} />
      <path
        d="M48 29C31 28 21 21 22 13c1-7 10-9 17-4 5 4 8 11 9 20Zm0 0c17-1 27-8 26-16-1-7-10-9-17-4-5 4-8 11-9 20Z"
        className={styles.prizeBow}
      />
    </svg>
  );
}

export default function RewardStage({
  mode,
  kicker = "BURGER BROTHERS GLÜCKSMOMENT",
  headline,
  reward,
  orderNumber,
  photoUrl,
  photoAlt = "Gewinnerfoto",
  message,
  logoUrl = "/logo-burger-brothers.webp",
  children,
}: Props) {
  return (
    <div className={`${styles.stage} ${mode === "tv" ? styles.tv : styles.customer}`}>
      <div className={styles.atmosphere} aria-hidden="true">
        <div className={styles.spotlight} />
        <div className={styles.rays} />
        <div className={styles.halo} />
        <div className={styles.confetti}>
          {CONFETTI.map((index) => (
            <i
              key={index}
              data-tone={index % 4}
              style={confettiStyle(index)}
            />
          ))}
        </div>
      </div>

      <main className={styles.content}>
        <div className={styles.kicker}>
          <span aria-hidden="true" />
          {kicker}
          <span aria-hidden="true" />
        </div>

        <div className={`${styles.presentation} ${photoUrl ? styles.withPhoto : ""}`}>
          {photoUrl ? (
            <div className={styles.photoFrame}>
              <img src={photoUrl} alt={photoAlt} />
              <div className={styles.photoSeal}>BB</div>
            </div>
          ) : null}

          <section className={styles.copy}>
            <div className={styles.logoRing}>
              <img src={logoUrl} alt="Burger Brothers" />
            </div>
            <h1>{headline}</h1>

            <div className={styles.prizeCard}>
              <div className={styles.prizeIcon}>
                <PrizeIcon />
              </div>
              <div>
                <span>DEIN GEWINN</span>
                <strong>{reward}</strong>
              </div>
            </div>

            {orderNumber ? (
              <div className={styles.orderNumber}>
                BESTELLNUMMER <strong>{orderNumber}</strong>
              </div>
            ) : null}

            {message ? <p>{message}</p> : null}
            {children}
          </section>
        </div>
      </main>
    </div>
  );
}
