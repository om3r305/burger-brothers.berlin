"use client";

/**
 * Tam ekran alev katmanı:
 * - Zemin parıltısı (.screen-flames)
 * - Organik alev dilleri (.flame-bars > .flame-bar)
 * - Üst karartma/vinyet (.flame-vignette)
 * - Duman (.screen-smoke)
 *
 * Hinweis: Sınıf stilleri app/globals.css içinde tanımlı olmalı.
 */
export default function ScreenFlames() {
  return (
    <>
      <div aria-hidden className="screen-flames">
        <div className="flame-bars">
          {Array.from({ length: 14 }).map((_, i) => {
            const left = 1 + i * 7;
            const delay = (i * 0.13) % 1.5;
            const extra = (i % 4) * 0.06;
            return (
              <span
                key={i}
                className="flame-bar"
                style={{
                  left: `${left}%`,
                  height: `calc(58% + ${extra * 100}%)`,
                  opacity: 0.86 + (i % 3) * 0.04,
                  animationDelay: `${delay}s, ${delay / 2}s`,
                }}
              />
            );
          })}
        </div>
        <div className="flame-vignette" />
      </div>

      {/* Yükseklerde dolaşan duman */}
      <div aria-hidden className="screen-smoke" />
    </>
  );
}
