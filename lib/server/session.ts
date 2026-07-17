const encoder = new TextEncoder();

export type SessionRole = "admin" | "tv" | "driver";
export type SessionPayload = {
  role: SessionRole;
  exp: number;
  nonce: string;
  sub?: string;
};

function b64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromB64url(value: string) {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function secret() {
  const value = String(
    process.env.SESSION_SECRET || process.env.AUTH_SECRET || "",
  ).trim();

  if (!value || value.length < 32) {
    throw new Error("SESSION_SECRET_MISSING_OR_TOO_SHORT");
  }

  return value;
}

async function key() {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function tokenPrefix(role: SessionRole) {
  if (role === "admin") return "ok:";
  if (role === "tv") return "tv:";
  return "driver:";
}

export async function createSessionToken(
  role: SessionRole,
  maxAgeSeconds: number,
  subject?: string,
) {
  const payload: SessionPayload = {
    role,
    exp: Math.floor(Date.now() / 1000) + maxAgeSeconds,
    nonce: crypto.randomUUID(),
    ...(subject ? { sub: String(subject).slice(0, 160) } : {}),
  };
  const encoded = b64url(encoder.encode(JSON.stringify(payload)));
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      await key(),
      encoder.encode(encoded),
    ),
  );

  return `${tokenPrefix(role)}${encoded}.${b64url(signature)}`;
}

export async function readSessionToken(
  token: string,
  expectedRole: SessionRole,
): Promise<SessionPayload | null> {
  try {
    const prefix = tokenPrefix(expectedRole);
    if (!token.startsWith(prefix)) return null;

    const [encoded, signature, ...rest] = token
      .slice(prefix.length)
      .split(".");

    if (!encoded || !signature || rest.length) return null;

    const signatureBytes = fromB64url(signature);
    const payloadBytes = fromB64url(encoded);

    // Aynı byte dizisinin alternatif/non-canonical Base64URL yazımlarını reddet.
    if (b64url(signatureBytes) !== signature || b64url(payloadBytes) !== encoded) {
      return null;
    }

    const valid = await crypto.subtle.verify(
      "HMAC",
      await key(),
      signatureBytes,
      encoder.encode(encoded),
    );

    if (!valid) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(payloadBytes),
    ) as SessionPayload;

    if (
      payload.role !== expectedRole ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export async function verifySessionToken(
  token: string,
  expectedRole: SessionRole,
) {
  return Boolean(await readSessionToken(token, expectedRole));
}
