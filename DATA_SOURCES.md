# Filling Pit with data — legally

Goal: ship **full, not empty**, without infringing anyone's copyright or
breaching a site's terms. The rule of thumb:

> **Facts are free. Photos are owned.**
> Tour dates, venue names/locations, capacities, and setlists are facts (or
> open-licensed) — source them freely. Concert/artist *photos* are almost always
> copyrighted by the photographer; only use ones that are explicitly licensed.

## What we use (and why it's safe)

| Data | Source | License / basis | Key needed |
|------|--------|-----------------|------------|
| Artist & venue identity, genres | **MusicBrainz** | CC0 (public domain) | none (set a User-Agent, ~1 req/sec) |
| Venue & artist **images** | **Wikimedia Commons** via Wikidata `P18` | CC-BY / CC-BY-SA / PD — **store the author + license and show attribution** | none |
| Gallery backfill **images** | **Openverse** (`api.openverse.org`, `license_type=commercial,modification`) | CC-BY / CC0 etc. — **store creator + license + source** | none |
| **Setlists** | **Setlist.fm API** | CC-BY-SA; attribute | `SETLISTFM_KEY` |
| **Tour dates + ticket links** | **Ticketmaster Discovery API** | official API; the ticket URL is affiliate-ready | `TICKETMASTER_KEY` |
| 30s song previews | Spotify / Apple Music APIs | licensed previews (never self-host clips) | provider key |
| Gallery **backfill** (licensed) | **Openverse** | CC commercial+modifiable; creator/license stored | none |
| Gallery **backfill** (last resort) | **Google Images** | ⚠️ not license-cleared — **takedown-on-request** | optional CSE key |

## Photo gallery fill order

Artist and venue galleries self-heal through a tiered pool (`galleryPool`), built
by `scripts/enrich-photos.mjs` and `scripts/enrich-venue-photos.mjs`. Fan-uploaded
photos lead on-site; the backfill pool fills the rest in this order:

1. **Wikimedia Commons** — fully attributed.
2. **Openverse** — CC-licensed, attributed.
3. **Google Images** (`source:"google"`) — **only when 1 + 2 can't fill the
   pool.** These are **not** license-cleared. We use them under a deliberate
   **takedown-on-request** policy: each is tagged `source:"google"` and can be
   pulled instantly via the store's `removePhoto` (a rights-holder request, or a
   moderator). When a photo is pulled, the gallery refills from the next available
   image in the pool, so a page never falls back to a blank card. Prefer the
   **Google Programmable Search JSON API** (`GOOGLE_CSE_KEY` + `GOOGLE_CSE_CX`)
   over best-effort HTML parsing.

> **Why this is a deliberate exception.** The licensed tiers are thin for smaller
> artists and most venues (321 of 428 venues shipped with no photo), which left
> galleries blank. The product decision is to fill them from the open web and
> honor takedowns reactively rather than ship empty. Keep the takedown path
> (`removePhoto`) working — it is the compliance mechanism, not an afterthought.

## What we still DON'T do

- **No HTML scraping** of Ticketmaster, Songkick, Bandsintown, Instagram, etc.
  for *facts* — their official APIs return the same data, legally, without the
  ToS/blocking risk.
- **No copying editorial bios** verbatim (copyrighted). Link out, or use the
  short CC-licensed Wikidata/Wikipedia extract with attribution.

## Running it

```bash
# facts only (MusicBrainz + Commons images) — no keys required:
node scripts/ingest.mjs "Turnstile" "IDLES" "Mitski" "Khruangbin"

# add setlists + tour dates:
SETLISTFM_KEY=xxx TICKETMASTER_KEY=yyy node scripts/ingest.mjs "Turnstile" "IDLES"
```

It writes `src/seed/catalog.generated.json` (`artists`, `venues`, `shows`,
`tourDates`, each image carrying `photoCredit`). Merge that into
`src/seed/catalog.js`. The UI already falls back to a drawn banner when `photo`
is null, so it never looks empty before/while ingesting.

## Attribution

Commons images are mostly CC-BY/BY-SA, which **requires** crediting the author
and license. The ingest stores this in `photoCredit`; surface it on the venue/
artist page (small caption) so you stay compliant.
