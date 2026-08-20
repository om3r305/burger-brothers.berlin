const assert = require("node:assert/strict");
const fs = require("node:fs");

const configSource = fs.readFileSync("lib/assistant/realtime-v2-config.ts", "utf8");
const route = fs.readFileSync("app/api/assistant/realtime/route.ts", "utf8");

// realtime-v2-config.ts intentionally stays valid JS except for the export keyword,
// so the critical configuration behavior can be tested without ts-node/tsx.
const runnable = configSource
  .replace(/export\s+/g, "")
  .replace(/: unknown/g, "")
  .replace(/: number/g, "");
const factory = new Function(
  "process",
  `${runnable}; return { buildRealtimeV2Config };`,
);
const { buildRealtimeV2Config } = factory({ env: {} });

const defaults = buildRealtimeV2Config({});
assert.equal(defaults.model, "gpt-realtime-2.1");
assert.equal(defaults.maxOutputTokens, 1200);
assert.deepEqual(defaults.turnDetection, {
  type: "semantic_vad",
  eagerness: "low",
  create_response: true,
  interrupt_response: false,
});

const staleV19 = buildRealtimeV2Config({
  OPENAI_REALTIME_MODEL: "gpt-realtime-2.1-mini",
  OPENAI_REALTIME_MAX_OUTPUT_TOKENS: "220",
  OPENAI_REALTIME_INTERRUPT_RESPONSE: "1",
  OPENAI_REALTIME_VAD_THRESHOLD: "0.55",
});
assert.equal(staleV19.model, "gpt-realtime-2.1");
assert.equal(staleV19.maxOutputTokens, 1200);
assert.equal(staleV19.turnDetection.type, "semantic_vad");
assert.equal(staleV19.turnDetection.interrupt_response, false);

const miniAb = buildRealtimeV2Config({
  OPENAI_REALTIME_V2_MODEL: "gpt-realtime-2.1-mini",
  OPENAI_REALTIME_V2_MAX_OUTPUT_TOKENS: "900",
  OPENAI_REALTIME_V2_SEMANTIC_EAGERNESS: "medium",
});
assert.equal(miniAb.model, "gpt-realtime-2.1-mini");
assert.equal(miniAb.maxOutputTokens, 900);
assert.equal(miniAb.turnDetection.eagerness, "medium");

const serverFallback = buildRealtimeV2Config({
  OPENAI_REALTIME_V2_VAD: "server_vad",
  OPENAI_REALTIME_V2_VAD_THRESHOLD: "0.74",
  OPENAI_REALTIME_V2_VAD_PREFIX_MS: "340",
  OPENAI_REALTIME_V2_VAD_SILENCE_MS: "760",
  OPENAI_REALTIME_V2_INTERRUPT_RESPONSE: "1",
});
assert.deepEqual(serverFallback.turnDetection, {
  type: "server_vad",
  threshold: 0.74,
  prefix_padding_ms: 340,
  silence_duration_ms: 760,
  create_response: true,
  interrupt_response: true,
});

assert.match(route, /buildRealtimeV2Config/);
assert.match(route, /output:\s*\{[\s\S]*voice,/);
assert.match(route, /speed:\s*1\.0/);
assert.match(route, /parallel_tool_calls:\s*false/);
assert.match(route, /EXACT MATCHES BEAT RELATED ITEMS/);
assert.match(route, /Extra Cheesy.*ohne Tomato/s);
assert.match(route, /lower-ranked sibling[\s\S]*Cheese Fries/);
assert.match(route, /Never verbally confirm a removal or customization unless/s);

console.log("Burger Assistant Realtime V2 checks PASSED.");
