const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = process.cwd();
let failures = 0;

function ok(condition, message) {
  if (condition) {
    console.log(`✓ ${message}`);
  } else {
    failures += 1;
    console.error(`✗ ${message}`);
  }
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

const syntaxFiles = [
  "lib/rewards/config.ts",
  "lib/server/schnell-rewards.ts",
  "lib/server/schnellbestellung.ts",
  "app/api/admin/rewards/route.ts",
  "components/rewards/admin/RewardProgramPanel.tsx",
  "lib/client/reward-celebration.ts",
  "components/rewards/RewardCamera.tsx",
  "components/rewards/RewardCelebration.tsx",
  "app/api/schnellbestellung/reward/submission/route.ts",
  "lib/server/showcase-live-events.ts",
  "components/showcase/WinnerCelebrationOverlay.tsx",
];

for (const relative of syntaxFiles) {
  const source = read(relative);
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    reportDiagnostics: true,
    fileName: relative,
  });
  const errors = (result.diagnostics || []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  ok(errors.length === 0, `${relative} sözdizimi`);
  if (errors.length) {
    errors.forEach((diagnostic) =>
      console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
    );
  }
}

const engineSource = read("lib/server/schnell-rewards.ts");
ok(!engineSource.includes("generateRewardSlots"), "sabit ödül saatleri motordan kaldırıldı");
ok(engineSource.includes("computeAdaptiveWinChance"), "adaptif spontane ihtimal motoru mevcut");
ok(engineSource.includes("decisionKey: string"), "transaction tekrarında deterministik karar anahtarı mevcut");
ok(engineSource.includes("slotIndex: nextWinSequence"), "eski slot indeksleriyle çakışmadan günlük kazanan sırası korunuyor");

const engineJs = ts.transpileModule(engineSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
  },
}).outputText;
const moduleBox = { exports: {} };
const sandbox = {
  module: moduleBox,
  exports: moduleBox.exports,
  console,
  process,
  Buffer,
  Date,
  Intl,
  setTimeout,
  clearTimeout,
  require(id) {
    if (id === "node:crypto") return require("node:crypto");
    if (id === "@prisma/client") return { Prisma: {} };
    if (id === "@/lib/rewards/config") return {};
    throw new Error(`Beklenmeyen require: ${id}`);
  },
};
vm.runInNewContext(
  `(function(require,module,exports){${engineJs}\n})(require,module,exports);`,
  sandbox,
);
const chance = moduleBox.exports.computeAdaptiveWinChance;

const baseInput = {
  startMinute: 600,
  endMinute: 660,
  winnerLimit: 4,
  previousEligibleOrders: 0,
  minOrdersBetweenWins: 1,
};
const early = chance({
  ...baseInput,
  currentMinute: 605,
  winsSoFar: 0,
  ordersSinceLastWin: 0,
  hasPreviousWin: false,
});
const lateWithoutWins = chance({
  ...baseInput,
  currentMinute: 640,
  winsSoFar: 0,
  ordersSinceLastWin: 0,
  hasPreviousWin: false,
});
const spacing = chance({
  ...baseInput,
  currentMinute: 630,
  winsSoFar: 1,
  ordersSinceLastWin: 0,
  hasPreviousWin: true,
});
const deadline = chance({
  ...baseInput,
  currentMinute: 658,
  winsSoFar: 1,
  ordersSinceLastWin: 0,
  hasPreviousWin: true,
});
const full = chance({
  ...baseInput,
  currentMinute: 630,
  winsSoFar: 4,
  ordersSinceLastWin: 4,
  hasPreviousWin: true,
});

ok(early.chance > 0 && early.chance < 0.5, "pencere başında spontane fakat kontrollü ihtimal");
ok(lateWithoutWins.chance >= 0.75, "40 dakika ödülsüz geçince kota yanmıyor ve ihtimal yükseliyor");
ok(spacing.chance === 0 && spacing.spacingBlocked, "arka arkaya kazanan koruması çalışıyor");
ok(deadline.chance === 1 && deadline.deadlineMode, "son bölümde kalan kota uygun siparişlere öncelik veriyor");
ok(full.chance === 0 && full.remainingWins === 0, "günlük kota dolunca yeni ödül verilmiyor");

const adminPanel = read("components/rewards/admin/RewardProgramPanel.tsx");
ok(!adminPanel.includes("rastgele dağıtım saatleri"), "admin panelinden sabit saat listesi kaldırıldı");
ok(adminPanel.includes("Tüm aktif vitrin ekranlarında göster"), "tüm aktif ekran seçeneği admin panelinde mevcut");
ok(adminPanel.includes("minOrdersBetweenWins"), "kazananlar arası sipariş koruması ayarlanabilir");

const camera = read("components/rewards/RewardCamera.tsx");
ok(camera.includes("loadedmetadata"), "iPhone kamera metadata beklemesi mevcut");
ok(camera.includes("video.srcObject = stream"), "kamera stream'i video elementine bağlanıyor");
ok(camera.includes("await video.play()"), "iPhone video oynatma çağrısı bekleniyor");
ok(camera.includes("webkit-playsinline"), "iPhone inline kamera uyumluluğu mevcut");
ok(
  camera.includes("Nochmal aufnehmen") &&
    camera.includes("✓ Wird mitgesendet") &&
    camera.includes("setConfirmed(Boolean(file))"),
  "tekrar çek ve otomatik fotoğraf seçimi akışı mevcut",
);

const submission = read("app/api/schnellbestellung/reward/submission/route.ts");
ok(
  submission.includes("showcase_queue_failed") &&
    submission.includes("warning"),
  "Showcase geçici hatası müşteri gönderimini kaybettirmiyor",
);
ok(submission.includes("reused showcase queue failed"), "yarım kalan paylaşım tekrarında idempotent tamamlama mevcut");
ok(submission.includes("showcaseQueued"), "istemciye gerçek Showcase kuyruk sonucu dönüyor");

const liveEvents = read("lib/server/showcase-live-events.ts");
ok(liveEvents.includes("targetAllActiveScreens"), "tüm aktif Showcase ekranları hedeflenebiliyor");
ok(liveEvents.includes("showcase:screens"), "aktif ekran listesi mevcut Showcase ayarından okunuyor");
ok(liveEvents.includes('status: { in: ["pending", "played"] }'), "normal paylaşım tekrarında çift canlı etkinlik engelleniyor");

const celebration = read("components/rewards/RewardCelebration.tsx");
ok(celebration.includes("DU HAST") && celebration.includes("GEWONNEN"), "kazandınız ekranı güçlü ve net başlığa sahip");
ok(celebration.includes("bbRewardCountdown"), "kutlama süresi görsel ilerleme çubuğuyla gösteriliyor");
ok(celebration.includes("Auf den Bildschirmen zeigen"), "müşteri metni birden fazla ekranı açıkça belirtiyor");

const soundPath = path.join(root, "public/sounds/reward-celebration.wav");
ok(fs.existsSync(soundPath) && fs.statSync(soundPath).size > 50_000, "yeni kısa kutlama ses dosyası mevcut");

if (failures) {
  console.error(`\n${failures} kontrol başarısız.`);
  process.exit(1);
}
console.log("\nTüm Şanslı Sipariş spontane/kamera/Showcase kontrolleri geçti.");
