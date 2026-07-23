const fs = require("fs");
const path = require("path");
const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const must = (condition, message) => {
  if (!condition) {
    console.error("FAIL:", message);
    process.exitCode = 1;
  } else {
    console.log("OK:", message);
  }
};

const page = read("app/admin/showcase/page.tsx");
const premium = read("components/showcase/admin/PremiumSceneSettings.tsx");
const presets = read("lib/showcase/presets.ts");
const config = read("lib/showcase/config.ts");
const stage = read("components/showcase/ShowcaseStage.tsx");
const player = read("components/showcase/ShowcasePlayer.tsx");
const route = read("app/api/admin/showcase/route.ts");
const types = read("lib/showcase/types.ts");

must(!/const validateDraft[\s\S]{0,900}setSelectedId/.test(page), "validateDraft state değiştirmiyor");
must(page.includes("AbortController") && page.includes("loadRequestRef"), "ekran değişimi race koruması var");
must(page.includes("const undo =") && page.includes("const redo ="), "undo/redo var");
must(page.includes('event.key.toLowerCase() === "s"'), "Ctrl+S kısayolu var");
must(config.includes('countdownEndBehavior !== "ended"'), "bitmiş countdown otomatik atlanıyor");
must(config.includes("specialPresetIsActive"), "özel gün otomatik takvimi var");
must((config.includes("Math.min(60") && config.includes("Math.max(10")) || config.includes("numberInRange(value?.settings?.refreshSeconds, 15, 10, 60)"), "polling 10-60 saniye aralığında");
must(stage.includes("Aktuelle Wetterdaten werden gerade geladen"), "hava durumu güvenli fallback var");
must(stage.includes("specialLogoUrl") && stage.includes("specialEmoji"), "manuel logo ve emoji desteği var");
must(presets.includes("Cadılar Bayramı") && presets.includes("Weihnachten") && presets.includes("Silvester"), "özel gün şablonları var");
must(route.includes("weather: snapshot.weather") && route.includes("bestsellers: snapshot.bestsellers"), "admin canlı veri kaynaklarını alıyor");
must(premium.includes("Canlı kaynak") && premium.includes("Yayın kuralı"), "veri bağlı sahnelerin kaynakları admin içinde görünür");
must(player.includes("ShowcaseErrorBoundary"), "TV player error boundary ile korunuyor");
must(types.includes('"halloween"') && types.includes('"christmas"') && types.includes('"germany"'), "genişletilmiş özel gün temaları tiplerde var");

if (!process.exitCode) console.log("\nShowcase final hardening regression kontrolleri başarılı.");
