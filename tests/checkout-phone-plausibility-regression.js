const fs = require("node:fs");

const source = fs.readFileSync(
  "components/checkout/CheckoutPhoneStatusCopy.tsx",
  "utf8",
);

const requiredSnippets = [
  "function normalizeGermanPhone",
  "Bitte gib eine gültige deutsche Telefonnummer ein.",
  "input.setCustomValidity",
  "1{5,}",
  "Telefonnummer hat ein gültiges Format.",
  "✓ Telefonnummer bestätigt",
];

for (const snippet of requiredSnippets) {
  if (!source.includes(snippet)) {
    throw new Error(`Missing checkout phone plausibility guard: ${snippet}`);
  }
}

console.log("checkout phone plausibility regression: ok");
