"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";
import {
  buildShowcaseMenuPages,
  selectedProductsForScene,
} from "@/lib/showcase/runtime";
import type {
  ShowcaseCampaign,
  ShowcaseProduct,
  ShowcasePreviewAspect,
  ShowcaseScene,
  ShowcaseSnapshot,
} from "@/lib/showcase/types";
import { resolveWeatherMessage, SPECIAL_DAY_PRESETS } from "@/lib/showcase/presets";
import styles from "./ShowcaseStage.module.css";

type Props = {
  snapshot: ShowcaseSnapshot;
  scene: ShowcaseScene;
  sceneIndex: number;
  sceneCount: number;
  preview?: boolean;
  previewAspect?: ShowcasePreviewAspect;
  online?: boolean;
  onVideoEnded?: () => void;
  onVideoError?: () => void;
};

function money(value: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(Number(value || 0));
}

function visibleText(value?: string | null) {
  return String(value ?? "").trim();
}

function productFor(scene: ShowcaseScene, products: ShowcaseProduct[]) {
  const selected = selectedProductsForScene(scene, products);
  return selected[0] || null;
}

function campaignFor(scene: ShowcaseScene, campaigns: ShowcaseCampaign[]) {
  if (!scene.campaignId) return null;
  return campaigns.find((item) => item.id === scene.campaignId) || null;
}

function campaignHeadline(campaign: ShowcaseCampaign | null) {
  if (!campaign) return "";
  const payload = campaign.payload || {};
  const value = Number(payload?.value || 0);
  const kind = String(payload?.kind || "");
  if (kind === "percent" && value > 0) return `${value}% RABATT`;
  if (kind === "absolute" && value > 0) return `${money(value)} RABATT`;
  if (kind === "newPrice" && value > 0) return `NUR ${money(value)}`;
  return visibleText(campaign.badgeText || campaign.title);
}

function campaignText(campaign: ShowcaseCampaign | null) {
  const payload = campaign?.payload || {};
  return visibleText(
    payload?.customerNotice ||
      payload?.description ||
      payload?.text ||
      payload?.subtitle ||
      campaign?.title,
  );
}

function campaignModeLabel(product: ShowcaseProduct) {
  if (product.campaignMode === "delivery") return "NUR LIEFERUNG";
  if (product.campaignMode === "pickup") return "NUR ABHOLUNG";
  return "";
}

function ProductPrice({ product, large = false }: { product: ShowcaseProduct; large?: boolean }) {
  const discounted =
    typeof product.originalPrice === "number" &&
    product.originalPrice > product.displayPrice;

  return (
    <div className={large ? styles.productPriceLarge : styles.menuPrice}>
      {discounted ? (
        <span className={styles.originalPrice}>{money(product.originalPrice || product.price)}</span>
      ) : null}
      <strong>{money(product.displayPrice ?? product.price)}</strong>
    </div>
  );
}

function ingredientLines(value?: string) {
  const text = String(value || "").trim();
  if (!text) return [];
  const split = text
    .split(/\r?\n|•|·|\s[-–—]\s/g)
    .flatMap((part) => (part.includes(",") ? part.split(",") : [part]))
    .map((part) => part.trim().replace(/^[-–—•]+\s*/, ""))
    .filter(Boolean);
  return Array.from(new Set(split)).slice(0, 10);
}

function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className={styles.clock} suppressHydrationWarning>
      <strong>
        {now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
      </strong>
      <span>
        {now.toLocaleDateString("de-DE", {
          weekday: "short",
          day: "2-digit",
          month: "2-digit",
        })}
      </span>
    </div>
  );
}

function SharpQr({ value, label }: { value: string; label?: string }) {
  const visibleLabel = visibleText(label);

  return (
    <div className={styles.qrCard}>
      <div className={styles.qrCode}>
        <QRCode
          value={value || "https://www.burger-brothers.berlin"}
          size={256}
          level="H"
          bgColor="#ffffff"
          fgColor="#080808"
          style={{ width: "100%", height: "100%" }}
        />
      </div>
      {visibleLabel ? <div className={styles.qrLabel}>{visibleLabel}</div> : null}
    </div>
  );
}

function Logo({ url, name }: { url: string; name: string }) {
  return (
    <img
      src={url || "/logo-burger-brothers.png"}
      alt={name}
      className={styles.logo}
      onError={(event) => {
        event.currentTarget.src = "/logo-burger-brothers.png";
      }}
    />
  );
}

