import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});
const publicJwk = publicKey.export({ format: "jwk" });
const privateJwk = privateKey.export({ format: "jwk" });

if (!publicJwk.x || !publicJwk.y || !privateJwk.d) {
  throw new Error("VAPID key generation failed");
}

const rawPublicKey = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(publicJwk.x, "base64url"),
  Buffer.from(publicJwk.y, "base64url"),
]);

console.log("NEXT_PUBLIC_VAPID_PUBLIC_KEY=" + rawPublicKey.toString("base64url"));
console.log("VAPID_PRIVATE_KEY=" + privateJwk.d);
console.log("VAPID_SUBJECT=mailto:YOUR-EMAIL@burger-brothers.berlin");
console.log("");
console.log("Keep VAPID_PRIVATE_KEY only in Vercel environment variables.");
