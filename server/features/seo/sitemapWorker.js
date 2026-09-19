import { createSitemapSnapshot } from "./sitemapService.js";
import { openSitemapReadDatabase } from "./sitemapReadDatabase.js";
import { normalizedSitemapProcessInput, sitemapDocumentBytes, SITEMAP_PROCESS_LIMITS } from "./sitemapProcess.js";
import { registerRuntimeVenuePhotoReader } from "../../venuePhotoCatalog.js";
import { createRuntimeVenuePhotoReader } from "../../runtimeVenuePhotoReader.js";

function send(message) {
  return new Promise((resolve, reject) => {
    if (!process.connected || typeof process.send !== "function") { reject(new Error("IPC unavailable")); return; }
    process.send(message, error => error ? reject(error) : resolve());
  });
}

async function respond(payload) {
  let database, unregister;
  try {
    const input = normalizedSitemapProcessInput(payload);
    database = openSitemapReadDatabase(input.databasePath);
    unregister = registerRuntimeVenuePhotoReader(createRuntimeVenuePhotoReader(database, { env: input.env }));
    // A bounded read transaction gives every document one consistent view;
    // WAL-mode application writers can continue on the parent connection.
    database.exec("BEGIN");
    const snapshot = createSitemapSnapshot({ database, env: input.env, now: input.now });
    database.exec("ROLLBACK");
    unregister();
    unregister = null;
    database.close();
    database = null;
    const complete = { type: "complete", generatedAt: snapshot.generatedAt, paths: snapshot.paths, stats: snapshot.stats };
    const metadataBytes = Buffer.byteLength(JSON.stringify(complete), "utf8");
    if (metadataBytes > SITEMAP_PROCESS_LIMITS.metadataBytes) throw new Error("Sitemap metadata limit");
    let bytes = metadataBytes;
    // Await each IPC callback so output cannot become an unbounded send queue.
    for (const path of ["/sitemap.xml", ...snapshot.paths]) {
      const xml = snapshot.xmlFor(path);
      bytes += sitemapDocumentBytes(path, xml);
      if (bytes > SITEMAP_PROCESS_LIMITS.outputBytes) throw new Error("Sitemap output limit");
      await send({ type: "document", path, xml });
    }
    await send(complete);
  } catch {
    // Never return database paths, query values or exception details over IPC.
    process.exitCode = 1;
  } finally {
    unregister?.();
    if (database) {
      try { database.close(); }
      catch { /* architecture: allow-empty-catch -- child termination is the final read-connection cleanup boundary. */ }
    }
    if (process.connected) process.disconnect();
  }
}

process.once("message", payload => { void respond(payload); });
process.once("disconnect", () => process.exit(process.exitCode || 0));
