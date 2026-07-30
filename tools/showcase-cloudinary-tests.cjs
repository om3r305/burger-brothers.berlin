const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const helper = read("lib/server/cloudinary.ts");
const mediaRoute = read("app/api/admin/showcase/media/route.ts");
const admin = read("app/admin/showcase/page.tsx");
const uploadClient = read("lib/showcase/client-upload.ts");
const envExample = read(".env.example");
const types = read("lib/showcase/types.ts");
const config = read("lib/showcase/config.ts");
const player = read("components/showcase/ShowcasePlayer.tsx");

for (const required of [
  "createCloudinaryUploadSignature",
  "verifyCloudinaryUploadResponse",
  "isAllowedCloudinaryPublicId",
  "isCloudinaryDeliveryUrl",
  "deleteCloudinaryAsset",
]) {
  assert(helper.includes(required), `Cloudinary helper missing: ${required}`);
}

assert(helper.includes('createHash("sha1")'), "Cloudinary signatures must use SHA-1 by default");
assert(helper.includes("timingSafeEqual"), "Response signature comparison must be timing safe");
assert(helper.includes("Math.min(\n    95"), "Direct upload limit must stay below 100 MB");
assert(!helper.includes("CLOUDINARY_API_SECRET ="), "Cloudinary secret must not be hard-coded");

assert(mediaRoute.includes('action === "sign"'), "Signed upload action missing");
assert(mediaRoute.includes('action === "register"'), "Register action missing");
assert(mediaRoute.includes("verifyCloudinaryUploadResponse"), "Upload response verification missing");
assert(mediaRoute.includes("LEGACY_MEDIA_DELETE_UNAVAILABLE"), "Legacy delete safety guard missing");
assert(mediaRoute.includes("MEDIA_IS_IN_USE"), "In-use media deletion guard missing");

assert(admin.includes("uploadShowcaseMediaWithProgress"), "Cloudinary multipart upload client missing");
assert(uploadClient.includes("uploadShowcaseMediaWithProgress"), "Cloudinary upload helper missing");
assert(uploadClient.includes('form.append("file", file)'), "Upload file must be sent as multipart form data");
assert(envExample.includes("CLOUDINARY_CLOUD_NAME="), "Cloudinary setup variable missing");
assert(!admin.includes("Cloudflare R2"), "Old R2 labels remain in admin UI");

assert(types.includes('provider?: "cloudinary"'), "Cloudinary media provider metadata missing");
assert(types.includes("publicId?: string"), "Cloudinary public ID metadata missing");
assert(config.includes("publicId: cleanText"), "Cloudinary media metadata normalization missing");

assert(player.includes("MEDIA_CACHE_NAME"), "Cloudinary Cache Storage name missing");
assert(player.includes("persistCloudinaryMedia"), "Cloudinary media persistence missing");
assert(player.includes("pruneCloudinaryMediaCache"), "Cloudinary media cache pruning missing");

const sample = "public_id=sample&version=1315060510abcd";
assert(
  crypto.createHash("sha1").update(sample).digest("hex") ===
    "912d90b6fe28aa6820cf928bc440a65a0f36e002",
  "Cloudinary response signature reference calculation failed",
);

console.log("Cloudinary showcase regression checks passed.");
