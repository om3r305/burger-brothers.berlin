const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
const must = (condition, message) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`OK: ${message}`);
};

const required = [
  "lib/showcase/presets.ts",
  "lib/showcase/editor.ts",
  "lib/showcase/client-upload.ts",
  "hooks/showcase/use-showcase-editor.ts",
  "components/showcase/admin/ConfirmModal.tsx",
  "components/showcase/admin/PremiumSceneSettings.tsx",
  "components/showcase/admin/SceneBasicsEditor.tsx",
  "components/showcase/admin/ProductSceneEditor.tsx",
  "components/showcase/admin/MenuSceneEditor.tsx",
  "components/showcase/admin/SceneListPanel.tsx",
  "components/showcase/admin/MediaLibraryPanel.tsx",
  "components/showcase/admin/ShowcaseAdminHeader.tsx",
  "components/showcase/admin/ReviewModerationPanel.tsx",
  "components/showcase/admin/ShowcasePreviewSidebar.tsx",
  "app/admin/showcase/error.tsx",
];
required.forEach((file) => must(exists(file), `${file} mevcut`));

const page = read("app/admin/showcase/page.tsx");
const editor = read("lib/showcase/editor.ts");
const presets = read("lib/showcase/presets.ts");
const config = read("lib/showcase/config.ts");
const runtime = read("lib/showcase/runtime.ts");
const server = read("lib/showcase/server.ts");
const stage = read("components/showcase/ShowcaseStage.tsx");
const player = read("components/showcase/ShowcasePlayer.tsx");
const publicRoute = read("app/api/showcase/route.ts");
const premium = read("components/showcase/admin/PremiumSceneSettings.tsx");
const basics = read("components/showcase/admin/SceneBasicsEditor.tsx");
const media = read("components/showcase/admin/MediaLibraryPanel.tsx");
const history = read("hooks/showcase/use-showcase-editor.ts");

must((editor.match(/\n  "[a-z-]+",/g) || []).length === 11, "admin yalnız 11 sade sahne türü gösteriyor");
for (const mapping of ['if (type === "review-qr") return "qr"', 'if (type === "social-video") return "video"', 'if (type === "countdown") return "campaign"', 'if (type === "special-day") return "message"']) must(editor.includes(mapping), `eski sahne dönüşümü: ${mapping}`);
must(!page.includes("window.confirm") && !basics.includes("window.confirm"), "native window.confirm tamamen kaldırıldı");
must(page.includes("ConfirmModal") && read("components/showcase/admin/ConfirmModal.tsx").includes('role="dialog"'), "özel onay modalı kullanılıyor");
must(page.split("\n").length < 900, "ana admin dosyası 900 satırın altına bölündü");
must(page.includes("SceneBasicsEditor") && page.includes("ProductSceneEditor") && page.includes("MenuSceneEditor") && page.includes("ShowcasePreviewSidebar"), "admin componentlere ayrıldı");
must(editor.includes("replaceSceneType") && editor.includes("const fresh = createShowcaseScene"), "tip değişimi temiz varsayımlardan yapılıyor");
must(history.includes("COALESCE_MS") && history.includes("coalesceKey"), "history tuş vuruşlarını gruplayarak kaydediyor");
must(history.includes("type EditorSnapshot") && history.includes("selectedId"), "undo/redo belge ve seçimi atomik saklıyor");
must(page.includes('window.addEventListener("keydown"') && page.includes("}, []);"), "keyboard listener sabit bağlanıyor");
must(page.includes("targetSceneId") && page.includes("targetScreenSlug") && page.includes("screenSlugRef.current === targetScreenSlug"), "medya yükleme başladığı sahneye güvenli atanıyor");
must(runtime.includes("requested.length") && runtime.includes(": available"), "boş menü seçimi tüm aktif kategorilere düşüyor");
must(runtime.includes("productMaxTotalSeconds") && runtime.includes("Math.min(raw"), "ürün akışı toplam süreyle sınırlandırılıyor");
must(basics.includes("campaignScenePatch") && basics.includes("Kampanya verisini otomatik kullan"), "kampanya DB içeriği otomatik bağlanıyor");
must(server.includes("campaignScenePatch") && server.includes("mappedCampaigns"), "yayın snapshotı kampanya güncellemelerini canlı hydrate ediyor");
must(presets.includes("halloween") && presets.includes("christmas") && presets.includes("germany-unity") && presets.includes("women-berlin") && presets.includes("nikolaus"), "Almanya ve uluslararası özel gün presetleri var");
must(premium.includes("Manuel emoji") && premium.includes("Özel logo / görsel URL") && premium.includes("Otomatik tarih"), "özel gün manuel emoji/logo/tarih kontrolleri var");
must(stage.includes("SPECIAL_DAY_PRESETS") && premium.includes("SPECIAL_DAY_PRESETS"), "admin ve TV aynı özel gün kaynağını kullanıyor");
must(premium.includes("Hazır Almanca hava metinleri") && premium.includes("Canlı kaynak") && premium.includes("Şu an seçilen otomatik metin"), "hava kaynağı ve hazır metinler admin içinde görünür");
must(server.includes("WEATHER_TTL_MS") && server.includes("cache_fallback"), "canlı hava 10 dakika cache ve son sağlam fallback kullanıyor");
must(premium.includes("Yayın kuralı") && premium.includes("Bu filtreyle gösterilebilir"), "yorum onay filtresi görünür");
must(stage.includes("review.approved !== false") && stage.includes("reviewMinRating"), "TV yalnız uygun onaylı yorumları gösteriyor");
must(player.includes("knownVersion") && player.includes("unchanged") && player.includes("5 * 60_000"), "TV hafif sürüm kontrolü ve periyodik canlı veri yenilemesi kullanıyor");
must(publicRoute.includes("readPublishedShowcaseVersion") && publicRoute.includes("lastSuccessfulSnapshots"), "public API sürüm kontrolü ve ekran bazlı fallback kullanıyor");
must(media.includes("onUpload(file).finally") && page.includes("inspectShowcaseFile"), "medya yükleme modüle ayrıldı ve input güvenli sıfırlanıyor");
must(config.includes('countdownEndBehavior !== "ended"') && stage.includes("AKTION BEENDET"), "countdown bitiş davranışı açıkça uygulanıyor");
must(config.includes("specialDayPresetIsActive") && presets.includes("specialDayPresetIsActive"), "özel gün otomatik takvimi ortak kaynaktan çalışıyor");
console.log("\nShowcase Final V2 regresyon kontrolleri başarılı.");
