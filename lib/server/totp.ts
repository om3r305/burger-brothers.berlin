import { createHmac, timingSafeEqual } from "node:crypto";

function decodeBase32(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = value.toUpperCase().replace(/[\s=-]/g, "");
  let bits = "";
  for (const character of clean) {
    const index = alphabet.indexOf(character);
    if (index < 0) return Buffer.alloc(0);
    bits += index.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function codeAt(secret: Buffer, counter: number) {
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(counterBytes).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function verifyTotp(
  token: unknown,
  base32Secret: unknown,
  nowMs = Date.now(),
) {
  const supplied = String(token || "").trim();
  const secret = decodeBase32(String(base32Secret || ""));
  if (!/^\d{6}$/.test(supplied) || secret.length < 16) return false;

  const counter = Math.floor(nowMs / 30_000);
  for (const drift of [-1, 0, 1]) {
    const expected = codeAt(secret, counter + drift);
    const left = Buffer.from(supplied);
    const right = Buffer.from(expected);
    if (left.length === right.length && timingSafeEqual(left, right)) {
      return true;
    }
  }
  return false;
}