function themeParticleStyle(index: number): React.CSSProperties {
  const left = (index * 17 + 7) % 96;
  const delay = -((index * 1.37) % 12);
  const duration = 9 + (index % 6) * 1.7;
  const size = 14 + (index % 4) * 4;

  return {
    left: `${left}%`,
    animationDelay: `${delay}s`,
    animationDuration: `${duration}s`,
    fontSize: `${size}px`,
  };
}

function ThemeDecorations({ snapshot }: { snapshot: ShowcaseSnapshot }) {
  const branding = snapshot.branding;
  if (!branding.themeDecorationsEnabled) return null;

  const particles = Array.isArray(branding.themeParticles)
    ? branding.themeParticles.filter(Boolean)
    : [];

  return (
    <div
      className={[
        styles.themeDecorations,
        branding.themeMotionEnabled ? styles.themeMotion : styles.themeStill,
        branding.themeSnow ? styles.themeSnow : "",
      ].join(" ")}
      aria-hidden="true"
    >
      <div className={styles.themeGarland} />
      <div className={styles.themeAtmosphere} />
      <span className={`${styles.themeCorner} ${styles.themeCornerLeft}`}>
        {branding.themeCornerLeft}
      </span>
      <span className={`${styles.themeCorner} ${styles.themeCornerRight}`}>
        {branding.themeCornerRight}
      </span>
      {particles.length ? (
        <div className={styles.themeParticles}>
          {Array.from({ length: 18 }, (_, index) => (
            <span
              key={`${branding.themeId}-${index}`}
              className={styles.themeParticle}
              style={themeParticleStyle(index)}
            >
              {particles[index % particles.length]}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Background({ scene, snapshot }: { scene: ShowcaseScene; snapshot: ShowcaseSnapshot }) {
  const videoUrl =
    scene.type === "hero" && !scene.mediaUrl
      ? snapshot.branding.themeVideoUrl
      : scene.type === "hero"
        ? scene.mediaUrl
        : "";
  const isVideo = /\.(mp4|webm)(?:\?|$)/i.test(videoUrl || "");
  const isImage = Boolean(videoUrl) && !isVideo;

  const mediaClass = [
    scene.fit === "contain" ? styles.mediaContain : styles.mediaCover,
    scene.type === "hero" ? styles.landingMedia : "",
  ].join(" ");

  return (
    <>
      <div className={styles.gradientBase} />
      {isImage ? <img src={videoUrl} alt="" className={mediaClass} /> : null}
      {isVideo ? (
        <video
          key={videoUrl}
          src={videoUrl}
          muted
          autoPlay
          loop
          playsInline
          preload="auto"
          className={mediaClass}
        />
      ) : null}
      <div className={[styles.vignette, scene.type === "hero" ? styles.landingVignette : ""].join(" ")} />
      <div className={styles.noise} />
      <div className={styles.glowOne} />
      <div className={styles.glowTwo} />
    </>
  );
}

function HeroScene({ scene, snapshot }: { scene: ShowcaseScene; snapshot: ShowcaseSnapshot }) {
  const qrUrl = scene.qrUrl || snapshot.document.settings.qrUrl || snapshot.branding.siteUrl;
  const siteAddress = snapshot.branding.siteUrl.replace(/^https?:\/\//, "");
  const title = visibleText(scene.title);
  const subtitle = visibleText(scene.subtitle);
  const body = visibleText(scene.body);
  const qrLabel = visibleText(scene.qrLabel);

  return (
    <div className={styles.landingHero}>
      <div className={styles.landingBrandBlock}>
        {scene.badge ? <div className={styles.badge}>{scene.badge}</div> : null}
        {scene.showLogo !== false ? (
          <div className={styles.landingLogoWrap}>
            <Logo url={snapshot.branding.logoUrl} name={snapshot.branding.shopName} />
          </div>
        ) : null}
        <div className={styles.landingLocation}>
          <span aria-hidden="true">📍</span>
          {snapshot.branding.locationLabel || "13507 Berlin Tegel"}
        </div>
      </div>

      <div className={styles.landingOrderBlock}>
        <div className={styles.landingOrderCopy}>
          {title ? <h1>{title}</h1> : null}
          {subtitle ? <p>{subtitle}</p> : null}
          {body ? <div className={styles.bodyText}>{body}</div> : null}
          <div className={styles.siteAddress}>{siteAddress}</div>
        </div>
        {scene.showQr !== false ? (
          <SharpQr value={qrUrl} label={qrLabel} />
        ) : null}
      </div>
    </div>
  );
}

function VideoScene({
  scene,
  snapshot,
  product,
  onEnded,
  onError,
}: {
  scene: ShowcaseScene;
  snapshot: ShowcaseSnapshot;
  product: ShowcaseProduct | null;
  onEnded?: () => void;
  onError?: () => void;
}) {
  const title = visibleText(scene.title);
  const subtitle = visibleText(scene.subtitle);
  const body = visibleText(scene.body);
  const qrLabel = visibleText(scene.qrLabel);

  return (
    <div className={styles.videoScene}>
      {scene.mediaUrl ? (
        <video
          key={`${scene.id}:${scene.mediaUrl}`}
          src={scene.mediaUrl}
          poster={scene.posterUrl}
          muted={scene.muted !== false}
          autoPlay
          playsInline
          preload="auto"
          className={scene.fit === "contain" ? styles.videoContain : styles.videoCover}
          onEnded={onEnded}
          onError={onError}
        />
      ) : (
        <div className={styles.missingMedia}>VIDEO HINZUFÜGEN</div>
      )}
      <div className={styles.videoShade} />
      <div className={styles.videoTop}>
        <div>
          {scene.badge ? <div className={styles.badge}>{scene.badge}</div> : null}
          {title ? <h2>{title}</h2> : null}
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {scene.showLogo !== false ? (
          <Logo url={snapshot.branding.logoUrl} name={snapshot.branding.shopName} />
        ) : null}
      </div>
      <div className={styles.videoBottom}>
        <div className={styles.videoBottomText}>
          {body ? <span>{body}</span> : null}
          <strong>{snapshot.branding.siteUrl.replace(/^https?:\/\//, "")}</strong>
        </div>
        {scene.showPrice !== false && product ? (
          <div className={styles.pricePill}>{money(product.displayPrice ?? product.price)}</div>
        ) : null}
        {scene.showQr ? (
          <SharpQr
            value={scene.qrUrl || snapshot.document.settings.qrUrl}
            label={qrLabel}
          />
        ) : null}
      </div>
    </div>
  );
}

function ProductFlowScene({
  scene,
  snapshot,
}: {
  scene: ShowcaseScene;
  snapshot: ShowcaseSnapshot;
}) {
  const products = useMemo(
    () => selectedProductsForScene(scene, snapshot.products),
    [scene, snapshot.products],
  );
  const signature = products.map((product) => product.id).join("|");
  const [productIndex, setProductIndex] = useState(0);

  useEffect(() => {
    setProductIndex(0);
  }, [scene.id, signature]);

  useEffect(() => {
    if (products.length <= 1) return;
    const timer = window.setTimeout(
      () => setProductIndex((current) => (current + 1) % products.length),
      Math.max(6, Number(scene.productSeconds || 12)) * 1_000,
    );
    return () => window.clearTimeout(timer);
  }, [productIndex, products.length, scene.productSeconds, signature]);

  const product = products[productIndex] || null;
  if (!product) {
    return (
      <div className={styles.productEmpty}>
        <span>🍔</span>
        <h2>PRODUKTE AUSWÄHLEN</h2>
        <p>Diese Szene wird im Adminbereich mit Produkten gefüllt.</p>
      </div>
    );
  }

  const ingredients = ingredientLines(
    product.ingredientsText || product.description || scene.body,
  );
  const imageUrl = product.imageUrl || scene.mediaUrl;
  const modeLabel = campaignModeLabel(product);
  const productImageFit = scene.productImageFit === "cover" ? "cover" : "contain";
  const productImageScale =
    Math.max(35, Math.min(130, Number(scene.productImageScale || 82))) / 100;
  const productImageX = Math.max(-40, Math.min(40, Number(scene.productImageX || 0)));
  const productImageY = Math.max(-40, Math.min(40, Number(scene.productImageY || 0)));

  return (
    <div
      key={`${product.id}:${productIndex}`}
      className={styles.productSpotlight}
      style={
        {
          "--product-image-scale": productImageScale,
          "--product-image-x": `${productImageX}%`,
          "--product-image-y": `${productImageY}%`,
        } as React.CSSProperties
      }
    >
      <div className={styles.productSpotlightVisual}>
        <div className={styles.productHalo} />
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={product.name}
            className={
              productImageFit === "cover"
                ? styles.productSpotlightImageCover
                : styles.productSpotlightImage
            }
          />
        ) : (
          <div className={styles.productImageMissing}>🍔</div>
        )}
        {product.campaignBadge ? (
          <div className={styles.productCampaignBadge}>{product.campaignBadge}</div>
        ) : null}
      </div>

      <div className={styles.productSpotlightInfo}>
        {visibleText(scene.title) ? (
          <span className={styles.eyebrow}>{visibleText(scene.title)}</span>
        ) : null}
        <h2>{product.name}</h2>

        {ingredients.length ? (
          <div className={styles.productIngredientSummary}>
            {ingredients.slice(0, 6).map((ingredient) => (
              <span key={ingredient}>{ingredient}</span>
            ))}
          </div>
        ) : (
          visibleText(scene.subtitle ?? product.campaignTitle ?? product.description) ? (
            <p className={styles.productSpotlightSubtitle}>
              {visibleText(scene.subtitle ?? product.campaignTitle ?? product.description)}
            </p>
          ) : null
        )}

        <div className={styles.productSpotlightMeta}>
          {product.allergens?.length ? (
            <span>Allergene: {product.allergens.join(", ")}</span>
          ) : null}
          {modeLabel ? <strong>{modeLabel}</strong> : null}
        </div>

        {scene.showPrice !== false ? <ProductPrice product={product} large /> : null}
      </div>

      <div className={styles.productFlowCounter}>
        {productIndex + 1} / {products.length}
      </div>
    </div>
  );
}

function MenuScene({ scene, snapshot }: { scene: ShowcaseScene; snapshot: ShowcaseSnapshot }) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<"landscape" | "portrait">("landscape");

  useEffect(() => {
    const element = boardRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      setLayout(width / height < 1.15 ? "portrait" : "landscape");
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const requestedItemsPerPage = Math.max(4, Number(scene.menuItemsPerPage || 8));
  const adaptiveItemsPerPage = layout === "portrait"
    ? Math.min(6, requestedItemsPerPage)
    : requestedItemsPerPage;
  const pages = useMemo(
    () => buildShowcaseMenuPages(scene, snapshot.products, adaptiveItemsPerPage),
    [scene, snapshot.products, adaptiveItemsPerPage],
  );
  const signature = pages.map((page) => page.id).join("|");
  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => setPageIndex(0), [scene.id, signature]);

  useEffect(() => {
    if (pages.length <= 1) return;
    const timer = window.setTimeout(
      () => setPageIndex((current) => (current + 1) % pages.length),
      Math.max(6, Number(scene.menuPageSeconds || 12)) * 1_000,
    );
    return () => window.clearTimeout(timer);
  }, [pageIndex, pages.length, scene.menuPageSeconds, signature]);

  const page = pages[pageIndex] || null;
  const railGroups = Array.from(
    new Map<string, string>(
      pages.map((item) => [item.groupKey, item.groupLabel] as const),
    ).entries(),
  );
  if (!page) {
    return (
      <div ref={boardRef} className={styles.productEmpty}>
        <span>📋</span>
        <h2>MENÜGRUPPEN AUSWÄHLEN</h2>
        <p>Aktive Produktgruppen können im Adminbereich ausgewählt werden.</p>
      </div>
    );
  }

  const columnsClass = layout === "portrait"
    ? styles.menuColumnsOne
    : Number(scene.menuColumns) === 3
      ? styles.menuColumnsThree
      : styles.menuColumnsTwo;

  const menuImageSize = Math.max(36, Math.min(104, Number(scene.menuImageSize || 58)));

  return (
    <div
      ref={boardRef}
      className={`${styles.menuBoard} ${layout === "portrait" ? styles.menuBoardPortrait : styles.menuBoardLandscape}`}
      style={{ "--menu-thumb-size": `${menuImageSize}px` } as React.CSSProperties}
    >
      <header className={styles.menuBoardHeader}>
        <div>
          {visibleText(scene.title) ? (
            <span className={styles.eyebrow}>{visibleText(scene.title)}</span>
          ) : null}
          <h2>{page.groupLabel || page.categoryLabel}</h2>
          {visibleText(scene.subtitle) ? <p>{visibleText(scene.subtitle)}</p> : null}
        </div>
        <div className={styles.menuCategoryRail}>
          {railGroups.map(([groupKey, groupLabel]) => (
            <span key={groupKey} className={groupKey === page.groupKey ? styles.menuCategoryActive : ""}>
              {groupLabel}
            </span>
          ))}
        </div>
      </header>

      <div key={page.id} className={`${styles.menuItems} ${columnsClass}`}>
        {page.products.map((product) => (
          <article className={styles.menuItem} key={product.id}>
            {scene.menuShowImages !== false && product.imageUrl ? (
              <div className={styles.menuItemThumb}>
                <img src={product.imageUrl} alt="" />
              </div>
            ) : null}
            <div className={styles.menuItemMain}>
              <div className={styles.menuItemTitleRow}>
                <h3>{product.name}</h3>
                {product.campaignBadge ? <span>{product.campaignBadge}</span> : null}
              </div>
              {scene.menuShowDescriptions && product.description ? (
                <p>{product.description}</p>
              ) : null}
              <div className={styles.menuItemMeta}>
                {campaignModeLabel(product) ? (
                  <small>{campaignModeLabel(product)}</small>
                ) : null}
                {product.depositAmount ? (
                  <small>zzgl. {money(product.depositAmount)} Pfand</small>
                ) : null}
              </div>
            </div>
            {scene.showPrice !== false ? <ProductPrice product={product} /> : null}
          </article>
        ))}
      </div>

      <footer className={styles.menuBoardFooter}>
        <span>{page.categoryLabel} · {page.groupLabel}</span>
        <strong>{page.pageIndex + 1} / {page.pageCount}</strong>
        {scene.showQr ? (
          <SharpQr
            value={scene.qrUrl || snapshot.document.settings.qrUrl}
            label={visibleText(scene.qrLabel)}
          />
        ) : null}
      </footer>
    </div>
  );
}

function CampaignScene({
  scene,
  snapshot,
  campaign,
}: {
  scene: ShowcaseScene;
  snapshot: ShowcaseSnapshot;
  campaign: ShowcaseCampaign | null;
}) {
  const useAutomatic = scene.campaignAutoContent !== false && Boolean(campaign);
  const badge = visibleText(useAutomatic ? campaign?.badgeText : scene.badge) || visibleText(scene.badge);
  const subtitle = visibleText(useAutomatic ? campaign?.title : scene.subtitle) || visibleText(scene.subtitle);
  const title = visibleText(useAutomatic ? campaignHeadline(campaign) : scene.title) || visibleText(scene.title);
  const body = visibleText(useAutomatic ? campaignText(campaign) : scene.body) || visibleText(scene.body);
  const qrLabel = visibleText(scene.qrLabel);

  return (
    <div className={styles.campaignGrid}>
      <div className={styles.campaignCopy}>
        {badge ? <div className={styles.badge}>{badge}</div> : null}
        {subtitle ? <span className={styles.eyebrow}>{subtitle}</span> : null}
        {title ? <h2>{title}</h2> : null}
        {body ? <p>{body}</p> : null}
        <div className={styles.campaignSite}>{snapshot.branding.siteUrl.replace(/^https?:\/\//, "")}</div>
      </div>
      <div className={styles.campaignVisual}>
        {scene.mediaUrl ? (
          <img src={scene.mediaUrl} alt="" className={styles.campaignImage} />
        ) : (
          <Logo url={snapshot.branding.logoUrl} name={snapshot.branding.shopName} />
        )}
        {scene.showQr !== false ? (
          <SharpQr
            value={scene.qrUrl || snapshot.document.settings.qrUrl}
            label={qrLabel}
          />
        ) : null}
      </div>
    </div>
  );
}

function ImageScene({ scene, snapshot }: { scene: ShowcaseScene; snapshot: ShowcaseSnapshot }) {
  const title = visibleText(scene.title);
  const subtitle = visibleText(scene.subtitle);
  const qrLabel = visibleText(scene.qrLabel);

  return (
    <div className={styles.imageScene}>
      {scene.mediaUrl ? (
        <img
          src={scene.mediaUrl}
          alt={title || "Burger Brothers"}
          className={scene.fit === "contain" ? styles.imageContain : styles.imageCover}
        />
      ) : (
        <Logo url={snapshot.branding.logoUrl} name={snapshot.branding.shopName} />
      )}
      <div className={styles.imageShade} />
      <div className={styles.imageCopy}>
        {scene.badge ? <div className={styles.badge}>{scene.badge}</div> : null}
        {title ? <h2>{title}</h2> : null}
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {scene.showQr ? (
        <div className={styles.imageQr}>
          <SharpQr
            value={scene.qrUrl || snapshot.document.settings.qrUrl}
            label={qrLabel}
          />
        </div>
      ) : null}
    </div>
  );
}

function QrScene({ scene, snapshot }: { scene: ShowcaseScene; snapshot: ShowcaseSnapshot }) {
  const title = visibleText(scene.title);
  const subtitle = visibleText(scene.subtitle);
  const body = visibleText(scene.body);
  const qrLabel = visibleText(scene.qrLabel);

  return (
    <div className={styles.qrScene}>
      <div className={styles.qrSceneCopy}>
        {scene.showLogo !== false ? (
          <Logo url={snapshot.branding.logoUrl} name={snapshot.branding.shopName} />
        ) : null}
        {scene.badge ? <div className={styles.badge}>{scene.badge}</div> : null}
        {title ? <h2>{title}</h2> : null}
        {subtitle ? <p>{subtitle}</p> : null}
        {body ? <div className={styles.bodyText}>{body}</div> : null}
      </div>
      <SharpQr
        value={scene.qrUrl || snapshot.document.settings.qrUrl || snapshot.branding.siteUrl}
        label={qrLabel}
      />
    </div>
  );
}

function MessageScene({ scene, snapshot }: { scene: ShowcaseScene; snapshot: ShowcaseSnapshot }) {
  const title = visibleText(scene.title);
  const subtitle = visibleText(scene.subtitle);
  const body = visibleText(scene.body);
  const qrLabel = visibleText(scene.qrLabel);

  return (
    <div className={styles.messageScene}>
      {scene.showLogo !== false ? (
        <Logo url={snapshot.branding.logoUrl} name={snapshot.branding.shopName} />
      ) : null}
      {scene.badge ? <div className={styles.badge}>{scene.badge}</div> : null}
      <div className={styles.messageDivider} aria-hidden="true" />
      {title ? <h2>{title}</h2> : null}
      {subtitle ? <p className={styles.messageSubtitle}>{subtitle}</p> : null}
      {body ? <div className={styles.messageBody}>{body}</div> : null}
      {scene.showQr ? (
        <SharpQr
          value={scene.qrUrl || snapshot.document.settings.qrUrl}
          label={qrLabel}
        />
      ) : null}
    </div>
  );
}


function PremiumScene({ scene, snapshot, sceneIndex }: { scene: ShowcaseScene; snapshot: ShowcaseSnapshot; sceneIndex: number }) {
  const title = visibleText(scene.title);
  const subtitle = visibleText(scene.subtitle);
  const body = visibleText(scene.body);
  const isReviewQr = scene.type === "review-qr" || (scene.type === "qr" && scene.qrVariant === "google-review");
  const isCountdown = scene.type === "countdown" || (scene.type === "campaign" && scene.campaignVariant === "countdown");
  const isSpecialDay = scene.type === "special-day" || (scene.type === "message" && scene.messageVariant === "special-day");

  if (scene.type === "weather") {
    const weather = snapshot.weather;
    const automaticBody = resolveWeatherMessage(weather, new Date(), scene.weatherMessages);
    return (
      <div className={`${styles.premiumScene} ${styles.weatherScene}`}>
        <div className={styles.weatherEmoji}>{weather?.emoji || "🌤️"}</div>
        <div className={styles.premiumEyebrow}>{weather?.locationLabel || "BERLIN-TEGEL"}</div>
        <h1>{title || (weather && Number.isFinite(weather.temperature) ? `${Math.round(weather.temperature)}°C` : "WETTER")}</h1>
        <div className={styles.weatherLabel}>{subtitle || weather?.label || "Wird aktualisiert"}</div>
        <p>{weather ? (scene.weatherMode === "custom" ? body : automaticBody) : "Aktuelle Wetterdaten werden gerade geladen."}</p>
        {weather?.updatedAt ? (
          <small className={styles.dataTimestamp}>
            {weather.stale ? "Letzte verfügbare Daten" : "Aktualisiert"} {new Date(weather.updatedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
          </small>
        ) : null}
      </div>
    );
  }

  if (scene.type === "reviews") {
    const filtered = (snapshot.reviews || []).filter(
      (review) => review.approved !== false &&
        review.rating >= (scene.reviewMinRating || 4) &&
        (!scene.reviewOnlyWithPhoto || (review.photoUrls || []).length > 0),
    );
    const list = scene.reviewSort === "random"
      ? [...filtered].sort((a, b) => a.id.localeCompare(b.id))
      : [...filtered].sort((a, b) => Date.parse(b.updateTime || b.createTime || "") - Date.parse(a.updateTime || a.createTime || ""));
    const limited = list.slice(0, scene.reviewLimit || 8);
    const review = limited.length ? limited[sceneIndex % limited.length] : undefined;
    return (
      <div className={styles.reviewScene}>
        {review?.photoUrls?.[0] ? <img src={review.photoUrls[0]} alt="Kundenfoto" className={styles.reviewPhoto} /> : null}
        <div className={styles.reviewCard}>
          <div className={styles.reviewStars}>{"★".repeat(Math.round(review?.rating || 5))}</div>
          <blockquote>{review?.comment || body || "Vielen Dank für eure großartige Bewertung!"}</blockquote>
          <strong>{review?.authorName || "Google Bewertung"}</strong>
          <span>Google</span>
        </div>
      </div>
    );
  }

  if (isReviewQr) {
    return (
      <div className={styles.reviewQrScene}>
        <div className={styles.reviewQrCopy}>
          <div className={styles.premiumEyebrow}>{scene.badge || "GOOGLE BEWERTUNG"}</div>
          <h1>{title || "DEINE MEINUNG ZÄHLT ❤️"}</h1>
          <p>{body || "Teile dein Burger-Erlebnis. Dein Foto könnte schon bald hier erscheinen."}</p>
        </div>
        <SharpQr value={scene.qrUrl || snapshot.document.settings.qrUrl} label={scene.qrLabel || "Jetzt bewerten"} />
      </div>
    );
  }

  if (isCountdown) {
    const linkedCampaign = campaignFor(scene, snapshot.campaigns);
    const autoCampaign = scene.campaignAutoContent !== false && linkedCampaign;
    const countdownTitle = visibleText(autoCampaign ? campaignHeadline(linkedCampaign) : scene.title) || title;
    const countdownSubtitle = visibleText(autoCampaign ? linkedCampaign?.title : scene.subtitle) || subtitle;
    const countdownBadge = visibleText(autoCampaign ? linkedCampaign?.badgeText : scene.badge) || scene.badge;
    const target = Date.parse((autoCampaign ? linkedCampaign?.endsAt : undefined) || scene.countdownTargetAt || scene.endAt || "");
    const left = Number.isFinite(target) ? Math.max(0, target - Date.now()) : 0;
    const days = Math.floor(left / 86400000);
    const hours = Math.floor(left / 3600000) % 24;
    const minutes = Math.floor(left / 60000) % 60;
    const ended = Number.isFinite(target) && target <= Date.now();
    if (ended && scene.countdownEndBehavior === "ended") {
      return (
        <div className={`${styles.premiumScene} ${styles.countdownScene}`}>
          <div className={styles.premiumEyebrow}>{countdownBadge || "AKTION"}</div>
          <h1>AKTION BEENDET</h1>
          <p>Danke für eure großartige Unterstützung.</p>
        </div>
      );
    }
    return (
      <div className={`${styles.premiumScene} ${styles.countdownScene}`}>
        <div className={styles.premiumEyebrow}>{countdownBadge || "LIMITIERTE AKTION"}</div>
        <h1>{countdownTitle || "LIMITIERTE AKTION"}</h1>
        <div className={styles.countdown}>
          <b>{days}<small>TAGE</small></b>
          <b>{hours}<small>STUNDEN</small></b>
          <b>{minutes}<small>MINUTEN</small></b>
        </div>
        {countdownSubtitle ? <p>{countdownSubtitle}</p> : null}
      </div>
    );
  }

  if (scene.type === "bestseller") {
    const period = String(Math.max(1, Number(scene.bestsellerPeriodDays || 7)));
    const items = (snapshot.bestsellersByPeriod?.[period] || snapshot.bestsellers || []).slice(0, scene.bestsellerLimit || 5);
    return (
      <div className={styles.bestsellerScene}>
        <div className={styles.premiumEyebrow}>🔥 AM HÄUFIGSTEN BESTELLT · {period} TAGE</div>
        <h1>{title || "UNSERE BESTSELLER"}</h1>
        {items.length ? (
          <div className={styles.bestsellerGrid}>
            {items.map((item, index) => (
              <div key={`${item.name}-${index}`} className={styles.bestsellerCard}>
                {item.imageUrl ? <img src={item.imageUrl} alt={item.name} /> : null}
                <span>#{index + 1}</span>
                <strong>{item.name}</strong>
                {item.displayPrice != null ? <em>{money(item.displayPrice)}</em> : null}
              </div>
            ))}
          </div>
        ) : <p className={styles.premiumEmpty}>Die aktuellen Lieblingsburger werden gerade ermittelt.</p>}
      </div>
    );
  }

  if (isSpecialDay) {
    const preset = SPECIAL_DAY_PRESETS[(scene.specialPreset || "classic") as keyof typeof SPECIAL_DAY_PRESETS] || SPECIAL_DAY_PRESETS.classic;
    return (
      <div className={`${styles.premiumScene} ${styles.specialScene} ${styles[`special_${scene.specialTheme || preset.theme || "classic"}`] || ""}`}>
        {scene.specialLogoUrl
          ? <img src={scene.specialLogoUrl} alt="" className={styles.specialLogo} />
          : <div className={styles.specialEmoji}>{scene.specialEmoji || preset.emoji}</div>}
        {scene.badge ? <div className={styles.premiumEyebrow}>{scene.badge}</div> : null}
        {title ? <h1>{title}</h1> : null}
        {body ? <p>{body}</p> : null}
      </div>
    );
  }

  return null;
}

export default function ShowcaseStage({
  snapshot,
  scene,
  sceneIndex,
  sceneCount,
  preview = false,
  previewAspect = "landscape",
  online = true,
  onVideoEnded,
  onVideoError,
}: Props) {
  const product = useMemo(
    () => productFor(scene, snapshot.products),
    [scene, snapshot.products],
  );
  const campaign = useMemo(
    () => campaignFor(scene, snapshot.campaigns),
    [scene, snapshot.campaigns],
  );
  const accent = scene.accent || "#ff9d2e";
  const transitionClass = styles[`transition_${scene.transition}`] || styles.transition_fade;
  const themeClass = styles[`theme_${snapshot.branding.themeId}`] || styles.theme_classic;
  const previewAspectClass = preview
    ? previewAspect === "portrait"
      ? styles.previewPortrait
      : previewAspect === "ultrawide"
        ? styles.previewUltrawide
        : styles.previewLandscape
    : "";
  const backgroundClass =
    snapshot.document.settings.background === "black"
      ? styles.background_black
      : snapshot.document.settings.background === "dark"
        ? styles.background_dark
        : styles.background_theme;

  return (
    <section
      className={[
        styles.stage,
        preview ? styles.preview : styles.fullscreen,
        previewAspectClass,
        transitionClass,
        themeClass,
        backgroundClass,
      ].join(" ")}
      style={
        {
          "--showcase-accent": accent,
          "--showcase-theme": snapshot.branding.themeColor || "#0b0704",
        } as React.CSSProperties
      }
      aria-label={scene.name}
    >
      <Background scene={scene} snapshot={snapshot} />
      {scene.type === "product" || scene.type === "menu" ? null : (
        <ThemeDecorations snapshot={snapshot} />
      )}
      <div className={styles.sceneCanvas}>
        <div className={styles.content} key={`${scene.id}:${sceneIndex}`}>
          {scene.type === "hero" ? <HeroScene scene={scene} snapshot={snapshot} /> : null}
          {scene.type === "video" ? (
            <VideoScene
              scene={scene}
              snapshot={snapshot}
              product={product}
              onEnded={onVideoEnded}
              onError={onVideoError}
            />
          ) : null}
          {scene.type === "product" ? <ProductFlowScene scene={scene} snapshot={snapshot} /> : null}
          {scene.type === "menu" ? <MenuScene scene={scene} snapshot={snapshot} /> : null}
          {scene.type === "campaign" && scene.campaignVariant !== "countdown" ? (
            <CampaignScene scene={scene} snapshot={snapshot} campaign={campaign} />
          ) : null}
          {scene.type === "image" ? <ImageScene scene={scene} snapshot={snapshot} /> : null}
          {scene.type === "qr" && scene.qrVariant !== "google-review" ? <QrScene scene={scene} snapshot={snapshot} /> : null}
          {scene.type === "message" && scene.messageVariant !== "special-day" ? <MessageScene scene={scene} snapshot={snapshot} /> : null}
          {(scene.type === "weather" || scene.type === "reviews" || scene.type === "bestseller" || scene.type === "review-qr" || scene.type === "countdown" || scene.type === "special-day" || (scene.type === "qr" && scene.qrVariant === "google-review") || (scene.type === "campaign" && scene.campaignVariant === "countdown") || (scene.type === "message" && scene.messageVariant === "special-day")) ? <PremiumScene scene={scene} snapshot={snapshot} sceneIndex={sceneIndex} /> : null}
        </div>

        <div className={styles.topChrome}>
          {snapshot.document.settings.showConnectionState ? (
            <div className={online ? styles.online : styles.offline}>
              <span /> {online ? "ONLINE" : "OFFLINE-MODUS"}
            </div>
          ) : <span />}
          {snapshot.document.settings.showClock ? <Clock /> : null}
        </div>

        {snapshot.document.settings.ticker ? (
          <div className={styles.ticker}>
            <div>{snapshot.document.settings.ticker}</div>
          </div>
        ) : null}

        {snapshot.document.settings.showProgress && sceneCount > 1 ? (
          <div className={styles.progress}>
            {Array.from({ length: sceneCount }).map((_, index) => (
              <span key={index} className={index === sceneIndex ? styles.progressActive : ""} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
