# Pit — product brief

## One line

A "Letterboxd for concerts," but social-first: log the shows you go to, rate and
review them, post photos/clips, and follow people whose taste matches yours so
you discover which bands are actually worth seeing live.

## Who it's for

- People deciding whether a band is worth a ticket — answered by people they
  trust, not a star average from strangers.
- People who want to keep a diary of every show they've been to (and get a
  Spotify-Wrapped-style recap of their year in concerts).

## The competitive landscape (be honest about it)

The space isn't empty. **Concert Archives** already logs shows by band/date/venue
with photos, setlists, friends, and stats. **Encore** scans your Gmail
(Ticketmaster/AXS/Eventbrite/StubHub confirmations) to auto-reconstruct your
concert history. **Setlist.fm** owns crowdsourced setlist data via an API.

The wedge isn't the feature checklist — it's **community density + social
discovery**: taste-matched recommendations, spoiler-tagged setlist culture, and a
richer rating model. We win a niche scene first (one city or one genre), then go
wide — the way Letterboxd was film-Twitter before it was everyone.

## The data spine (the whole ballgame)

A concert is messy — same tour plays 50 cities, festivals have 40 acts. So two
levels:

- **Performance** = one artist + one venue + one date. The thing people rate and
  review, because everything valuable is night-specific (this setlist, this
  crowd, whether the room sounded good).
- **Artist** (and Tour) sits above it, so individual nights roll up into "how
  good is this band live, generally" — which is what someone deciding on a ticket
  actually wants.

Don't make users type shows in from scratch — that's how these apps die. Seed
from **Setlist.fm** (past shows + setlists), **Bandsintown/Songkick/Ticketmaster**
(events), **MusicBrainz** (canonical artist IDs), and copy Encore's email-import.

## The rating system

Multi-factor, but **one overall score is the only required field** — logging is
one tap. Sub-ratings are optional depth:

- **The band**: performance · setlist · energy
- **The room**: sound · venue · crowd · theatrics

Critically, **the room aggregates to the venue, not the artist** — a bad-sounding
room shouldn't drag down a band's live reputation. Nobody does this split well.

## Setlists + spoilers

Setlist.fm has the data but treats it like a wiki, not a community. Make setlists
**collaborative** (anyone at the show can build/correct in real time) and
**auto-spoiler-tag** anything inside a tour's active window — that's exactly when
people want to peek-or-not before their own show.

## The social loop (the retention engine)

The magic moment: *"3 people whose taste matches yours rated this touring act 5★,
and they're playing near you in March."* Discovery → a ticket you'd never have
bought. This only fires at density — hence the niche-first launch.

## Monetization (realistic order)

1. **Affiliate ticket links** — you literally create purchase intent. Far better
   fit than ads (Ticketmaster/Bandsintown/Dice affiliate programs).
2. **"Year in Concerts" recap** (Wrapped energy) — best growth + paywall feature.
   Advanced stats is an easy membership hook.
3. **Membership perks**: pre-sale alerts for bands you rate highly, no ads,
   full-res media storage, deep stats, badges.
4. **Display ads** only once huge (earn ~nothing on a small social app).
5. **B2B data** later: real sentiment on live performance, attendance, setlist
   trends — valuable to artists/venues/promoters. Not a launch plan.

## Music previews (the "snippets like the App Store" question)

Important: the App Store's song previews are **not fair use** — Apple serves
**licensed** 30-second clips through its API. Self-hosting song snippets and
calling it fair use is not a safe bet for a commercial app; "amount used" is only
one of four fair-use factors and courts weigh commercial use heavily against you.

The safe, standard path is to **embed previews from a provider that already
licenses them**, never host audio yourself:

- **Apple Music API (MusicKit)** — each track exposes a 30s `previews[].url`.
- **Spotify Web API** — track objects carry a 30s `preview_url`.
- **Deezer API** — 30s `preview` MP3 per track.

So a setlist song's play button calls one of these to stream the licensed
preview. In the prototype the button shows a mini "30s preview" player as a
placeholder for that hook. This also doubles as an affiliate/discovery surface
("add to your Spotify/Apple library"). User-uploaded clips *of the actual show*
are a separate matter — those are the user's own recordings and need their own
rights/attestation flow, not a music-licensing API.

## "Best rated near you"

A ranking surface (in Discover). Score = **rating quality × proximity**, where
rating quality is **Bayesian-weighted by review volume** so a 5.0 from a handful
of people doesn't outrank a 4.7 from hundreds, and proximity decays with distance
from a location the user sets. See `rankShows()` in `src/data.js`.

## The honest hard part

**Cold start.** The app is useless until your friends and local scene are on it,
and you're fighting two incumbents. Two ways through: (1) launch narrow — one
city or genre — so the feed feels alive; (2) make it valuable for a *solo* user
day one (a beautiful personal concert diary + stats), so people log before the
social graph fills in. That's how Letterboxd grew.

## Screens (prototype scope)

- **Feed** — concert logs as tear-off ticket stubs; spoiler setlist tap-to-reveal.
- **Show / Performance page** — community score, band/room breakdown, top review,
  full setlist.
- **Discover** — taste-match recs + "coming near you."
- **You** — concert diary grid, stats, the "Year in Concerts" recap.
- **Log flow** (+ button) — pick show → overall rating (required) → optional
  band/room breakdown + review → post. Must feel <30 seconds.

## Design signature

Not "dark + one neon." Grounded in the real materials of a live show: deep
blue-black darkened venue, warm tungsten amber bleeding toward magenta stage-gel,
logs styled as **tear-off ticket stubs** (perforated edge, mono type like
ticket-stub printing). Amber = "the band," cool blue = "the room," gold = stars.
