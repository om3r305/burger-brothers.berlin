const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const required = [
  "app/showcase/page.tsx",
  "app/showcase/layout.tsx",
  "app/admin/showcase/page.tsx",
  "app/api/showcase/route.ts",
  "app/api/admin/showcase/route.ts",
  "app/api/admin/showcase/media/route.ts",
  "components/showcase/ShowcasePlayer.tsx",
  "components/showcase/ShowcaseStage.tsx",
  "components/showcase/ShowcaseStage.module.css",
  "lib/showcase/types.ts",
  "lib/showcase/config.ts",
  "lib/showcase/server.ts",
  "lib/server/cloudinary.ts",
];

for (const file of required) assert(exists(file), `Missing showcase file: ${file}`);

const middleware = read("middleware.ts");
assert(
  middleware.includes('path === "/api/showcase" && readOnly'),
  "GET /api/showcase must be explicitly public",
);
assert(
  middleware.includes('if (child(path, "/api/admin")) return "admin"'),
  "Admin API routes must remain admin protected",
);
assert(
  middleware.includes('child(path, "/dashboard")'),
  "Existing order dashboard protection must remain intact",
);

const dashboard = read("app/dashboard/page.tsx");
assert(
  dashboard.includes("/api/orders/list"),
  "Existing order dashboard appears to have been replaced",
);

const adminShell = read("app/admin/AdminShell.tsx");
assert(adminShell.includes('/admin/showcase'), "Admin navigation is missing Schaufenster");


const showcaseServer = read("lib/showcase/server.ts");
assert(
  showcaseServer.includes('siteConfig.brand.logoPath'),
  "Showcase must use the same fallback logo as the landing page",
);
assert(
  showcaseServer.includes('"/flames/flame-loop.mp4"'),
  "Showcase must use the landing page flame video as the default theme background",
);

const showcaseStage = read("components/showcase/ShowcaseStage.tsx");
assert(
  showcaseStage.includes("ThemeDecorations"),
  "Showcase must render active seasonal effects inside the TV stage",
);
assert(
  showcaseStage.includes("locationLabel"),
  "Showcase landing scene must include the landing location label",
);

const showcaseAdmin = read("app/admin/showcase/page.tsx");
assert(
  showcaseAdmin.includes("Vitrin Yönetimi") && showcaseAdmin.includes("Site verilerini yenile"),
  "Showcase admin interface must be Turkish",
);
assert(
  showcaseAdmin.includes("Giriş sayfasındaki tema, video ve logo"),
  "Showcase admin must explain automatic landing theme synchronization",
);

const cloudinary = read("lib/server/cloudinary.ts");
for (const variable of [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
]) {
  assert(
    cloudinary.includes(`process.env.${variable}`),
    `Missing Cloudinary env integration: ${variable}`,
  );
}
assert(
  !/CLOUDINARY_API_SECRET\s*=\s*["'][^"']+["']/.test(cloudinary),
  "Cloudinary secret must not be hard-coded",
);
assert(
  cloudinary.includes("verifyCloudinaryUploadResponse"),
  "Cloudinary upload response signature must be verified server-side",
);
assert(
  cloudinary.includes("deleteCloudinaryAsset"),
  "Cloudinary asset deletion helper is missing",
);

const mediaRoute = read("app/api/admin/showcase/media/route.ts");
assert(mediaRoute.includes('action === "sign"'), "Signed Cloudinary upload action is missing");
assert(mediaRoute.includes('action === "register"'), "Cloudinary register action is missing");
assert(
  mediaRoute.includes("CLOUDINARY_RESPONSE_SIGNATURE_INVALID"),
  "Cloudinary response verification guard is missing",
);

const player = read("components/showcase/ShowcasePlayer.tsx");
assert(
  player.includes("bb-showcase-cloudinary-media-v1") &&
    player.includes("persistCloudinaryMedia"),
  "Showcase Cloudinary media cache is missing",
);

console.log("Showcase regression checks passed.");
