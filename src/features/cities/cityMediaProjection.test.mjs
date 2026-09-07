import assert from "node:assert/strict";
import test from "node:test";
import { projectCityMedia } from "./cityMediaProjection.mjs";
import { isHostedCityImage } from "../../components/cities/cityImagePolicy.mjs";

test("native city media gets the API origin without changing source links or input", () => {
  const photo = { url: "/images/cities/toronto.webp", sourceUrl: "https://commons.wikimedia.org/wiki/File:Toronto.jpg", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" };
  const input = { copy: { welcomeBannerUrl: "/images/cities/welcome.webp" }, editorial: { stockImage: photo }, photos: [photo, { url: "https://cdn.example.org/fan.jpg" }], venues: [{ photo }], artists: [{ image: "/media/a.jpg" }], performingArtists: [{ image: "https://example.org/a.jpg" }], today: [{ image: "/assets/show.webp" }], upcoming: [{ image: null }] };
  const result = projectCityMedia(input, (path) => `https://api.mshpit.com${path}`);
  assert.equal(result.copy.welcomeBannerUrl, "https://api.mshpit.com/images/cities/welcome.webp");
  assert.equal(result.editorial.stockImage.url, "https://api.mshpit.com/images/cities/toronto.webp");
  assert.equal(result.venues[0].photo.url, result.photos[0].url);
  assert.equal(result.photos[1].url, input.photos[1].url);
  assert.equal(result.artists[0].image, "https://api.mshpit.com/media/a.jpg");
  assert.equal(result.today[0].image, "https://api.mshpit.com/assets/show.webp");
  assert.equal(result.editorial.stockImage.sourceUrl, photo.sourceUrl);
  assert.equal(input.editorial.stockImage.url, "/images/cities/toronto.webp");
});
test("hosted city images remain direct on both web and native", () => {
  assert.equal(isHostedCityImage("/images/cities/london.webp"), true);
  assert.equal(isHostedCityImage("https://www.mshpit.com/images/cities/london.webp"), true);
  assert.equal(isHostedCityImage("https://cdn.example.org/photos/fan.jpg"), false);
  assert.equal(isHostedCityImage(null), false);
});
