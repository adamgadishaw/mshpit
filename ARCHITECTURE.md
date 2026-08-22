# PIT architecture contract

This is the executable contract for new PIT code. It describes the direction of travel, not a claim that every legacy file already complies. `npm run check:architecture` preserves the current exceptions as a reviewed ratchet: unrecorded debt fails CI, and removed debt makes the baseline stale until the same change shrinks it.

## Canonical vocabulary

- **Account** is the authenticated identity used for sessions, authorization, ownership, privacy, persistence scope, and cache scope. New domain code uses `accountId`.
- **Profile** is the public or staff-authorized projection of an account. A profile is not authentication state and must not be used as authority.
- **Member** is the human-facing community/admin term for a person using PIT. Use it in product copy and directory projections, not persistence keys.
- **User** is legacy compatibility vocabulary in existing database tables, `/api/users` routes, and old projections. Do not introduce new domain types, state, or services named `user` when `account`, `profile`, or `member` is the intended concept.
- **Viewer** or **actor** is the account performing a read or command. **Artist** is a catalog entity; an artist-role account may own its profile, but the two identities are not interchangeable.

## Dependency direction and feature boundaries

New product systems are vertical slices under `src/features/<feature>/` and, when server work is required, `server/features/<feature>/`. A slice owns its state, network/service boundary, domain policy, tests, and UI. Do not add feature state to `src/store.js` or inline route handlers to `server/api.js`.

Dependencies point inward:

```text
screen / feature UI -> feature state or service -> shared adapters -> pure domain
server route -> application service -> repository -> database/provider
```

The enforceable rules are:

- `src/domain` is platform-neutral and may import only other domain modules. It does not import React, React Native, storage, networking, UI, or the server.
- `src/lib` contains shared adapters and hooks. It may depend on domain code, but not screens, components, feature slices, or the legacy Store.
- `src/components` is shared UI. It may depend on `src/lib` and `src/domain`, but not screens, feature slices, or the legacy Store.
- A feature may use shared components, adapters, and domain code. It must not reach into another feature's internals; expose a deliberately small public API instead.
- Client code never imports `server`. Server code may share only platform-neutral `src/domain` modules with the client.
- Expo 56's global `fetch` and `expo/fetch` are transport primitives, not UI APIs. Raw fetch belongs in a named `src/lib` adapter. Only shared adapters and non-JSX feature modules named `*Api`/`*Service` (or placed under `services/`) may call PIT's `api()` adapter; screens, components, feature UI, and state modules consume those services.
- `GET` and `HEAD` handlers are read-only. Cache warming, quota reservation, reconciliation writes, and provider searches that consume actor budget use an explicit command endpoint.
- JSX component and screen files use `PascalCase`; domain, adapter, and server modules use `lowerCamelCase`. Existing names recorded in the baseline are compatibility debt, not examples.

Canonical cross-cutting policy modules are deliberately small and should be
extended instead of cloned:

- `src/domain/validation.mjs` owns shared text, identity, field-limit, and rating normalization.
- `src/domain/trackIdentity.mjs` owns recording, queue-occurrence, and resolver identity.
- `src/domain/badges.mjs` owns built-in badge and points-tier policy shared with the server.
- `src/domain/scopedReadCoordinator.mjs` owns latest-request and reset-epoch coordination; account/staff wrappers supply the scope policy.
- `server/databaseTransaction.js` owns nested-safe synchronous SQLite write transactions.

## State and command contracts

Feature reads use one resource shape:

```js
{
  scope, // a stable key containing accountId and target for viewer-dependent data
  status: "idle" | "loading" | "refreshing" | "ready" | "error",
  data,
  error, // null or AppError
  updatedAt,
}
```

Construct and transition that shape through `src/domain/loadState.mjs`. Construct expected command outcomes through `src/domain/commandResult.mjs`; feature code should not invent parallel shapes.

