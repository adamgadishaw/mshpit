import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  NEWS_REGIONS, newsRegionForHomeCity, newsStoryMentionsCity, newsStoryRegions, newsStoryVisibleIn,
  readNewsRegionChoice, setNewsRegionChoice, viewerNewsRegion,
} from "./newsRegions.js";

const story = (headline, summary = "") => ({ headline, summary, body: "" });
const regions = (headline, summary) => newsStoryRegions(story(headline, summary));

test("a story is regional only when it is about something happening in a place", () => {
  assert.deepEqual(regions("Oasis Add More UK and Ireland Stadium Dates"), ["uk-ireland"]);
  assert.deepEqual(regions("Pulp announce shows in Glasgow and Manchester"), ["uk-ireland"]);
  assert.deepEqual(regions("Raye leads the BRIT Awards nominations"), ["uk-ireland"]);
  assert.deepEqual(regions("Sabrina Carpenter tops the Official Albums Chart again"), ["uk-ireland"]);
  assert.deepEqual(regions("Glastonbury 2027 tickets sell out in 30 minutes"), ["uk-ireland"]);
  assert.deepEqual(regions("The Weeknd announces 2027 North American stadium tour"), ["us-canada"]);
  assert.deepEqual(regions("Drake adds three more Toronto shows"), ["us-canada"]);
  assert.deepEqual(regions("Tate McRae wins big at the Juno Awards"), ["us-canada"]);
  assert.deepEqual(regions("Morgan Wallen's new single debuts at No. 1 on the Billboard Hot 100"), ["us-canada"]);
  assert.deepEqual(regions("Coldplay confirm Australian tour for November"), ["australia-nz"]);
  assert.deepEqual(regions("Rosalia plays two nights in Madrid"), ["europe"]);
  assert.deepEqual(regions("Bad Bunny adds dates in Mexico City"), ["latin-america"]);
});

test("where an artist is from, lives or died does not make world news local", () => {
  assert.deepEqual(regions("British singer Dua Lipa releases new album"), []);
  assert.deepEqual(regions("Canadian rapper Drake shares surprise EP"), []);
  assert.deepEqual(regions("Legendary producer dies in London at 81"), []);
  assert.deepEqual(regions("The singer, born in Toronto, announced her retirement"), []);
  assert.deepEqual(regions("Taylor Swift announces a new album", "It follows her record-breaking world tour, which played London and Toronto."), [], "a world tour is for everyone");
  assert.deepEqual(regions("Beyonce extends tour with dates in London and Toronto"), [], "two regions is for everyone");
  assert.deepEqual(regions("Tell us your favourite album of the year"), [], "the pronoun us is not the United States");
  assert.deepEqual(regions("Kendrick Lamar wins five Grammys"), []);
  assert.deepEqual(regions("Kendrick Lamar wins five Grammys", "The ceremony took place in Los Angeles."), [], "a night the world watches stays worldwide");
  assert.deepEqual(newsStoryRegions({ headline: "Country star dies at 71", summary: "He died Tuesday in Nashville.", category: "death" }), [], "deaths are reported everywhere");
  assert.deepEqual(regions("Oasis announce North American and UK dates"), [], "two regions in one list");
  assert.deepEqual(regions("Coldplay's London shows move to August"), ["uk-ireland"]);
  assert.deepEqual(regions("Paris Hilton releases a new single"), [], "a name is not a place");
  assert.deepEqual(regions("Chicago announce a new album"), []);
});

test("worldwide stories reach everyone; a regional story reaches its region", () => {
  const uk = story("Oasis add UK stadium dates");
  const world = story("Kendrick Lamar wins five Grammys");
  assert.equal(newsStoryVisibleIn(uk, "us-canada"), false);
  assert.equal(newsStoryVisibleIn(uk, "uk-ireland"), true);
  assert.equal(newsStoryVisibleIn(uk, null), true, "no region means everything");
  assert.equal(newsStoryVisibleIn(world, "us-canada"), true);
  assert.equal(newsStoryMentionsCity(story("Drake adds three more Toronto shows"), "Toronto"), true);
  assert.equal(newsStoryMentionsCity(story("Drake adds three more Toronto shows"), "Ottawa"), false);
  assert.equal(newsStoryMentionsCity(story("Toronto"), "To"), false, "too short to match safely");
});

