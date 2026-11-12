# Local mobile test connectivity

The development app needs two separate local processes: Metro supplies screen code, and the local API supplies users/data. A stopped Metro can show “Could not load bundle”; a stopped API produces connectivity failures. Neither means the production Render service failed.

## Repeatable local account tests

Run `npm run mobile:backend:persistent` in one terminal and `npm run mobile:start` in another, from this checkout with Node 24. Leave both running while using the development simulator app.

The persistent command stores synthetic users/data in `.tmp/mobile-preview-data`. It preserves those records across restarts, never accepts an arbitrary data-directory override, rejects redirected storage, strips inherited credentials, blocks outbound traffic, and listens only on `127.0.0.1:3000`. It does not copy or connect to production accounts. Do not use real passwords or private user data here.

`npm run mobile:backend` remains the disposable smoke workflow: a fresh database on every start. Existing disposable data is not migrated or deleted by the persistent workflow. Stop an existing local backend before starting another on port 3000; never kill an unidentified process merely because the port is occupied.

## Simulator versus physical iPhone

A physical iPhone's localhost is the phone, not the Mac. The loopback-only test server intentionally cannot serve it. A physical install needs a deliberately selected reachable backend and device signing. Do not expose this test server on the LAN or silently switch a test build to production.

An embedded JavaScript bundle removes the Metro dependency, but not the API requirement. Existing native release builds pin the canonical production API; the current generic internal-distribution profile is not an isolated testing environment. Separate preview routing must fail closed and use a separate app identity before a standalone testing build is issued. App Store/TestFlight distribution and creating signing credentials require separate approval.
