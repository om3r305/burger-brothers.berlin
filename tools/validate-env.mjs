const production =
  process.argv.includes("--production") ||
  process.env.NODE_ENV === "production" ||
  process.env.VERCEL_ENV === "production";

const errors = [];
const warnings = [];
const value = (name) => String(process.env[name] || "").trim();
const placeholder =
  /^(change[-_ ]?me|changeme|example|placeholder|secret|password|token|123456|admin)$/i;

function required(name, options = {}) {
  const current = value(name);
  if (!current) {
    (production ? errors : warnings).push(`${name}: eksik`);
    return;
  }
  if (placeholder.test(current)) errors.push(`${name}: placeholder değer`);
  if (options.min && current.length < options.min) {
    errors.push(`${name}: en az ${options.min} karakter olmalı`);
  }
  if (options.pattern && !options.pattern.test(current)) {
    errors.push(`${name}: biçim geçersiz`);
  }
}

function completeGroup(label, names) {
  const present = names.filter((name) => value(name));
  if (present.length > 0 && present.length !== names.length) {
    errors.push(`${label}: birlikte gerekli (${names.join(", ")})`);
  }
}

for (const name of [
  "DATABASE_URL",
  "ADMIN_USER",
  "ADMIN_PASS",
  "TV_PIN",
  "SESSION_SECRET",
  "BOOTSTRAP_MIGRATION_TOKEN",
  "CRON_SECRET",
  "ANALYTICS_IP_SECRET",
  "LEGAL_OPERATOR_NAME",
]) {
  const options =
    name === "ADMIN_PASS"
      ? { min: 12 }
      : name === "TV_PIN"
        ? { pattern: /^\d{6,12}$/ }
        : /SECRET|TOKEN/.test(name)
          ? { min: 32 }
          : {};
  required(name, options);
}

if (production) {
  required("ADMIN_TOTP_SECRET", {
    min: 26,
    pattern: /^[A-Z2-7]+=*$/i,
  });
  if (value("RATE_LIMIT_REQUIRE_REMOTE") !== "1") {
    errors.push("RATE_LIMIT_REQUIRE_REMOTE: production'da 1 olmalı");
  }
  const rateUrl = value("UPSTASH_REDIS_REST_URL") || value("RATE_LIMIT_REST_URL");
  const rateToken =
    value("UPSTASH_REDIS_REST_TOKEN") || value("RATE_LIMIT_REST_TOKEN");
  if (!rateUrl || !rateToken) {
    errors.push("Dağıtılmış rate limit URL/token production'da zorunlu");
  }
  for (const name of [
    "SCHNELLBESTELLUNG_SHOP_LAT",
    "SCHNELLBESTELLUNG_SHOP_LNG",
  ]) {
    const numeric = Number(value(name));
    if (!value(name) || !Number.isFinite(numeric)) {
      errors.push(`${name}: production'da gerçek koordinat zorunlu`);
    }
  }
  const fiscalMode = value("FISCAL_OPERATION_MODE");
  if (!["external_certified_pos", "webshop_only"].includes(fiscalMode)) {
    errors.push(
      "FISCAL_OPERATION_MODE: external_certified_pos veya webshop_only olmalı",
    );
  }
  if (fiscalMode === "external_certified_pos" && !value("FISCAL_POS_NAME")) {
    errors.push("FISCAL_POS_NAME: harici sertifikalı kasa adı zorunlu");
  }
}

completeGroup("Stripe", [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
]);
completeGroup("Şifreli backup", [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "BACKUP_BUCKET",
  "BACKUP_ENCRYPTION_KEY",
]);
completeGroup("Cloudinary", [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
]);
completeGroup("R2", [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
]);
completeGroup("Telegram", ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ORDER_CHAT_ID"]);

for (const name of ["NEXT_PUBLIC_BASE_URL", "NEXT_PUBLIC_SITE_URL", "SITE_URL"]) {
  const current = value(name);
  if (production && current && !current.startsWith("https://")) {
    errors.push(`${name}: production'da https olmalı`);
  }
}

if (value("BACKUP_ENCRYPTION_KEY")) {
  const configured = value("BACKUP_ENCRYPTION_KEY");
  const key = /^[a-f0-9]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (key.length !== 32) {
    errors.push("BACKUP_ENCRYPTION_KEY: tam 32 byte olmalı");
  }
}

for (const warning of warnings) console.warn(`[env] UYARI ${warning}`);
for (const error of errors) console.error(`[env] HATA ${error}`);

if (errors.length) process.exit(1);
console.log(
  production
    ? "[env] Production environment sözleşmesi geçerli."
    : "[env] Geliştirme kontrolü tamamlandı (eksikler uyarı olarak gösterildi).",
);
