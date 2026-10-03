// Explicit local preparation only. Importing the DB installs additive native
// triggers; this command does not start HTTP, workers, providers or media fetches.
import { db } from "../server/db.js";
import { prepareClipIndex } from "../server/features/clips/clipIndexPreparation.js";

try {
  const result = await prepareClipIndex(db);
  console.log(JSON.stringify({ clipsIndexReady: result.ready, processed: result.processed }));
} catch (error) {
  console.error(error?.code === "CLIP_INDEX_PHOTOS_OVERSIZED"
    ? error.message : "Clips index preparation failed; database remains unready. Inspect local diagnostics before retrying.");
  process.exitCode = 1;
} finally {
  db.close();
}
