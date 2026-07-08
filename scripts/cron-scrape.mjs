#!/usr/bin/env node
/**
 * The durable, hosted scraper — what a Render Cron Job runs on a schedule.
 *
 *   1. run ONE pipeline cycle (roster growth + Spotify enrichment + Ticketmaster
 *      tour dates), reading creds from the cron service's env vars (NOT .env,
 *      which is gitignored and absent in prod).
 *   2. if the bundled catalog changed, commit it and push to master — which
 *      trips the web service's autoDeploy, shipping the fresh data live with no
 *      human in the loop.
 *
 * Env (set on the Render cron service, sync:false): SPOTIFY_CLIENT_ID,
 * SPOTIFY_CLIENT_SECRET, TICKETMASTER_KEY, GITHUB_TOKEN (a fine-grained PAT with
 * Contents: read/write on the repo).
 */
import { execSync } from "node:child_process";

const sh = (cmd, opts = {}) => execSync(cmd, { stdio: "inherit", ...opts });
const out = (cmd) => execSync(cmd).toString().trim();
const CATALOG = "src/seed/catalog.generated.json";
const REPO = process.env.PIT_REPO || "adamgadishaw/mshpit";

// 1. one scrape cycle (env comes from the Render service)
sh("node scripts/pipeline.mjs --once");

// 2. ship it only if something actually changed
const changed = out(`git status --porcelain -- ${CATALOG}`);
if (!changed) {
  console.log("[cron] catalog unchanged — nothing to deploy.");
  process.exit(0);
}

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("[cron] catalog changed but GITHUB_TOKEN is not set — cannot push. Set it on the cron service.");
  process.exit(1);
}

sh('git config user.email "bot@mshpit.com"');
sh('git config user.name "pit catalog bot"');
sh(`git add ${CATALOG}`);
sh('git commit -m "chore(catalog): scheduled Spotify + Ticketmaster refresh"');
// Push over HTTPS with the token; HEAD:master trips the web service autoDeploy.
sh(`git push "https://x-access-token:${token}@github.com/${REPO}.git" HEAD:master`);
console.log("[cron] pushed refreshed catalog — the web service will auto-redeploy with it.");
