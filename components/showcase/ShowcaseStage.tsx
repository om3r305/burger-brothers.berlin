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
          muted
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
  const badge = visibleText(scene.badge ?? campaign?.badgeText);
  const subtitle = visibleText(scene.subtitle ?? campaign?.title);
  const title = visibleText(scene.title ?? campaignHeadline(campaign));
  const body = visibleText(scene.body ?? campaignText(campaign));
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
          {scene.type === "campaign" ? (
            <CampaignScene scene={scene} snapshot={snapshot} campaign={campaign} />
          ) : null}
          {scene.type === "image" ? <ImageScene scene={scene} snapshot={snapshot} /> : null}
          {scene.type === "qr" ? <QrScene scene={scene} snapshot={snapshot} /> : null}
          {scene.type === "message" ? <MessageScene scene={scene} snapshot={snapshot} /> : null}
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
