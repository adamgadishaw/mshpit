import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { spotifyArtistPhotoModel } from "./spotifyArtistPhoto.mjs";

const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const artist = readFileSync(new URL("../screens/ArtistScreen.jsx", import.meta.url), "utf8");
const gallery = readFileSync(new URL("../screens/ArtistGalleryScreen.jsx", import.meta.url), "utf8");
const carousel = readFileSync(new URL("../components/ArtistCinematicCarousel.jsx", import.meta.url), "utf8");
const spotifyPhoto = readFileSync(new URL("../components/SpotifyArtistPhoto.jsx", import.meta.url), "utf8");
const spotifyLogo = readFileSync(new URL("../components/SpotifyFullLogo.jsx", import.meta.url), "utf8");
const icon = readFileSync(new URL("../components/Icon.jsx", import.meta.url), "utf8");

test("artist cinematic and gallery modules remain parseable", () => {
  for (const [name, source] of Object.entries({ app, artist, gallery, carousel, spotifyPhoto, spotifyLogo })) {
    assert.doesNotThrow(() => parse(source, { sourceType: "module", plugins: ["jsx"] }), `${name} must parse`);
  }
});

test("Spotify artist imagery is fixed-host, unaltered, attributed, and limited to the artist page", () => {
  const model = spotifyArtistPhotoModel({
    spotifyPhoto: "https://i.scdn.co/image/trusted123",
    spotifyArtistUrl: "https://open.spotify.com/artist/1234567890ABCDEFGHIJKL",
    photoSource: "spotify",
    photoCredit: "Spotify",
    photoDisplayPolicy: "original",
  });
  assert.equal(model?.credit, "Spotify");
  assert.equal(spotifyArtistPhotoModel({
    ...model,
    spotifyPhoto: "https://attacker.example/photo.jpg",
    spotifyArtistUrl: model?.sourceUrl,
    photoSource: "spotify",
    photoCredit: "Spotify",
    photoDisplayPolicy: "original",
  }), null);
  assert.match(spotifyPhoto, /<Image/);
  assert.match(spotifyPhoto, /resizeMode="contain"/);
  assert.match(spotifyPhoto, /borderRadius:\s*4/);
  assert.doesNotMatch(spotifyPhoto, /borderRadius:\s*radius\.lg/);
  assert.match(spotifyPhoto, />SOURCE</);
  assert.match(spotifyPhoto, /<SpotifyFullLogo width=\{70\}/);
  assert.match(spotifyPhoto, /minHeight:\s*34/);
  assert.match(spotifyPhoto, /justifyContent:\s*"space-between"/);
  assert.doesNotMatch(spotifyPhoto, />OPEN SPOTIFY</);
  assert.match(spotifyPhoto, /useEffect\(\(\) => \{\s*setFailed\(false\);\s*\}, \[photo\?\.uri\]\)/);
  assert.doesNotMatch(spotifyPhoto, /SmartImage|proxied\(/);
  assert.match(spotifyLogo, /viewBox="0 0 823\.46 225\.25"/);
  assert.match(spotifyLogo, /Math\.max\(70,/);
  const logoPaths = [...spotifyLogo.matchAll(/<Path fill="#fff" d="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(logoPaths.map((path) => ({
    length: path.length,
    sha256: createHash("sha256").update(path).digest("hex"),
  })), [
    { length: 1040, sha256: "bec4de8cd1bbd5193ac867d70a0878b25fd17a3d664d3a9aa7f6a21511a308e4" },
    { length: 2280, sha256: "ba54b42eb72388b93b2783a8db6996ccf4f2bc18cb13fa730ecc326085086f93" },
    { length: 634, sha256: "59b9c10559b28ee9081f33f979deabf9c801461252a1a64be3b734b76e1738be" },
    { length: 273, sha256: "4c8576b51c00d4acc339412334173e106471534cc3f63fd10bcb4d6f1c565355" },
  ], "the supplied full-white Spotify logo remains byte-exact");
  assert.doesNotMatch(spotifyLogo, /stroke=|fill=\{color\}/);
  assert.match(spotifyPhoto, /backgroundColor: "#07090D"/);
  assert.match(spotifyPhoto, /creditText:\s*\{\s*color: colors\.textFaint/);
  assert.doesNotMatch(icon, /case "spotify":/,
    "generic icons must not imitate Spotify's supplied mark");
  assert.match(artist, /<SpotifyArtistPhoto artist=\{meta\} artistName=\{a\.name\}/);
  assert.match(artist, /if \(!remoteArtistMeta\(a\.name\)\) resolveArtist\(a\.name\)/,
    "bundled artists still load their current server-side Spotify provenance");
  assert.doesNotMatch(carousel, /spotifyPhoto|Spotify/);
});

test("artist gallery is a stable in-app subroute linked from owner and fan previews", () => {
  assert.match(app, /lazyWithRetry\(\(\) => import\("\.\/src\/screens\/ArtistGalleryScreen"\), "ArtistGalleryScreen"\)/);
  assert.match(app, /go\(\{ artistGallery: \{ name, artistKey: artistKey \|\| null \} \}\)/);
  assert.match(app, /nav\.artistGallery\) overlay = <ArtistGalleryScreen/);
  assert.equal((app.match(/onOpenGallery=\{openArtistGallery\}/g) || []).length, 2);
  assert.match(artist, /PHOTOS & FAN GALLERY/);
  assert.match(artist, /onOpenGallery\(a\.name, a\.profileKey\)/);
});

