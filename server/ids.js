import { randomBytes } from "node:crypto";

const PREFIX = /^[a-z][a-z0-9]{0,15}$/;

/**
 * Create an opaque, URL-safe identifier with 128 bits of CSPRNG entropy.
 *
 * The previous `randomUUID().slice(...)` pattern kept the UUID hyphen while
 * discarding most of its randomness. At sufficient write volume that turns a
 * harmless-looking display ID into a real primary-key collision boundary.
 */
export function opaqueId(prefix, { random = randomBytes } = {}) {
  const label = String(prefix || "").trim().toLowerCase();
  if (!PREFIX.test(label)) throw new TypeError("Opaque id prefix is invalid.");
  const bytes = random(16);
  if (!Buffer.isBuffer(bytes) || bytes.byteLength !== 16) {
    throw new TypeError("Opaque id entropy source must return 16 bytes.");
  }
  // Hex is intentionally used instead of base64url. Direct-message thread
  // keys use "__" as their participant separator; base64url can itself emit
  // underscores and would make a valid generated account id ambiguous.
  return `${label}_${bytes.toString("hex")}`;
}
