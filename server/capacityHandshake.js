import { createHmac, timingSafeEqual } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

export const CAPACITY_CHALLENGE_HEADER = "X-Pit-Capacity-Challenge";
export const CAPACITY_CHALLENGE_PATTERN = /^[a-f0-9]{64}$/;

function canonicalDatabasePath(databasePath) {
  const target = resolve(String(databasePath || ""));
  return typeof realpathSync.native === "function"
    ? realpathSync.native(target)
    : realpathSync(target);
}

// A fresh challenge is the HMAC key, so the response is a one-use proof that
// the running process opened the expected database. The proof never contains a
// path, database contents, or a stable installation identifier.
export function capacityDatabaseProof(databasePath, challenge) {
  const normalizedChallenge = String(challenge || "").trim().toLowerCase();
  if (!CAPACITY_CHALLENGE_PATTERN.test(normalizedChallenge)) {
    throw new TypeError("A 32-byte hexadecimal capacity challenge is required.");
  }
  return createHmac("sha256", Buffer.from(normalizedChallenge, "hex"))
    .update("pit-capacity-database-v1\0", "utf8")
    .update(canonicalDatabasePath(databasePath), "utf8")
    .digest("base64url");
}

export function capacityDatabaseProofMatches(databasePath, challenge, proof) {
  const actual = Buffer.from(String(proof || ""), "utf8");
  const expected = Buffer.from(capacityDatabaseProof(databasePath, challenge), "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
