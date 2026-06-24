// lib/order-id.ts
import { randomBytes } from "crypto";

// I, O, 0, 1 yok → telefonla okunurken karışmasın diye
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Kısa sipariş kodu üretir.
 * Bu kod direkt Prisma Order.id için kullanılacak (DB primary key).
 *
 * Örn: "F9ZK2Q"
 */
export function generateOrderId(len = 6): string {
  const size = Math.max(4, Math.min(24, Math.floor(Number(len) || 6)));
  const bytes = randomBytes(size);

  let out = "";

  for (let i = 0; i < size; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }

  return out;
}