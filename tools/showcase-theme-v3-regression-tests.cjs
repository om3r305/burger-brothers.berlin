const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const must = (condition, message) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`OK: ${message}`);
};

const types = read("lib/showcase/types.ts");
const config = read("lib/showcase/config.ts");
const editor = read("lib/showcase/editor.ts");
const runtime = read("lib/showcase/runtime.ts");
const player = read("components/showcase/ShowcasePlayer.tsx");
const stage = read("components/showcase/ShowcaseStage.tsx");
const premium = read("components/showcase/admin/PremiumSceneSettings.tsx");
const themes = read("lib/themes.ts");
const themeClient = read("app/theme-client.tsx");
const globals = read("app/globals.css");
const presets = read("lib/showcase/presets.ts");

must(types.includes('"schnell-promo"') && editor.includes('"schnell-promo"'), "bağımsız Schnell / hediye sahne tipi var");
must(config.includes('type: "schnell-promo"') && config.includes('qrUrl: "/schnellbestellung/enter"'), "ilk kurulumda Schnell sahnesi ve bağımsız masa QR hedefi var");
must(stage.includes("SchnellPromoScene") && stage.includes("schnellPromoScene"), "Schnell sahnesinin profesyonel TV bileşeni var");
must(premium.includes("Bağımsız Schnell ekranı") && premium.includes("genel duyuru paneline bağlı değildir"), "admin Schnell ayrımını açıkça yönetiyor");

for (const field of [
  "reviewCtaEnabled",
  "reviewCtaDurationSeconds",
  "reviewCtaTitle",
  "reviewCtaBody",
  "reviewCtaQrUrl",
  "reviewCtaQrLabel",
]) {
  must(types.includes(field) && config.includes(field), `yorum çağrısı alanı normalize ediliyor: ${field}`);
}
must(runtime.includes("expandShowcaseScenesForPlayback") && runtime.includes("createReviewCtaScene"), "Google çağrısı yorumun hemen arkasına sanal sahne olarak ekleniyor");
must(player.includes("expandShowcaseScenesForPlayback(playable)"), "TV oynatıcı otomatik yorum devamını kullanıyor");
must(player.includes("sceneVisitCountsRef") && stage.includes("contentIndex % reviews.length"), "yorumlar her turda sıradaki içeriğe ilerliyor");
must(stage.includes("snapshot.branding.reviewsUrl"), "Google QR merkezi yorum bağlantısını kullanabiliyor");
must(!/reviewQrPatch[\s\S]{0,500}document\.settings\.qrUrl/.test(editor), "Google QR sipariş QR adresine düşmüyor");
must(premium.includes("Sipariş QR adresinden tamamen ayrıdır"), "admin Google ve sipariş QR ayrımını açıklıyor");

const requiredThemes = [
  "classic", "neon", "easter", "summer", "fathersday", "school",
  "veganweek", "fan", "oktoberfest", "lights", "germany", "halloween",
  "blackweek", "christmas", "winter", "newyear", "valentines",
];
requiredThemes.forEach((id) => must(themes.includes(`"${id}"`), `tema mevcut: ${id}`));
const effects = [...themes.matchAll(/\n\s*effect: "([^"]+)"/g)].map((match) => match[1]);
must(effects.length === requiredThemes.length, "her tema için profesyonel efekt profili tanımlı");
must(new Set(effects).size === requiredThemes.length, "tüm temaların atmosfer dili birbirinden farklı");
must(themes.includes("easterSunday(year)") && themes.includes('"fathersday"'), "Vatertag ve Paskalya gerçek hareketli tarihle hesaplanıyor");
must(themes.includes('"school"') && themes.includes('"veganweek"') && themes.includes('"germany"'), "Almanya ve restoran özel takvimleri hazır");
must(presets.includes('"school-report"') && presets.includes('"school-start"') && presets.includes('"vegan-week"'), "karne, okul başlangıcı ve vegan vitrin şablonları var");

must(themeClient.includes('data-effect={decoration.preset.effect}') && themeClient.includes("decoration.count"), "tema motoru profil bazlı ve sınırlı motif sayısıyla çalışıyor");
must(themeClient.includes("deviceMemory <= 4") && themeClient.includes('data-bb-performance'), "düşük güçlü cihazlarda otomatik hafif mod var");
must(themeClient.includes("prefers-reduced-motion: reduce") && themeClient.includes("burst.remove()"), "tıklama efekti hareket tercihini ve temizliği koruyor");
must(globals.includes(".bb-theme-burst") && globals.includes("contain:strict"), "hafif tıklama efekti ve izole dekor katmanı var");
must(!globals.includes("Christmas snow cap"), "eski beyaz Christmas çizgisi kaldırıldı");
must(globals.includes('data-bb-theme="fathersday"') && globals.includes('data-bb-theme="school"') && globals.includes('data-bb-theme="veganweek"') && globals.includes('data-bb-theme="germany"'), "yeni temaların tam renk paletleri var");
must(globals.includes("@media (prefers-reduced-motion:reduce)") && globals.includes("data-bb-performance=\"lite\""), "erişilebilirlik ve performans CSS korumaları var");

console.log("\nShowcase + Theme Engine v3 regresyon kontrolleri başarılı.");
