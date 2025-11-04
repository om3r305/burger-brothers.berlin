
export function generateShortOrderId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  const now = Date.now().toString(36).toUpperCase();
  let seed = 0;
  for (let i = 0; i < now.length; i++) seed = (seed * 31 + now.charCodeAt(i)) >>> 0;
  let out = "";
  for (let i = 0; i < 6; i++) {
    seed ^= (Math.random() * 0xffffffff) >>> 0;
    out += alphabet[(seed >>> (i * 5)) & 31];
  }
  return out;
}