test("cinematic artist media stays user-driven, reduced-motion aware, and decodes one slide", () => {
  assert.match(carousel, /useReducedMotion\(\)/);
  assert.match(carousel, /artistCinematicMedia\(\{ bannerUri, profileUri, gallery \}, 5\)/);
  assert.match(carousel, /const current = slides\[index\] \|\| null/);
  assert.match(carousel, /width >= 1180 \? 320 : width >= 760 \? 270 : 210/);
  assert.match(carousel, /reduceMotion \? 0|if \(reduceMotion\)/);
  assert.doesNotMatch(carousel, /setInterval|setTimeout|autoplay/);
  assert.match(carousel, /accessibilityLabel=\{`Previous \$\{artistName\} photo`\}/);
  assert.match(carousel, /accessibilityLabel=\{`Next \$\{artistName\} photo`\}/);
  assert.match(carousel, /current\?\.source === "fan" \? "MSHPIT MEMBER PHOTO" : "FEATURED ARTIST"/);
});

test("artist hero copy stays clear of the profile-avatar punch-through", () => {
  assert.doesNotMatch(carousel, /<Text style=\{styles\.title\}/);
  assert.match(carousel, /copy:\s*\{[^}]*left:\s*116,[^}]*right:\s*18,[^}]*bottom:\s*18/s);
});

test("artist gallery previews do not present a capped projection as the total", () => {
  assert.match(artist, /<Text style=\{styles\.sectionLabel\}>PHOTOS & FAN GALLERY<\/Text>/);
  assert.equal((artist.match(/PHOTOS & FAN GALLERY/g) || []).length, 1, "the gallery preview renders once");
  assert.doesNotMatch(artist, /PHOTOS & FAN GALLERY\{gallery\.length/);
  assert.doesNotMatch(artist, /See all \$\{gallery\.length\} media items/);
});

test("artist photos sit directly between Live Reputation and the primary artist actions", () => {
  const reputationAt = artist.indexOf('<View style={styles.repCard}>');
  const galleryAt = artist.indexOf("<Text style={styles.sectionLabel}>PHOTOS & FAN GALLERY</Text>");
  const actionsAt = artist.indexOf('<View style={styles.artistActions}>');
  assert.ok(reputationAt >= 0, "Live Reputation must render");
  assert.ok(galleryAt > reputationAt, "gallery must follow Live Reputation");
  assert.ok(actionsAt > galleryAt, "gallery must appear before Fan Club and Live archive actions");
});

test("artist overview stays bounded while full sections remain explicit", () => {
  assert.match(artist, /limit: ARTIST_OVERVIEW_LIMITS\.reviews/);
  assert.match(artist, /limit: ARTIST_OVERVIEW_LIMITS\.gallery/);
  assert.match(artist, /visibleTopReviews\.map\(\(review, index\) =>/);
  assert.match(artist, /artistPageSynopsis\(bio, \{ condensed: sectionModel\.condensed && !bioExpanded \}\)/);
  assert.match(artist, /sectionModel\.active === "live"/);
  assert.match(artist, /Read full bio/);
});

test("dedicated gallery consumes only the bounded store projection and virtualizes media", () => {
  assert.match(gallery, /artistGallery\(resolvedName, 60, resolvedKey\)/);
  assert.match(gallery, /boundedArtistGalleryMedia\(/);
  assert.match(gallery, /<FlatList/);
  assert.match(gallery, /initialNumToRender=\{pageStep\(columns\)\}/);
  assert.match(gallery, /maxToRenderPerBatch=\{pageStep\(columns\)\}/);
  assert.match(gallery, /windowSize=\{5\}/);
  assert.match(gallery, /removeClippedSubviews/);
  assert.match(gallery, /onEndReached=\{loadMore\}/);
  assert.doesNotMatch(gallery, /\.\.\/lib\/api|\/api\//);
  assert.match(gallery, /Private, removed, blocked, or moderated media never appears here/);
});
