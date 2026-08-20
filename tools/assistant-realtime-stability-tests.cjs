const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const route = fs.readFileSync(path.join(root, "app/api/assistant/realtime/route.ts"), "utf8");

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS: ${message}`);
}

assert(
  route.includes('envFloat("OPENAI_REALTIME_VAD_THRESHOLD", 0.72, 0.55, 0.9)') &&
    route.includes('envInt("OPENAI_REALTIME_VAD_PREFIX_MS", 320, 200, 600)') &&
    route.includes('envInt("OPENAI_REALTIME_VAD_SILENCE_MS", 720, 500, 1400)'),
  "Realtime uses conservative noisy-environment VAD defaults with bounded overrides",
);

assert(
  route.includes('process.env.OPENAI_REALTIME_INTERRUPT_RESPONSE === "1"') &&
    route.includes("interrupt_response: automaticInterrupt"),
  "Automatic barge-in is opt-in instead of cutting speech on transient background noise",
);

assert(
  route.includes("recommend exactly 3 available suitable burgers") &&
    route.includes("Give one very short reason for each"),
  "Burger recommendation requests target three live options",
);

assert(
  route.includes("Do not narrate tool work with filler") &&
    route.includes("confirm only when the current customer request is fully resolved"),
  "Tool work avoids spoken waiting filler and premature partial confirmations",
);

assert(
  route.includes("resolve every requested item in the SAME turn") &&
    route.includes("Never falsely claim all items were added"),
  "Multi-item requests remain active until all unambiguous items are resolved",
);

assert(
  route.includes('OPENAI_REALTIME_MODEL || "gpt-realtime-2.1-mini"') &&
    route.includes('reasoning: { effort: "low" }') &&
    route.includes('process.env.OPENAI_REALTIME_TRANSCRIPT === "1"'),
  "Cost controls keep realtime mini, low reasoning and paid transcript opt-in",
);

if (process.exitCode) {
  console.error("\nRealtime stability checks FAILED.");
  process.exit(process.exitCode);
}

console.log("\nRealtime stability checks PASSED.");
