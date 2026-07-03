# Real venue maps (themed dark snapshots)

Every venue/concert page shows a map. With no key it's the drawn fallback; add
**one** key and every map becomes a real dark street snapshot, themed to match
Pit — automatically, for every venue, no per-venue work.

## Enable (pick one)

**Google Static Maps** — comes pre-styled to the Pit palette (warm dark land,
cool water, amber highways). This is the "Google snapshot that matches the theme."

```
# .env
EXPO_PUBLIC_GOOGLE_MAPS_KEY=AIzaSy...
```
Get a key: Google Cloud Console → enable **Maps Static API** → create an API key.
Free monthly credit covers a lot; restrict the key to the Static Maps API.

**Mapbox** — uses the `dark-v11` style (swap for a custom Studio style for an
exact palette match).

```
# .env
EXPO_PUBLIC_MAPBOX_TOKEN=pk.eyJ...
```
Get a token: mapbox.com → Account → Tokens.

Then restart with a cleared cache so the key gets inlined:
```
npx expo start -c
```
(Metro caches the transformed code, so a plain restart won't pick up a new
`EXPO_PUBLIC_*` value — use `-c` / `--clear` the first time.) Google wins if both
keys are set.

## How it works

- `src/mapConfig.js` builds the static-image URL (Google styled, or Mapbox).
- `src/lib/mapProject.js` `pixelProjector` computes the center + zoom that frames
  the venues and projects each pin to a pixel position — so the interactive blue
  venue pins line up exactly on the real map image.
- `src/components/ConcertMap.jsx` renders the image + the pin overlay (hover/tap a
  blue pin → that venue's page). No key → `CityMap` drawn fallback, same pins.

No tile hosting, no scraping — just the official Static Maps APIs.
