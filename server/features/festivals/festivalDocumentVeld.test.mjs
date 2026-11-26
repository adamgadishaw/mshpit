import assert from "node:assert/strict";
import test from "node:test";
import { projectFestivalDocument, renderFestivalMain } from "./festivalDocument.js";

const days = ["2027-07-30", "2027-07-31", "2027-08-01"];
const fixture = {
  id: "veld:2027-07-30:toronto", name: "Veld Music Festival 2027",
  startDate: days[0], endDate: days[2], days, venue: "Downsview Park Toronto",
  city: "Toronto", region: "ON", countryCode: "CA", ticketUrl: null, lineupCount: 6,
  lineup: ["Alesso", "Chris Lake", "deadmau5", "Loud Luxury", "Martin Garrix", "Zedd"]
    .map(name => ({ name, days })),
};
const page = item => ({ festival: { slug: "veld", name: "Veld Music Festival", website: "https://veldmusicfestival.com/" },
  upcoming: [item], past: [], reviews: [] });

test("exact VELD guide shows weekend billings and official pass options without inventing days", () => {
  const document = projectFestivalDocument({ page: page(fixture) });
  const html = renderFestivalMain(document);
  assert.equal(document.canonicalPath, "/festival/veld");
  assert.match(html, /Weekend lineup|Performance days have not been announced/);
  assert.match(html, /deadmau5 \(RETRO5PECTIVE\)/);
  assert.match(html, /Tinlicker \(DJ Set\)/);
  assert.match(html, /Seven Lions b2b Dabin/);
  assert.match(html, /Excision/);
  assert.match(html, /https:\/\/veld\.frontgatetickets\.com\//);
  assert.doesNotMatch(html, /<h3>(Friday|Saturday|Sunday),/);
  const festival = document.jsonLd.find(row => row["@type"] === "Festival");
  assert.equal(festival.startDate, days[0]);
  assert.equal(festival.endDate, days[2]);
  assert.equal(Object.hasOwn(festival, "offers"), false);
  assert.equal(fixture.lineupCount, 6);
  assert.deepEqual(fixture.lineup[0].days, days);
});

test("a genuinely differentiated schedule stays intact and other editions do not gain this link", () => {
  const actual = { ...fixture, lineup: fixture.lineup.map((item, i) => ({ ...item, days: [days[i % 3]] })) };
  const html = renderFestivalMain(projectFestivalDocument({ page: page(actual) }));
  for (const name of ["Friday", "Saturday", "Sunday"]) assert.match(html, new RegExp("<h3>" + name + ","));
  assert.doesNotMatch(html, /Performance days have not been announced/);
  const other = { ...fixture, id: "veld:2027-07-30:other", city: "Elsewhere" };
  assert.doesNotMatch(renderFestivalMain(projectFestivalDocument({ page: page(other) })), /Check official weekend passes/);
});
