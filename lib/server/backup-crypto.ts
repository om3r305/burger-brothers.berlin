import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const FORMAT = "burger-brothers-backup";
const VERSION = 1;
const AAD = Buffer.from(`${FORMAT}:v${VERSION}`, "utf8");

export type EncryptedBackupEnvelope = {
  format: typeof FORMAT;
  version: typeof VERSION;
  algorithm: "aes-256-gcm";
  keyId: string;
  createdAt: string;
  iv: string;
  authTag: string;
  plaintextSha256: string;
  ciphertext: string;
};

function encryptionKey() {
  const configured = String(process.env.BACKUP_ENCRYPTION_KEY || "").trim();
  let key: Buffer;

  if (/^[a-f0-9]{64}$/i.test(configured)) {
    key = Buffer.from(configured, "hex");
  } else {
    key = Buffer.from(configured, "base64");
  }

  if (key.length !== 32) {
    throw new Error("BACKUP_ENCRYPTION_KEY_INVALID");
  }

  return key;
}

export function isEncryptedBackupEnvelope(
  value: unknown,
): value is EncryptedBackupEnvelope {
  const input = value as Partial<EncryptedBackupEnvelope> | null;
  return Boolean(
    input &&
      input.format === FORMAT &&
      input.version === VERSION &&
      input.algorithm === "aes-256-gcm" &&
      input.iv &&
      input.authTag &&
      input.ciphertext,
  );
}

export function encryptBackupPayload(value: unknown): EncryptedBackupEnvelope {
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    format: FORMAT,
    version: VERSION,
    algorithm: "aes-256-gcm",
    keyId: String(process.env.BACKUP_ENCRYPTION_KEY_ID || "primary").slice(0, 80),
    createdAt: new Date().toISOString(),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    plaintextSha256: createHash("sha256").update(plaintext).digest("hex"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptBackupPayload(envelope: EncryptedBackupEnvelope) {
  if (!isEncryptedBackupEnvelope(envelope)) {
    throw new Error("BACKUP_ENVELOPE_INVALID");
  }

  const iv = Buffer.from(envelope.iv, "base64");
  const authTag = Buffer.from(envelope.authTag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");

  if (iv.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
    throw new Error("BACKUP_ENVELOPE_INVALID");
  }

  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAAD(AAD);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  const actualHash = createHash("sha256").update(plaintext).digest("hex");

  if (actualHash !== envelope.plaintextSha256) {
    throw new Error("BACKUP_INTEGRITY_CHECK_FAILED");
  }

  return JSON.parse(plaintext.toString("utf8"));
}
