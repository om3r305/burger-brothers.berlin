// lib/qr.ts
import crypto from "crypto";

export function createRandomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url"); // URL-safe
}

export function minutesFromNow(min: number) {
  return Date.now() + Math.max(1, min) * 60_000;
}

/** Basit bir Google Maps adres linki üretici (ZIP + Street + House) */
export function mapsUrlFromAddress(addr: string) {
  // En temizi: tamamını query’e koy
  const q = encodeURIComponent(addr);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}
