import { db } from "../server/db.js";
import { drainLegacyImageRecovery } from "../server/legacyPostImageRecovery.js";
import { verifyPrivateMediaBucketIsolation } from "../server/media.js";

try {
  if (String(process.env.NODE_ENV || "").toLowerCase() === "production") {
    const privacy = await verifyPrivateMediaBucketIsolation({ env: process.env });
    if (!privacy.ready) {
      throw new Error(`Private media isolation is not ready (${privacy.errorCode || "probe_failed"}).`);
    }
  }
  const result = await drainLegacyImageRecovery(db, { maxItems: 32 });
  console.log(JSON.stringify({
    scanned: result.scanned,
    recovered: result.recovered.length,
    postRecovered: result.posts.recovered,
    profileRecovered: result.profiles.recovered,
    failed: result.failed.map(({ kind, code }) => ({ kind, code })),
    exhausted: result.exhausted,
    limitReached: result.limitReached,
  }));
  if (result.failed.length || !result.exhausted) process.exitCode = 1;
} finally {
  db.close();
}
