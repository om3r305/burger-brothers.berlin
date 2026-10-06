const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
process.env.TZ = 'Europe/Berlin';
const source = fs.readFileSync('lib/themes.ts', 'utf8');
const moduleExports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: moduleExports, Date, console, crypto: require('node:crypto').webcrypto });
const settings = { mode: 'automatic', automatic: true, active: 'classic', schedule: moduleExports.createRecommendedThemeSchedule(2026) };
for (const [date, expected] of [
 ['2026-10-31T23:58:00+01:00', 'halloween'],
 ['2026-11-01T00:00:00+01:00', 'veganweek'],
 ['2026-11-07T23:58:00+01:00', 'veganweek'],
 ['2026-11-08T00:00:00+01:00', 'autumn'],
 ['2026-11-19T23:58:00+01:00', 'autumn'],
 ['2026-11-20T00:00:00+01:00', 'blackweek'],
 ['2026-12-24T00:00:00+01:00', 'weihnachten'],
 ['2026-12-27T00:00:00+01:00', 'newyear'],
 ['2027-01-03T00:00:00+01:00', 'winter'],
]) assert.equal(moduleExports.resolveActiveTheme(settings, new Date(date)).theme, expected, date);
console.log('Living seasonal calendar: PASS (Berlin boundaries, Halloween/Vegan handover, uninterrupted November, Christmas/New Year)');
