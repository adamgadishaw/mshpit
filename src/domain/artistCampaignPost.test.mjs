import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTIST_CAMPAIGN_TREATMENTS,
  ARTIST_CAMPAIGN_VERSION,
  DEFAULT_ARTIST_CAMPAIGN_TREATMENT,
  artistCampaignBackground,
  artistCampaignPresentation,
  normalizeArtistCampaign,
} from "./artistCampaignPost.mjs";

const BACKGROUND_ID = "ma_abcdefgh12345678";

test("the current campaign schema exposes exactly three immutable treatments", () => {
  assert.equal(ARTIST_CAMPAIGN_VERSION, 1);
  assert.equal(DEFAULT_ARTIST_CAMPAIGN_TREATMENT, "spotlight");
  assert.deepEqual(Object.keys(ARTIST_CAMPAIGN_TREATMENTS), ["spotlight", "tour-poster", "after-dark"]);
  assert.equal(Object.isFrozen(ARTIST_CAMPAIGN_TREATMENTS), true);
  for (const [id, value] of Object.entries(ARTIST_CAMPAIGN_TREATMENTS)) {
    assert.equal(Object.isFrozen(value), true);
    assert.equal(value.id, id);
    assert.match(value.textColor, /^#[0-9A-F]{6}$/i);
    assert.match(value.contentSurfaceColor, /^#[0-9A-F]{6}$/i);
  }
});

test("normalization produces a compact canonical campaign", () => {
  assert.deepEqual(normalizeArtistCampaign({
    version: 1,
    treatment: "  TOUR-POSTER ",
    artistKey: "  model/actriz   official ",
    backgroundAssetId: ` ${BACKGROUND_ID} `,
    arbitraryStyle: "position:fixed",
  }), {
    version: 1,
    treatment: "tour-poster",
    artistKey: "model/actriz official",
    backgroundAssetId: BACKGROUND_ID,
  });

  assert.deepEqual(normalizeArtistCampaign({ version: 1, treatment: "spotlight" }), {
    version: 1,
    treatment: "spotlight",
  });
  assert.deepEqual(normalizeArtistCampaign({
    version: 1,
    treatment: "after-dark",
    artistKey: "",
    backgroundAssetId: null,
  }), {
    version: 1,
    treatment: "after-dark",
  });
});

test("unknown schemas, treatments, and unsafe identities fail closed", () => {
  for (const value of [
    null,
    [],
    { version: "1", treatment: "spotlight" },
    { version: 2, treatment: "spotlight" },
    { version: 1, treatment: "custom-css" },
    { version: 1, treatment: "__proto__" },
    { version: 1, treatment: "spotlight", backgroundAssetId: "https://media.test/art.jpg" },
    { version: 1, treatment: "spotlight", backgroundAssetId: "ma_short" },
    { version: 1, treatment: "spotlight", artistKey: "javascript:\u202eartist" },
    { version: 1, treatment: "spotlight", artistKey: "_" },
    { version: 1, treatment: "spotlight", artistKey: "x".repeat(121) },
  ]) assert.equal(normalizeArtistCampaign(value), null);
});

test("a background resolves from public and composer stable descriptors", () => {
  const campaign = { version: 1, treatment: "spotlight", backgroundAssetId: BACKGROUND_ID };
  const publicDescriptor = {
    id: BACKGROUND_ID,
    kind: "image",
    status: "ready",
    url: "https://media.test/render.webp",
    altText: "Artist beneath amber stage lights",
  };
  assert.equal(artistCampaignBackground(campaign, [publicDescriptor]), publicDescriptor);

  const composerDescriptor = {
    assetId: BACKGROUND_ID,
    kind: "image",
    sourceUrl: "https://media.test/source.jpg",
  };
  assert.equal(artistCampaignBackground(campaign, [composerDescriptor]), composerDescriptor);
});

test("background resolution never guesses from legacy or unusable media", () => {
  const campaign = { version: 1, treatment: "spotlight", backgroundAssetId: BACKGROUND_ID };
  const usable = { id: BACKGROUND_ID, kind: "image", status: "ready", url: "https://media.test/art.webp" };
  for (const media of [
    ["https://media.test/art.webp"],
    [{ ...usable, id: "ma_otherasset123456" }],
    [{ ...usable, kind: "video" }],
    [{ ...usable, status: "uploading" }],
    [{ ...usable, url: "" }],
    [{ ...usable, assetId: "ma_conflictasset12" }],
  ]) assert.equal(artistCampaignBackground(campaign, media), null);

  assert.equal(artistCampaignBackground(campaign, [
    { id: "ma_otherasset123456", kind: "image", url: "https://media.test/other.webp" },
    usable,
  ]), usable);
  assert.equal(artistCampaignBackground({ version: 2, treatment: "spotlight", backgroundAssetId: BACKGROUND_ID }, [usable]), null);
});

test("presentation preserves curated styling when selected background media is gone", () => {
  const campaign = { version: 1, treatment: "after-dark", artistKey: "slowdive", backgroundAssetId: BACKGROUND_ID };
  const presentation = artistCampaignPresentation(campaign, []);
  assert.equal(presentation.campaign.treatment, "after-dark");
  assert.equal(presentation.treatment, ARTIST_CAMPAIGN_TREATMENTS["after-dark"]);
  assert.equal(presentation.background, null);

  assert.equal(artistCampaignPresentation({ version: 1, treatment: "unknown" }), null);
});
