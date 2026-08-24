#!/usr/bin/env node

// Retired intentionally. The old job placed a GitHub credential in a command
// argument, where host process inspection and command-error reporting could
// expose it. Tour-date refresh now runs inside the application and never writes
// generated data back to Git. Keep this tombstone so a forgotten Render cron or
// an operator following old notes fails closed instead of reviving the hazard.
console.error("[cron] retired: catalog refresh is in-process; no Git push is permitted.");
process.exitCode = 1;
