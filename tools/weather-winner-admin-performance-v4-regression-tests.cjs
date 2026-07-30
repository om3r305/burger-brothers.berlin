const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const must = (condition, message) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`OK: ${message}`);
};

const weatherTypes = read("lib/showcase/types.ts");
const weatherServer = read("lib/showcase/server.ts");
const weatherPresets = read("lib/showcase/presets.ts");
const weatherExperience = read("components/showcase/WeatherExperience.tsx");
const weatherStyles = read("components/showcase/WeatherExperience.module.css");
const showcaseStage = read("components/showcase/ShowcaseStage.tsx");

for (const condition of [
  "clear",
  "partly-cloudy",
  "cloudy",
  "fog",
  "drizzle",
  "rain",
  "storm",
  "snow",
]) {
  must(weatherTypes.includes(`"${condition}"`), `hava profili mevcut: ${condition}`);
  must(
    weatherStyles.includes(`[data-condition="${condition}"]`),
    `hava profili görsel olarak ayrıştırılıyor: ${condition}`,
  );
}
for (const field of [
  "relative_humidity_2m",
  "precipitation",
  "rain",
  "showers",
  "snowfall",
  "weather_code",
  "wind_speed_10m",
  "wind_gusts_10m",
  "is_day",
]) {
  must(weatherServer.includes(field), `Open-Meteo canlı alanı okunuyor: ${field}`);
}
must(
  weatherExperience.includes("Array.from({ length: 18 }"),
  "hava parçacıkları TV performansı için sınırlı",
);
must(
  weatherExperience.includes("data-condition={condition}") &&
    weatherExperience.includes("weather?.relativeHumidity") &&
    weatherExperience.includes("weather?.precipitation"),
  "hava sahnesi duruma göre değişiyor ve canlı ölçümleri gösteriyor",
);
must(
  weatherStyles.includes("contain: strict") &&
    weatherStyles.includes("@media (prefers-reduced-motion: reduce)") &&
    weatherStyles.includes("@container"),
  "hava sahnesinde izolasyon, erişilebilirlik ve ekran oranı korumaları var",
);
must(
  weatherPresets.includes('"storm"') &&
    weatherPresets.includes('"fog"') &&
    weatherPresets.includes('"windy"') &&
    weatherPresets.includes("WEATHER_MESSAGE_VARIANTS") &&
    weatherPresets.includes("dateSeed"),
  "doğal hava metinleri koşula göre kontrollü çeşitleniyor",
);
must(
  showcaseStage.includes("<WeatherExperience") &&
    showcaseStage.includes("60_000 - (Date.now() % 60_000)") &&
    showcaseStage.includes("window.setInterval(update, 60_000)"),
  "Showcase yeni hava motorunu ve dakika hizalı saati kullanıyor",
);

const rewardStage = read("components/rewards/RewardStage.tsx");
const rewardStyles = read("components/rewards/RewardStage.module.css");
const tvWinner = read("components/showcase/WinnerCelebrationOverlay.tsx");
const customerWinner = read("components/rewards/RewardCelebration.tsx");
const audioGenerator = read("tools/generate-reward-stinger.cjs");

must(
  rewardStage.includes("Array.from({ length: 24 }") &&
    rewardStage.includes('mode: "tv" | "customer"'),
  "kazanan sahnesi iki yüzey için ortak ve parçacıkları sınırlı",
);
must(
  tvWinner.includes("<RewardStage") && customerWinner.includes("<RewardStage"),
  "TV ve müşteri ekranı aynı profesyonel kutlama sistemini kullanıyor",
);
must(
  !tvWinner.includes("animate-ping") &&
    !tvWinner.includes("🎆") &&
    !tvWinner.includes("🍔"),
  "eski yapay emoji/ping kutlaması TV katmanından kaldırıldı",
);
must(
  rewardStyles.includes("contain: paint") &&
    rewardStyles.includes("@media (prefers-reduced-motion: reduce)"),
  "kutlama animasyonu izole ve hareket tercihine duyarlı",
);
must(
  audioGenerator.includes("sampleRate = 44_100") &&
    audioGenerator.includes("writeInt16LE"),
  "kısa profesyonel kutlama sesi deterministik PCM olarak üretilebiliyor",
);

const notificationPage = read("app/admin/notifications/page.tsx");
const notificationStyles = read("app/admin/notifications/page.module.css");
const adminShell = read("app/admin/AdminShell.tsx");

for (const panel of ["compose", "automation", "history"]) {
  must(
    notificationPage.includes(`data-admin-panel="${panel}"`),
    `mobil bildirim paneli ayrıştırıldı: ${panel}`,
  );
}
must(
  notificationPage.includes("data-mobile-panel={mobilePanel}") &&
    notificationPage.includes("mobileHistory") &&
    notificationPage.includes("<details"),
  "bildirim ekranında sekmeler, mobil geçmiş kartları ve gelişmiş alanlar var",
);
must(
  notificationStyles.includes('data-mobile-panel="compose"') &&
    notificationStyles.includes('data-mobile-panel="automation"') &&
    notificationStyles.includes('data-mobile-panel="history"') &&
    notificationStyles.includes("position: sticky"),
  "mobil bildirim CSS'i yalnızca seçili paneli gösteriyor ve aksiyonları sabitliyor",
);
must(
  adminShell.includes("MOBILE_QUICK_NAV") &&
    adminShell.includes('aria-label="Hızlı admin menüsü"') &&
    adminShell.includes("env(safe-area-inset-bottom)"),
  "admin mobil hızlı menüsü ve güvenli ekran boşlukları mevcut",
);

const checkout = read("app/checkout/page.tsx");
const productCard = read("components/menu/ProductCard.tsx");
const footer = read("components/Footer.tsx");
const localImages = read("lib/media/local-optimized-image.ts");
const webAssets = read("tools/generate-web-assets.cjs");

must(
  checkout.includes("}, 15_000);") &&
    checkout.includes("if (!activeRouteDeal)") &&
    checkout.includes("activeRouteDeal?.expiresAt"),
  "checkout gereksiz saniyelik tüm sayfa yenilemesi yerine aktif kampanyayı izliyor",
);
must(
  checkout.includes('dynamic(() => import("@/components/CouponBox")') &&
    checkout.includes('dynamic(() => import("@/components/ui/TrackPanel")'),
  "ağır checkout yardımcıları ayrı istemci parçaları olarak yükleniyor",
);
must(
  productCard.includes("requestIdleCallback") &&
    productCard.includes("sessionStorage") &&
    productCard.includes("IMAGE_LAYOUT_CACHE_KEY"),
  "ürün görsel analizi boş zamanda çalışıyor ve oturumda önbellekleniyor",
);
must(
  localImages.includes('replace(/\\.png$/i, ".webp")') &&
    localImages.includes("restoreLocalImageFallback") &&
    webAssets.includes("sharp"),
  "yerel PNG görseller WebP ile hızlanıyor ve güvenli PNG fallback korunuyor",
);
must(
  footer.includes("const operationalRoute") &&
    footer.includes("if (operationalRoute) return null"),
  "admin/TV/Showcase yüzeylerinde gereksiz genel footer ve efektleri çalışmıyor",
);

console.log("\nHava + kazanan + mobil admin + performans v4 regresyon kontrolleri başarılı.");
