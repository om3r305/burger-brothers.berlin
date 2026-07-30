const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const must = (condition, message) => {
  if (!condition) throw new Error(`HATA: ${message}`);
  console.log(`TAMAM: ${message}`);
};

const themes = read("lib/themes.ts");
const globals = read("app/globals.css");
const editor = read("components/SeasonalThemeEditor.tsx");
const showcase = read("components/showcase/ShowcaseStage.module.css");

const added = [
  "womensday", "medicine", "mothersday", "ramadan", "autumn",
  "anniversary", "pride", "retrowave", "arcade", "popart", "weihnachten",
];

for (const id of added) {
  must(themes.includes(`id: "${id}"`), `tema kataloğunda mevcut: ${id}`);
  must(globals.includes(`data-bb-theme="${id}"`), `müşteri CSS paleti mevcut: ${id}`);
  must(showcase.includes(`.theme_${id} .gradientBase`), `Showcase paleti mevcut: ${id}`);
}

for (const effect of [
  "womens-ribbons", "medical-pulse", "blossoms", "lanterns",
  "harvest", "celebration", "spectrum", "synthwave",
  "pixel-grid", "comic-burst", "christmas-glow",
]) {
  must(themes.includes(`effect: "${effect}"`), `benzersiz efekt tanımlı: ${effect}`);
}

must(
  themes.includes('localDateTime(year, 3, 1)') &&
  themes.includes('localDateTime(year, 3, 8, 23, 59)') &&
  themes.includes('"womensday"'),
  "Kadınlar Günü 1–8 Mart yıllık kuralıyla planlanıyor",
);
must(
  themes.includes('localDateTime(year, 3, 9)') &&
  themes.includes('localDateTime(year, 3, 14, 23, 59)') &&
  themes.includes('"medicine"'),
  "Tıp Bayramı 9–14 Mart yıllık kuralıyla planlanıyor",
);
must(
  themes.includes("nthWeekdayOfMonth(year, 5, 0, 2)"),
  "Muttertag mayısın ikinci pazarı olarak hesaplanıyor",
);
must(
  themes.includes("RAMADAN_RECOMMENDATIONS") &&
  themes.includes("repeatYearly") &&
  themes.includes("Termin prüfen"),
  "Ramadan ay gözlemine karşı yıl bazlı ve düzenlenebilir",
);
must(
  themes.includes("BERLIN_PRIDE_RECOMMENDATIONS") &&
  themes.includes("Berlin Pride / Vielfalt"),
  "Berlin Pride yıl bazlı öneriye bağlı",
);
must(
  themes.includes('"autumn"') &&
  themes.includes("localDateTime(year, 9, 1)") &&
  themes.includes("localDateTime(year, 11, 15, 23, 59)"),
  "Herbst düşük öncelikli yıllık zemin teması olarak planlı",
);
must(
  themes.includes('id: "christmas"') &&
  themes.includes('label: "Advent"') &&
  themes.includes('id: "weihnachten"') &&
  themes.includes('label: "Weihnachten"'),
  "Advent ve Weihnachten iki ayrı tasarım olarak tanımlı",
);
must(
  themes.includes('localDateTime(year, 12, 1)') &&
  themes.includes('localDateTime(year, 12, 23, 23, 59)') &&
  themes.includes('localDateTime(year, 12, 24)') &&
  themes.includes('localDateTime(year, 12, 26, 23, 59)'),
  "Advent 1–23 Aralık, Weihnachten 24–26 Aralık olarak planlanıyor",
);
must(
  themes.includes('"weihnachten",\n      "Weihnachten"') &&
  themes.includes('108,'),
  "Weihnachten Advent temasından yüksek öncelikle devreye giriyor",
);
must(
  globals.includes('data-bb-theme="weihnachten"') &&
  globals.includes('data-effect="christmas-glow"') &&
  showcase.includes('.theme_weihnachten .gradientBase'),
  "Weihnachten müşteri ve Showcase için ayrı renk/efekt atmosferine sahip",
);
must(
  editor.includes("Weltfrauentag/Kadınlar Günü") &&
  editor.includes("Tag der Medizin/Tıp Bayramı") &&
  editor.includes("feste jährliche Regeln"),
  "admin Saison-Zeitplan açıklaması iki yeni yıllık temayı anlatıyor",
);
must(
  editor.includes("Jubiläum, Retro Wave, Burger Arcade und Burger Pop") &&
  editor.includes("manuelle Kampagnen-Designs"),
  "manuel kampanya temaları admin açıklamasında net",
);
must(
  globals.includes('data-effect="womens-ribbons"') &&
  globals.includes('data-effect="medical-pulse"'),
  "Kadınlar Günü ve Tıp Bayramı özel dekor efektlerine sahip",
);
must(
  globals.includes('@media (prefers-reduced-motion:reduce)') ||
  globals.includes('@media (prefers-reduced-motion: reduce)'),
  "hareket azaltma desteği korunuyor",
);

console.log("\n11 yeni tema ve Saison-Zeitplan regresyon kontrolleri başarılı.");
