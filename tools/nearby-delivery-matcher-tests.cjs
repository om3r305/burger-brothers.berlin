const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const file = path.resolve(__dirname, "../lib/server/nearby-delivery-matcher.ts");
const source = fs.readFileSync(file, "utf8");
const compiled = ts.transpileModule(source, {
  fileName: file,
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    strict: true,
    esModuleInterop: true,
  },
  reportDiagnostics: true,
});

const errors = (compiled.diagnostics || []).filter(
  (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
);
assert.equal(
  errors.length,
  0,
  errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n"),
);

const matcherModule = new Module(file, module);
matcherModule.filename = file;
matcherModule.paths = Module._nodeModulePaths(path.dirname(file));
matcherModule._compile(compiled.outputText, file);

const { groupAcceptsNearbyAddress, rankNearbyDeliveryMatch } = matcherModule.exports;

const sourceAddress = { plz: "13405", street: "a str", lat: null, lng: null };
const adjacentAddress = { plz: "13405", street: "a1 str", lat: null, lng: null };
const wrongPlzAddress = { plz: "13507", street: "a1 str", lat: null, lng: null };
const settings = {
  sameStreet: true,
  streetGroupsEnabled: true,
  samePlz: false,
  routeCluster: false,
  radiusEnabled: false,
  radiusM: 800,
};
const streetGroup = {
  id: "a-zone",
  plz: new Set(["13405"]),
  streets: new Set(["a str", "a1 str"]),
};

assert.equal(groupAcceptsNearbyAddress(streetGroup, sourceAddress), true);
assert.equal(groupAcceptsNearbyAddress(streetGroup, adjacentAddress), true);
assert.equal(groupAcceptsNearbyAddress(streetGroup, wrongPlzAddress), false);

assert.deepEqual(
  rankNearbyDeliveryMatch({
    source: sourceAddress,
    candidate: adjacentAddress,
    settings,
    groups: [streetGroup],
    sourceGroupIds: [streetGroup.id],
    sourceCluster: null,
    clusterByStreet: new Map(),
  }),
  { rank: 400, matchType: "street_group" },
);

assert.deepEqual(
  rankNearbyDeliveryMatch({
    source: sourceAddress,
    candidate: sourceAddress,
    settings,
    groups: [streetGroup],
    sourceGroupIds: [streetGroup.id],
    sourceCluster: null,
    clusterByStreet: new Map(),
  }),
  { rank: 500, matchType: "same_street" },
);

assert.deepEqual(
  rankNearbyDeliveryMatch({
    source: sourceAddress,
    candidate: wrongPlzAddress,
    settings,
    groups: [streetGroup],
    sourceGroupIds: [streetGroup.id],
    sourceCluster: null,
    clusterByStreet: new Map(),
  }),
  { rank: 0, matchType: "" },
);

const plzOnlyGroup = {
  id: "plz-zone",
  plz: new Set(["13405"]),
  streets: new Set(),
};
assert.equal(groupAcceptsNearbyAddress(plzOnlyGroup, adjacentAddress), true);
assert.equal(groupAcceptsNearbyAddress(plzOnlyGroup, wrongPlzAddress), false);

const nearbyPoint = {
  plz: "13507",
  street: "other str",
  lat: 52.5872,
  lng: 13.2902,
};
const radiusResult = rankNearbyDeliveryMatch({
  source: { ...sourceAddress, lat: 52.5869, lng: 13.2894 },
  candidate: nearbyPoint,
  settings: { ...settings, streetGroupsEnabled: false, radiusEnabled: true },
  groups: [],
  sourceGroupIds: [],
  sourceCluster: null,
  clusterByStreet: new Map(),
});
assert.equal(radiusResult.matchType, "radius");
assert(radiusResult.rank > 250 && radiusResult.rank <= 350);

console.log("Nearby delivery matcher tests: OK");
