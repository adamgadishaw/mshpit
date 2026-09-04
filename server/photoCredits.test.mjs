import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { publicArtistPhoto } from "./artistPhotoCatalog.js";
import {
  absolutePhotoCreditUrl,
  licensedArtworkXmp,
  photoCreditForId,
  photoCreditPageForPath,
  photoCreditPathFromArtwork,
} from "./photoCredits.js";
import { publicPageSitemapEntries, renderPublicPage } from "./publicPages.js";

const credits = JSON.parse(readFileSync(
  new URL("../src/seed/catalog.photo-credits.json", import.meta.url),
  "utf8",
));

test("append-only photo credit rows bind URI, object key, and hash to one immutable id", () => {
  assert.ok(Object.keys(credits).length >= 2);
  for (const [id, row] of Object.entries(credits)) {
    assert.match(id, /^[a-f0-9]{48}$/u);
    assert.equal(row.photo.mirror.objectKey.endsWith(`/${id}.webp`), true);
    assert.equal(
      decodeURIComponent(new URL(row.photo.uri).pathname).endsWith(`/${row.photo.mirror.objectKey}`),
      true,
    );
    if (row.photo.mirror.sha256) assert.equal(row.photo.mirror.sha256.startsWith(id), true);
    assert.equal(photoCreditForId(id)?.id, id);
  }
});

test("photo credit pages are stable public documents but stay out of search and sitemap", () => {
  const id = "a84ab2bcd680ed638991343983552341926bac7c9714782d";
  const path = `/photo-credits/${id}`;
  const page = photoCreditPageForPath(path);
  assert.equal(page?.path, path);
  assert.equal(page?.indexable, false);
  assert.equal(page?.licenseUrl, "https://creativecommons.org/licenses/by/3.0/");
  assert.equal(page?.sections[0]?.links[0]?.href,
    "https://commons.wikimedia.org/wiki/File:Bryson_Tiller_August_2018_(cropped).jpg");
  assert.equal(publicPageSitemapEntries().some((entry) => entry.path === path), false);
  assert.equal(absolutePhotoCreditUrl(path), `https://www.mshpit.com${path}`);
  assert.equal(absolutePhotoCreditUrl(`${path}?redirect=https://example.com`), null);
  assert.equal(photoCreditPageForPath(`${path}/extra`), null);
  const html = renderPublicPage(path);
  assert.match(html, /<meta name="robots" content="noindex,follow"/u);
  assert.match(html, /<link rel="license" href="https:\/\/creativecommons\.org\/licenses\/by\/3\.0\/"/u);
  assert.match(html, /<figure class="credit-photo"><img src="https:\/\/pub-ed4a84/u);
  const navigation = html.match(/<nav aria-label="Public information">([\s\S]*?)<\/nav>/u)?.[1] || "";
  assert.doesNotMatch(navigation, /photo-credits/u);
});

test("licensed artist artwork carries its credit path and creates clean XMP attribution", () => {
  const photo = publicArtistPhoto("bryson tiller");
  assert.ok(photo?.creditPath);
  assert.equal(photoCreditPathFromArtwork(photo), photo.creditPath);
  const creditUrl = absolutePhotoCreditUrl(photo.creditPath);
  const xmp = licensedArtworkXmp({ artwork: photo, creditUrl });
  assert.match(xmp, /AtlantaFX/u);
  assert.match(xmp, /creativecommons\.org\/licenses\/by\/3\.0/u);
  assert.match(xmp, new RegExp(creditUrl.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.equal(photoCreditPathFromArtwork({ ...photo, creator: "Someone else" }), null);
  assert.equal(licensedArtworkXmp({ artwork: photo, creditUrl: "https://example.com/credit" }), null);
});