- `loading` has no adopted data; `refreshing` may retain already-authorized data for the same scope.
- A scope change clears or replaces viewer-dependent data synchronously, before starting the next request. Effects are too late for privacy boundaries.
- Read services resolve with data or throw `AppError`. Caller-initiated cancellation is control flow: detect it with `isLoadCancellation(error, signal)` and leave resource state untouched. Reads do not use `null`, `false`, `[]`, or `{ ok: false }` as ambiguous transport failures.
- Expected command outcomes use exactly `{ ok: true, value }` or `{ ok: false, error: AppError }`. Server handlers throw catalogued `ApiError`; they never return an error-shaped success response.
- The canonical helper modules expose a reviewed, exact runtime API. Do not redefine their helper names, add speculative exports, or construct lookalike LoadState/CommandResult objects in client domain, adapter, or feature code.
- A mutable entity declares one ordering policy: desired-state plus idempotency, serialization, or latest-wins. Rollback is allowed only while the failed operation still owns the entity.
- User-visible writes cannot disappear into an empty catch. Handle, surface, or capture the error. Truly optional cleanup may use `architecture: allow-empty-catch -- <specific reason>` beside the catch.
- An async catch must not convert failure into `null`, `false`, or `[]`. At a genuinely optional compatibility boundary, explain the fallback locally with `architecture: allow-ambiguous-result -- <specific reason>` and make the caller's interpretation explicit.

## Account scope and cache policy

Every viewer-dependent key contains the account scope: at minimum `accountId` plus the target identity. Guest is an explicit scope, never an omitted account. Each account-scoped feature has an `A -> B -> guest` test proving that data, errors, pending writes, and optimistic state cannot cross the transition.

Every cache documents, next to its implementation:

1. owner and data classification;
2. complete key, including account/role when viewer-dependent;
3. TTL and stale-data behavior;
4. entry or byte limit and eviction policy;
5. in-flight deduplication and cancellation policy;
6. persistence location, if any, and synchronous scope-reset behavior.

An unbounded object, map, array, or persisted collection is not a cache policy.

## Naming verbs

- `fetchX` performs network/provider I/O and does not adopt UI state.
- `loadX` coordinates a read and adopts its resource state.
- `selectX` is a pure projection.
- `resolveX` chooses an identity, provider, or policy outcome.
- `reconcileX` merges local and authoritative state.
- `createX`, `updateX`, `deleteX`, and `setX` are explicit commands. Prefer desired-state commands over ambiguous `toggleX` mutations.
- `isX`, `hasX`, `canX`, and `shouldX` return booleans.

## Errors and diagnostics

`server/errors.js` owns stable server codes, status, and retryability; each `ApiError` call site supplies bounded public-safe context. `src/lib/errorCatalog.mjs` owns client presentation mappings. `ApiError` and `AppError` cross their respective boundaries; raw provider, database, token, email, and stack details do not. Error-contract tests must prove every emitted server code is catalogued and every server code has an intentional client mapping.

An error is either handled locally, represented in `LoadState`, returned as a command failure, or captured once at an application boundary. Logging and then rethrowing without adding boundary context creates duplicate diagnostics.

## Background work

Durable jobs persist authorization and progress before asynchronous delivery.
A scheduler only resumes records whose stored state explicitly permits work; it
never turns paused or failed work back on. Every worker has a bounded batch,
lease/claim ownership where delivery can outlive a tick, single-flight or
coalescing semantics, observable failure handling, and a shutdown hook that
stops new ticks and awaits in-flight work before the database closes. Manual
admin actions and automatic recovery must share the same lower-level
serialization and idempotency contract rather than implementing parallel paths.

## The legacy ratchet

`scripts/architecture-baseline.json` records only pre-existing exceptions:

- the exact state-binding identities, all hook names/counts, and ceilings in `src/store.js`;
- the exact inline route keys and ceiling in `server/api.js`;
- existing upward imports and non-canonical file names;
- exact direct-API call signatures in legacy UI/Store consumers;
- exact legacy client result-shape and ambiguous-async-fallback signatures;
- exact per-file signatures for unexplained empty catches, including the root `App.js`/`index.js` runtime entrypoints;
- canonical exports that are intentionally dormant while feature slices adopt the contract.

The checker deliberately fails when recorded debt disappears until the baseline shrinks in the same change; that is what prevents it from returning later under a stale allowance. `node scripts/check-architecture.mjs --print-baseline` prints a shrink-only candidate and refuses to bless any non-stale violation. The dependency-free checker uses structural text matching rather than a JavaScript AST, and exact signatures include normalized source, so a harmless formatter or adjacent edit can require a small, reviewed signature refresh. The baseline cannot redirect the monolith gates away from `src/store.js` or `server/api.js`, and its totals must agree with its named allowances. Adding an exception requires an architecture decision explaining why the boundary cannot be honored, an owner, and a removal condition. Feature delivery by itself is not an exception.

Run `npm run check:architecture` while developing and `npm run check` before merging.
