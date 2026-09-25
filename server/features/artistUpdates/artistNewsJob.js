import { backgroundJobEnabled } from "../../backgroundJobs.js";
import { readCatalogKnowledgeControl } from "../../catalogKnowledgeControl.js";
import { privateErrorLabel } from "../../errors.js";
import { startPeriodicJob } from "../../periodicJobScheduler.js";
import { checkArtistReleases, ensureArtistUpdatesSchema, notifyFollowers, scanNewTourDates } from "./artistUpdatesService.js";

const MINUTE = 60_000;

// One pass: new public tour dates (a local query), then up to `releaseChecks`
// artists' Deezer release lists, then a note to each followed artist's fans.
export async function runArtistNewsPass({ database, env = process.env, now = Date.now, fetchJson, notify, newId, signal, releaseChecks = 30 }) {
  if (readCatalogKnowledgeControl(database, { env, at: now() })?.mode === "paused") return { stopped: "paused", shows: 0, releases: 0, notified: 0 };
  const shows = scanNewTourDates(database, { now: now(), newId });
  const releases = await checkArtistReleases(database, { now: now(), fetchJson, newId, limit: releaseChecks, signal });
  let notified = 0;
  for (const update of [...shows.created, ...releases.created]) notified += notifyFollowers(database, update, { notify, now: now() });
  return { stopped: null, baseline: shows.baseline, shows: shows.created.length, releases: releases.created.length, checked: releases.checked, notified };
}

export function startArtistNewsScheduler({ database, env = process.env, now = Date.now, fetchJson, notify, newId }) {
  ensureArtistUpdatesSchema(database);
  if (!backgroundJobEnabled(env, "ARTIST_NEWS_ENABLED")) return null;
  return startPeriodicJob({
    initialDelayMs: 5 * MINUTE,
    intervalMs: 15 * MINUTE,
    run: async ({ signal }) => {
      const result = await runArtistNewsPass({ database, env, now, fetchJson, notify, newId, signal });
      if (result.baseline || result.shows || result.releases || result.notified) {
        console.log(`[artist-news] baseline=${result.baseline || 0} shows=${result.shows} releases=${result.releases} checked=${result.checked} notified=${result.notified}`);
      }
      return true;
    },
    report: (error) => console.error(`[artist-news] pass failed safely: ${privateErrorLabel(error)}`),
  });
}
