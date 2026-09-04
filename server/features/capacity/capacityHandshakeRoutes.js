import {
  CAPACITY_CHALLENGE_PATTERN,
  capacityDatabaseProof,
} from "../../capacityHandshake.js";

export function capacityHandshakeRoutes({
  ApiError,
  databasePath,
  environment = () => process.env.NODE_ENV,
}) {
  if (typeof ApiError !== "function" || !databasePath || typeof environment !== "function") {
    throw new TypeError("Capacity handshake routes require complete boundary dependencies");
  }

  return Object.freeze({
    "GET /api/dev/capacity-handshake": (ctx) => {
      // This proof exists only for a local write-capacity test. A production
      // request cannot use it to fingerprint a database path or installation.
      if (environment() === "production") {
        throw new ApiError(404, "Not found.", "NOT_FOUND");
      }
      const challenge = String(ctx.capacityChallenge || "").trim().toLowerCase();
      if (!CAPACITY_CHALLENGE_PATTERN.test(challenge)) {
        throw new ApiError(400, "That capacity check is invalid.", "VALIDATION_FAILED");
      }
      return { proof: capacityDatabaseProof(databasePath, challenge) };
    },
  });
}
