import assert from "node:assert/strict";
import test from "node:test";
import { festivalShareCardModel, socialShareCardSvg } from "./socialShareCardRenderer.js";

const festival = { slug: "lollapalooza", name: "Lollapalooza" };
const edition = { id: "lollapalooza:2027-07-29:chicago", name: "Lollapalooza 2027", startDate: "2027-07-29", endDate: "2027-08-01",
  venue: "Grant Park", city: "Chicago", region: "IL", lineup: [{ name: "Sabrina Carpenter" }, { name: "Doechii & Friends" }, { name: "Clairo" }] };

test("a festival lineup card is a type-only poster linking to the festival page", () => {
  const model = festivalShareCardModel({ festival, edition, intent: "lineup" });
  assert.equal(model.variant, "festival");
  assert.equal(model.canonicalUrl, "https://www.mshpit.com/festival/lollapalooza");
  assert.deepEqual(model.artwork, [], "a provider festival image is never turned into a story card");
  assert.match(model.subtitle, /^JUL 29 to AUG 1, 2027$/iu);
  const svg = socialShareCardSvg(model);
  assert.match(svg, /data-layout="festival"/u);
  assert.match(svg, />Sabrina Carpenter · Doechii</u);
  assert.match(svg, />&amp; Friends · Clairo</u, "names are escaped and wrap onto the next line");
  assert.match(svg, /Full lineup on mshpit\.com/u);
});

test("a going card needs the member's days and shows their must-see sets", () => {
  assert.equal(festivalShareCardModel({ festival, edition, intent: "going", plan: { days: [] } }), null);
  const model = festivalShareCardModel({ festival, edition, intent: "going", authorName: "Sam", plan: { days: ["2027-07-30", "2027-07-31"], mustSee: ["Clairo"] } });
  assert.deepEqual([model.variant, model.kicker, model.days, model.mustSee], ["festival-going", "Sam is going", ["FRI", "SAT"], ["Clairo"]]);
  const svg = socialShareCardSvg(model);
  assert.match(svg, />FRI · SAT</u);
  assert.match(svg, />GOING</u);
  assert.equal(festivalShareCardModel({ festival: { slug: "../x" }, edition, intent: "lineup" }), null);
  assert.equal(festivalShareCardModel({ festival, edition, intent: "maybe" }), null);
});