test("incidental geography never makes global news local or regional", () => {
  const examples = [
    ["Toronto", "A preview begins at midnight in Japan, equivalent to October 4 in Toronto."],
    ["Toronto", "The single arrives at 6 p.m. in Toronto."],
    ["Toronto", "The single arrives at 6 p.m. Toronto time."],
    ["Toronto", "The show in Toronto time starts at 6 p.m."],
    ["Toronto", "The show in Toronto's local time starts at 6 p.m."],
    ["Toronto", "The singer, born in Toronto, announced a new album."],
    ["Toronto", "Recorded in Toronto, the album arrives Friday."],
    ["Chicago", "Chicago announce a new album."],
    ["Chicago", "Chicago tours Europe this summer."],
    ["Chicago", "Chicago shows off a new single."],
    ["Chicago", "Chicago shows support for a new charity."],
    ["Paris", "Paris Hilton releases a new single."],
    ["Toronto", "The singer was born in Toronto. Shows are planned for next year."],
  ];
  for (const [city, text] of examples) {
    for (const field of ["headline", "summary", "body"]) {
      const item = { category: "release", [field]: text };
      assert.equal(newsStoryMentionsCity(item, city), false, `${field}: ${text}`);
      assert.deepEqual(newsStoryRegions(item), [], `${field}: ${text}`);
      for (const { id } of NEWS_REGIONS) assert.equal(newsStoryVisibleIn(item, id), true, `${id}: ${text}`);
    }
  }
  assert.equal(newsStoryMentionsCity(story("An artist remembers Toronto", "Shows will follow next year"), "Toronto"), false,
    "separate fields cannot invent an event/place relationship");
});

test("explicit event geography survives timezone references and worldwide tours", () => {
  for (const headline of [
    "Drake adds three more Toronto shows",
    "Drake announces Toronto arena shows",
    "Drake plays two nights in Toronto",
    "Drake performs in Toronto",
    "Drake returns to Toronto",
    "Drake confirms shows in Montreal and Toronto",
  ]) {
    assert.equal(newsStoryMentionsCity(story(headline), "Toronto"), true, headline);
    assert.deepEqual(regions(headline), ["us-canada"], headline);
  }
  const ukShow = story("A singer announces shows in London", "The livestream starts at 6 p.m. in Toronto.");
  assert.deepEqual(newsStoryRegions(ukShow), ["uk-ireland"], "timezone mentions do not erase actual regional geography");
  assert.equal(newsStoryMentionsCity(ukShow, "London"), true);
  assert.equal(newsStoryMentionsCity(ukShow, "Toronto"), false);
  for (const headline of ["Beyonce adds shows in London and Toronto", "Beyonce's world tour adds Toronto shows"]) {
    assert.deepEqual(regions(headline), [], headline);
    assert.equal(newsStoryMentionsCity(story(headline), "Toronto"), true, headline);
  }
  assert.equal(newsStoryMentionsCity(story("Shows in São Paulo"), "Sao Paulo"), true);
  assert.equal(newsStoryMentionsCity(story("Shows in New York"), "York"), false);
  assert.equal(newsStoryMentionsCity(story("Torontonian shows announced"), "Toronto"), false);
});

test("a home city picks the region, and a member can choose another or everywhere", () => {
  assert.deepEqual(newsRegionForHomeCity("Toronto, Ontario, Canada"), { city: "Toronto", region: "us-canada" });
  assert.deepEqual(newsRegionForHomeCity("London, Ontario, Canada"), { city: "London", region: "us-canada" }, "London, Ontario stays in Canada");
  assert.deepEqual(newsRegionForHomeCity("London, England, United Kingdom"), { city: "London", region: "uk-ireland" });
  assert.deepEqual(newsRegionForHomeCity("Sydney, New South Wales, Australia"), { city: "Sydney", region: "australia-nz" });
  assert.deepEqual(newsRegionForHomeCity("Somewhere"), { city: "Somewhere", region: null });
  assert.deepEqual(newsRegionForHomeCity(""), { city: null, region: null });
  assert.ok(NEWS_REGIONS.every((region) => region.label && !region.label.includes("—")));

  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE users (id TEXT PRIMARY KEY, home_city TEXT)");
  database.prepare("INSERT INTO users VALUES (?,?)").run("u1", "Toronto, Ontario, Canada");
  const viewer = { id: "u1", home_city: "Toronto, Ontario, Canada" };
  assert.equal(readNewsRegionChoice(database, "u1"), "auto", "no table yet means automatic");
  assert.deepEqual(viewerNewsRegion(database, viewer), { choice: "auto", region: "us-canada", label: "US and Canada", city: "Toronto", home: "us-canada" });
  assert.equal(setNewsRegionChoice(database, { userId: "u1", choice: "uk-ireland", at: 1 }), "uk-ireland");
  assert.equal(viewerNewsRegion(database, viewer).region, "uk-ireland");
  setNewsRegionChoice(database, { userId: "u1", choice: "everywhere", at: 2 });
  assert.deepEqual([viewerNewsRegion(database, viewer).region, viewerNewsRegion(database, viewer).label], [null, "Everywhere"]);
  setNewsRegionChoice(database, { userId: "u1", choice: "auto", at: 3 });
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM news_region_prefs").get().n, 0, "automatic stores nothing");
  assert.equal(setNewsRegionChoice(database, { userId: "u1", choice: "mars" }), null);
  assert.equal(viewerNewsRegion(database, null).region, null, "guests see everything");
});
