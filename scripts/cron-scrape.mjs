#!/usr/bin/env node

// Retired intentionally. The old job placed a GitHub credential in a command
// argument, where host process inspection and command-error reporting could
// expose it. Tour-date refresh now runs inside the application and never writes
// generated data back to Git. A stale Render schedule may still call this file:
// explicitly skip it without sending false failure alerts for an obsolete job.
// This does not run, or report success for, the live in-process scraper.
console.log(JSON.stringify({
  code: "RETIRED_CATALOG_CRON",
  status: "skipped",
  job: "pit-catalog-refresh",
  message: "This retired job did not refresh the catalog. Tour dates now refresh inside the web service.",
  action: "Disable the old pit-catalog-refresh Cron Job in Render. Check the mshpit web-service logs for scheduled tour-date refresh results.",
  dataChanged: false,
}));
process.exitCode = 0;
