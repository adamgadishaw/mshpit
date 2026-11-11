# Website companion for targeted message reads

Based on backend `b535ba42cf246fc6e69d534902f0955a1008db43`. This focused port makes the existing website compatible with its strict message-target endpoint without importing the broader native app changes. The prior website marked a thread read on open or on a new cached inbound message and calculated unread from its partial cache. The companion measures the visible inbound row, submits its message ID to `/read-through`, and preserves the server's full-history unread total and boundary.

The viewport controller/hook and target transport come from validated app `bae78695ce9e0e5eae1deddd5ce171b700261c3c`. The existing website ThreadScreen, scroll behavior, composer, message actions and styling remain in place. Route/covering-overlay, page visibility, account epoch and block checks fence both measured observations and queued completions. Failed receipts keep their target for bounded recovery or successful manual refresh, without optimistic read clearing.

The older Store now adopts authoritative counts at startup, Inbox refresh and thread reads using shared request issue order. This prevents older snapshots and partial pages from replacing a newer full total. A durable accepted request remains in the main inbox even if its outgoing history was removed; unconfirmed/failed outgoing messages do not constitute acceptance. Account ownership is rechecked when React applies private state updates, including A–B–A transitions.

No server runtime, schema, production configuration, package or native project changes are included in this companion. The b535ba4 backend and its consent migration remain unchanged. The signed native build 4 from bae7869 does not require rebuilding for this website-only release.

Focused evidence before the final gate: 108 domain/component/actual-backend acceptance checks plus four stale-state/ownership cases passed. `scripts/verify-message-read-browser.mjs` runs the actual exported website with synthetic intercepted APIs and an isolated browser profile at 1280px and 390px. It verifies full unread counts, actual DOM measurements, an unfetched arrival surviving a read and reload, and old-backend 404 without a blanket-read fallback. It blocks external requests and never uses a user account or production API. The browser fixtures are separate from the SQLite/API acceptance tests; no production interaction is implied.

Run the browser fixture after the website export with an explicitly installed official Playwright module and browser executable:

```sh
PIT_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core \
PIT_BROWSER_EXECUTABLE=/absolute/path/to/browser \
node scripts/verify-message-read-browser.mjs
```

Release the website and compatible backend together as one reviewed artifact. Existing open older tabs still need to reload, and older native apps need updating. An old backend returns 404 to the new client; an old client sends no target and receives 400 from the new backend. Both preserve unread state rather than silently acknowledging unseen messages. This is a coordinated cutover, not seamless old-client compatibility. The existing pending publication approval does not authorize this additional commit; no push, merge, deployment, production setting change or phone installation is part of this work.
