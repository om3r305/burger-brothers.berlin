const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadTypeScript() {
  try {
    return require("typescript");
  } catch {
    return require("/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript");
  }
}

const ts = loadTypeScript();
const root = process.cwd();

function read(relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) throw new Error(`Dosya bulunamadi: ${relative}`);
  return fs.readFileSync(file, "utf8");
}

function expect(value, message) {
  if (!value) throw new Error(message);
}

const types = read("lib/showcase/types.ts");
const config = read("lib/showcase/config.ts");
const scheduleSource = read("lib/showcase/schedule.ts");
const editor = read("lib/showcase/editor.ts");
const basics = read("components/showcase/admin/SceneBasicsEditor.tsx");
const weeklyEditor = read("components/showcase/admin/WeeklyScheduleEditor.tsx");
const stage = read("components/showcase/ShowcaseStage.tsx");
const player = read("components/showcase/ShowcasePlayer.tsx");
const adminPage = read("app/admin/showcase/page.tsx");

for (const token of [
  "weeklyScheduleEnabled?: boolean",
  "weeklyScheduleDays?: ShowcaseWeekday[]",
  "weeklyStartTime?: string",
  "weeklyEndTime?: string",
  "videoPlaybackMode?: ShowcaseVideoPlaybackMode",
]) expect(types.includes(token), `ShowcaseScene alani eksik: ${token}`);

expect(config.includes("weeklyScheduleIsActive(scene, now)"), "sceneIsActive haftalik programi uygulamiyor.");
expect(config.includes('videoPlaybackMode: value?.videoPlaybackMode === "hold" ? "hold" : "loop"'), "Video oynatma modu normalize edilmiyor.");
expect(editor.includes("invalidWeeklySchedule"), "Bos gun secimi validasyonu eksik.");
expect(editor.includes("weeklyScheduleEnabled: scene.weeklyScheduleEnabled"), "Sahne tipi degisiminde haftalik program korunmuyor.");
expect(basics.includes('label="Video oynatma"'), "Admin video oynatma secenegi eksik.");
expect(basics.includes("<WeeklyScheduleEditor"), "Admin haftalik program editoru baglanmamis.");
expect(weeklyEditor.includes("Hafta içi 10:00–16:00 hazır ayarı"), "Mittagsmenu hazir ayari eksik.");
expect(stage.includes('loop={scene.videoPlaybackMode !== "hold"}'), "Video loop/hold davranisi renderer'a baglanmamis.");
expect(player.includes("setScheduleNow(Date.now())"), "TV haftalik program saatini canli yenilemiyor.");
expect(player.includes("sceneIsActive(scene, scheduleNow)"), "TV aktif sahneleri canli Berlin saatine gore filtrelemiyor.");
expect(!player.includes("persistVisibleMedia();\n            advanceScene(playbackKey);"), "Video bitince sahne hala erken atlaniyor.");
expect(!adminPage.includes("durationSeconds: metadata.durationSeconds"), "Video yuklenince sahne suresi hala dosya suresine esitleniyor.");

const compiled = ts.transpileModule(scheduleSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const moduleBox = { exports: {} };
vm.runInNewContext(compiled, {
  module: moduleBox,
  exports: moduleBox.exports,
  require,
  Intl,
  Date,
  Set,
  Object,
  Number,
  String,
  Array,
  console,
});

const { weeklyScheduleIsActive } = moduleBox.exports;
const lunch = {
  weeklyScheduleEnabled: true,
  weeklyScheduleDays: [1, 2, 3, 4, 5],
  weeklyStartTime: "10:00",
  weeklyEndTime: "16:00",
  scheduleTimezone: "Europe/Berlin",
};

const cases = [
  ["Pazartesi 09:59", "2026-07-27T07:59:00Z", false],
  ["Pazartesi 10:00", "2026-07-27T08:00:00Z", true],
  ["Pazartesi 15:59", "2026-07-27T13:59:00Z", true],
  ["Pazartesi 16:00", "2026-07-27T14:00:00Z", false],
  ["Cumartesi 12:00", "2026-08-01T10:00:00Z", false],
];

for (const [label, iso, wanted] of cases) {
  const actual = weeklyScheduleIsActive(lunch, Date.parse(iso));
  expect(actual === wanted, `${label}: beklenen ${wanted}, gelen ${actual}`);
}

const overnight = {
  ...lunch,
  weeklyScheduleDays: [1],
  weeklyStartTime: "20:00",
  weeklyEndTime: "02:00",
};
expect(weeklyScheduleIsActive(overnight, Date.parse("2026-07-27T19:00:00Z")) === true, "Gece yarisi asan program baslangici calismiyor.");
expect(weeklyScheduleIsActive(overnight, Date.parse("2026-07-27T23:00:00Z")) === true, "Gece yarisi asan program sonraki gunde calismiyor.");
expect(weeklyScheduleIsActive(overnight, Date.parse("2026-07-28T00:00:00Z")) === false, "Gece yarisi asan program bitiste kapanmiyor.");

console.log("PASS: Showcase haftalik program ve video sahne suresi regresyon testleri.");
