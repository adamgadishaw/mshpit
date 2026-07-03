# Security & launch readiness — mshpit.com

Honest assessment for going public. Split into **what's handled in the app** and
**what MUST exist server-side before a real public launch**. Read the second list
as blocking.

## ✅ Handled at the app layer
- **Input guarding.** Every user text field is sanitized + length-capped at the
  store boundary (`src/lib/validate.js`): control/zero-width/bidi chars stripped,
  emails/handles/passwords validated, ratings clamped. Applies to auth, profile,
  posts, reviews, messages, fan clubs, reports.
- **No XSS sink.** The UI is React Native views, not HTML — there is no
  `innerHTML`/`dangerouslySetInnerHTML`. The only injected web CSS
  (`webInputFix.js`) is static.
- **No secrets in the client.** Spotify keys live only in `.env` (gitignored) and
  are used by build-time scripts. The shipped bundle + `catalog.generated.json`
  contain no API keys (verified). Runtime never calls a keyed API.
- **Outbound links** are built with `encodeURIComponent` or from catalog data,
  never raw user text.
- **Crash recovery.** A top-level `ErrorBoundary` catches render crashes and
  offers Retry / Reload / Reset-app-data, so a crash (or a bad persisted theme)
  is never a dead white screen the user can't escape.
- **Takedown path** for images (`removePhoto`) is wired for copyright requests.

## ⛔ Blocking — requires a backend before public launch
The app is currently **backendless**: auth, users, and content live in memory +
`localStorage`. That is fine for a demo and **not safe for a public site**. None
of the following can be fixed in the client alone.

1. **Real authentication.** Today "login" is a client-side compare and the session
   is a plain object in `localStorage`. Needed: a server with **hashed passwords
   (bcrypt/argon2)**, signed session tokens (httpOnly, secure, SameSite cookies),
   and server-side authorization on every action. Until then, roles (admin/artist)
   are trivially forgeable.
2. **Remove seeded credentials from the bundle.** `src/store.js` ships demo
   accounts *including the owner admin* (`adamgadishaw@gmail.com` / `admin1234`)
   and the Auth screen prints demo logins. Anyone can read these from the JS
   bundle and log in as admin. **Delete all seeded accounts + the demo-login panel
   before launch**; create the real admin only in the backend.
3. **Stop persisting credentials client-side.** `localStorage` currently holds the
   users list with plaintext passwords. With server sessions this goes away
   (client stores a token, never passwords).
4. **Transport + headers.** Serve only over **HTTPS**, add **HSTS**, a strict
   **Content-Security-Policy** (the app hotlinks images from many hosts + wsrv.nl
   — scope `img-src` accordingly), `X-Content-Type-Options: nosniff`,
   `Referrer-Policy`, and frame-ancestors to prevent clickjacking.
5. **Rate limiting + abuse controls** on signup, login, posting, messaging, and
   reports (server-side). Add CAPTCHA on signup/login.
6. **Moderation at write time** for a public feed (today it's reactive/per-report).
   At minimum: server-side profanity/spam checks + the ability to hard-delete.
7. **Privacy/compliance.** A real privacy policy + terms (the in-app pages are
   placeholders), cookie/consent handling, a data-export/delete path (GDPR/CCPA),
   and image licensing review (the web/Bing photo tier is takedown-on-request, not
   pre-cleared — fine for a prototype, risky at scale).
8. **Secret management.** Keys in a server secret store / CI env, not a local
   `.env`. Rotate the Spotify secret before launch (it was shared in chat).

## Recommended path
The `localStorage` store (`src/store.js`) is the seam. Replace it with a backend
(Postgres or the SQLite→server plan already discussed) exposing the same
`useStore()` shape, move auth to server sessions, delete the seed accounts, and
put it behind HTTPS with the headers above. That converts this from "safe demo"
to "safe to launch."

> Bottom line: the client is clean and hardened for what a client can do, but a
> public mshpit.com is **not secure until the backend exists**. Items 1–4 are the
> minimum bar.
