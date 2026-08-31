import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";

const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const artist = readFileSync(new URL("../screens/ArtistScreen.jsx", import.meta.url), "utf8");
const gallery = readFileSync(new URL("../screens/ArtistGalleryScreen.jsx", import.meta.url), "utf8");
const carousel = readFileSync(new URL("../components/ArtistCinematicCarousel.jsx", import.meta.url), "utf8");

test("artist cinematic and gallery modules remain parseable", () => {
  for (const [name, source] of Object.entries({ app, artist, gallery, carousel })) {
    assert.doesNotThrow(() => parse(source, { sourceType: "module", plugins: ["jsx"] }), `${name} must parse`);
  }
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
