import assert from "node:assert/strict";
import test from "node:test";
import { publicArtistPhoto } from "../../artistPhotoCatalog.js";
import { binaryApiResponsePayload } from "../../binaryApiResponse.js";
import { ApiError } from "../../errors.js";
import { socialShareCardRoutes } from "../socialSharing/socialShareCardRoutes.js";
import { newsDeskRoutes } from "./newsDeskRoutes.js";

const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(120)]);
const PHOTO = publicArtistPhoto("bryson tiller", { mediaPublicBaseUrl: "https://media.example/public" });
const ARTWORK = { ...PHOTO, url: PHOTO.uri, source: "licensed-media" };
const STORY = Object.freeze({ id: "story-1", postId: "news_1", headline: "Bryson Tiller announces a tour",
  summary: "Independent outlets report the announcement.", category: "tour", publishedAt: 1_790_000_000_000,
  artists: [{ key: "bryson tiller", name: "Bryson Tiller" }], sources: [{ name: "NME" }] });

function fixture(kind, { mutate = null, artworkFallback = false, signedIn = false } = {}) {
  let options = { fallbackArtwork: [ARTWORK], artworkContext: "Artist photo: Bryson Tiller" };
  let renderedModel;
  const renderer = { async render(model) {
    renderedModel = model;
    if (mutate === "remove") options = { fallbackArtwork: [], artworkContext: "" };
    if (mutate === "context") options = { ...options, artworkContext: "Updated image context" };
    if (mutate === "crop") options = { ...options, fallbackArtwork: [{ ...ARTWORK, focalPoint: { x: 0.1, y: 0.3 } }] };
    return { bytes: PNG, artwork: artworkFallback ? null : model.artwork[0], artworkFallback };
  } };
  const resolveNewsArtwork = () => options;
  const ctx = { params: { id: STORY.id }, body: { kind: "post", postId: STORY.postId }, setHeader() {},
    ...(signedIn ? { user: { id: "member" } } : {}) };
  const route = kind === "preview"
    ? newsDeskRoutes({ rateLimit() {}, reader: { get: () => STORY }, renderer, resolveNewsArtwork })["GET /api/news-desk/stories/:id/image.png"]
    : socialShareCardRoutes({
      database: { prepare: () => ({ get: () => ({ user_id: "publisher", kind: "status" }) }) },
      ApiError, attendanceRepository: { ownExactAttendance() {} }, blockedEitherWay: () => false,
      rateLimit() {}, requireUser: () => ({ id: "member" }), resolvePublicDocument: async () => null,
      resolveNewsStory: () => STORY, resolveNewsArtwork, renderer,
    })["POST /api/share-cards/render"];
  return { run: () => route(ctx), model: () => renderedModel };
}

test("download and SEO cards receive the same current licensed photo and attribution", async () => {
  for (const kind of ["download", "preview"]) {
    const f = fixture(kind);
    const response = binaryApiResponsePayload(await f.run());
    assert.equal(f.model().artwork[0].url, PHOTO.uri);
    assert.equal(f.model().artworkContext, "Artist photo: Bryson Tiller");
    assert.match(JSON.stringify(response.headers), /photo-credits/);
    assert.equal(f.model().variant, kind === "download" ? "news" : "news-link");
  }
});

test("unchanged news copy cannot authorize a removed, recaptioned or recropped photo after rendering", async () => {
  for (const kind of ["download", "preview"]) {
    for (const mutate of ["remove", "context", "crop"]) {
      await assert.rejects(fixture(kind, { mutate }).run(), (error) => error.status === 404, `${kind}: ${mutate}`);
    }
  }
});

test("temporary text fallbacks and signed-in previews never enter a shared HTTP cache", async () => {
  for (const options of [{ artworkFallback: true }, { signedIn: true }]) {
    const response = binaryApiResponsePayload(await fixture("preview", options).run());
    assert.equal(response.headers["Cache-Control"], "private, no-store");
  }
  const normal = binaryApiResponsePayload(await fixture("preview").run());
  assert.match(normal.headers["Cache-Control"], /public/);
});
