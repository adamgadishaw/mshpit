# Launching mshpit.com

The stack is intentionally simple to run: **one Node process** serves both the
API and the built web app from the same origin. No packages to install on the
server (the backend is dependency-free), one SQLite file as the database.

## 0. What you need
- The domain **mshpit.com** (you have it)
- A small server. Any of:
  - **Render / Railway / Fly.io** (easiest — git push, they run Node + TLS for you)
  - a $5–10 VPS (Hetzner/DigitalOcean) if you want full control
- Node 22+ on the host (24 recommended — matches dev)

## 1. Build the web app
```bash
npm run build:web        # = npx expo export -p web  → writes dist/
```

## 2. Run the server
```bash
NODE_ENV=production PORT=3000 ADMIN_PASSWORD='<pick-a-strong-one>' npm run server
```
- Serves `dist/` (the app) **and** `/api/*` (auth, posts, likes, comments,
  follows, fan clubs, reports, admin) on one origin.
- First boot creates the database at `server/data/pit.db` and seeds **your admin
  account** (`ADMIN_EMAIL`, default adamgadishaw@gmail.com) with `ADMIN_PASSWORD`.
  If you don't set a password it generates one and prints it **once**.
- Back up = copy `server/data/pit.db`. That's the whole database.

## 3. Put TLS in front (HTTPS)
**PaaS route (recommended):** Render/Railway/Fly give you HTTPS automatically —
just set the env vars above in their dashboard and point DNS.

**VPS route:** run [Caddy](https://caddyserver.com) in front (auto-Let's Encrypt):
```
# /etc/caddy/Caddyfile
mshpit.com {
    reverse_proxy localhost:3000
}
```
The app already sends HSTS + security headers in production mode; cookies flip
to `Secure` automatically when `NODE_ENV=production`.

## 4. Point the domain
At your registrar, set mshpit.com's **A record** to the server IP (VPS) or add
the **CNAME** your PaaS gives you. Add `www` → same target. Wait for DNS (~min).

## 5. Pre-flight checklist (do these, in order)
- [ ] `ADMIN_PASSWORD` set to something strong; the old `admin1234` is dead —
      admin no longer ships in the client bundle at all
- [ ] **Rotate the Spotify client secret** (dashboard → your app → rotate) and
      update `.env` — the old one was shared in chat
- [ ] `NODE_ENV=production` (enables HSTS + Secure cookies)
- [ ] HTTPS confirmed (padlock on mshpit.com)
- [ ] Sign up a test account, post, like, comment — then delete it via admin
- [ ] Keep `server/data/` on a persistent disk (PaaS: mount a volume)

## 6. Keeping the catalog fresh in production
The scraper pipeline (`npm run pipeline`) runs on your **dev machine**, not the
server — it writes `src/seed/catalog.generated.json`, which ships inside the web
build. To refresh production content: let the pipeline run, then
`npm run build:web` and redeploy. (Post-launch upgrade: move the catalog into
the server DB so it updates without redeploys.)

## What the backend gives you (recap)
- scrypt-hashed passwords, httpOnly session cookies (hashed at rest, 30-day TTL)
- rate limits on every sensitive route + a global flood guard
- validation on every field, size-capped bodies, path-traversal-proof static serving
- security headers (CSP, HSTS, nosniff, frame-ancestors)
- per-request error isolation — one bad request can never take the site down
- graceful shutdown + WAL-mode SQLite (crash-safe writes)

## Known limits at launch (fine to ship, fix as you grow)
- Feed/social writes from the *client app* still use local state for some
  features (posts/likes/comments have server routes wired; DMs/lounges next).
- Single process + SQLite comfortably handles thousands of users; when you
  outgrow it, the seam is `server/db.js` → Postgres.
- No email verification / password reset yet — add before wide marketing.
