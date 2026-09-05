import assert from "node:assert/strict";
import test from "node:test";
import {
  commonsVenuePhotoLookupUrl,
  isRelevantCommonsVenuePhoto,
  parseVenuePhotoBackfillArgs,
  selectVenuePhotoBackfillBatch,
} from "./venue-photo-backfill.mjs";

test("Commons lookup requests every field required by the photo safety gate", () => {
  const url = commonsVenuePhotoLookupUrl({
    name: "History",
    place: "Toronto, Ontario, Canada",
  });
  assert.equal(url.origin, "https://commons.wikimedia.org");
  assert.equal(url.searchParams.get("gsrsearch"), "\"History\" Toronto");
  assert.deepEqual(
    new Set(url.searchParams.get("iiprop").split("|")),
    new Set(["url", "mime", "extmetadata"]),
  );
});

const licensed = (uri = "https://images.example/venue.jpg") => ({
  uri,
  sourcePage: "https://catalog.example/venue",
  creator: "Venue Photographer",
  license: "CC-BY-4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  source: "openverse",
});

test("backfill CLI supports bounded dry runs, cursors, and a one-command full sweep", () => {
  assert.deepEqual(parseVenuePhotoBackfillArgs([
    "--limit=12", "--offset=4", "--cursor=bravo", "--dry-run",
    "--delay-ms=500", "--checkpoint-every=3", "--database=C:/data/pit.db",
    "--inventory-limit=2000",
  ]), {
    all: false,
    limit: 12,
    offset: 4,
    cursor: "bravo",
    databasePath: "C:/data/pit.db",
    catalogOnly: false,
    coverageOnly: false,
    inventoryLimit: 2000,
    replace: false,
    useProgressState: true,
    statePath: null,
    dryRun: true,
    delayMs: 500,
    checkpointEvery: 3,
  });
  assert.equal(parseVenuePhotoBackfillArgs(["--all"]).limit, Number.POSITIVE_INFINITY);
  assert.equal(parseVenuePhotoBackfillArgs(["--coverage"]).dryRun, true);
  assert.equal(parseVenuePhotoBackfillArgs(["--catalog-only"]).catalogOnly, true);
  assert.equal(parseVenuePhotoBackfillArgs(["--no-state"]).useProgressState, false);
  assert.equal(parseVenuePhotoBackfillArgs(["--state-path=C:/data/progress.json"]).statePath, "C:/data/progress.json");
  assert.throws(() => parseVenuePhotoBackfillArgs(["--limit=0"]), /--limit/u);
  assert.throws(() => parseVenuePhotoBackfillArgs(["--inventory-limit=250001"]), /--inventory-limit/u);
  assert.throws(() => parseVenuePhotoBackfillArgs(["--delay-ms=5001"]), /--delay-ms/u);
});

test("recurring backfill batches wrap after the saved cursor and tolerate a removed cursor", () => {
  const venues = [
    ["alpha", { name: "Alpha Room", major: true, capacity: 400 }],
    ["bravo", { name: "Bravo Room", capacity: 300 }],
    ["charlie", { name: "Charlie Room", capacity: 200 }],
  ];
  const wrapped = selectVenuePhotoBackfillBatch(venues, {}, {
    limit: 2,
    cursor: "bravo",
    wrap: true,
  });
  assert.deepEqual(wrapped.selected.map(([key]) => key), ["charlie", "alpha"]);
  assert.equal(wrapped.hasMore, true);

  const stale = selectVenuePhotoBackfillBatch(venues, {}, {
    limit: 1,
    cursor: "removed-venue",
    wrap: true,
    allowStaleCursor: true,
  });
  assert.deepEqual(stale.selected.map(([key]) => key), ["alpha"]);
});

test("explicit provider rights-removal rows stay tombstoned even during replace sweeps", () => {
  const providerKey = "provider:ticketmaster:removed-photo-rights";
  const venues = [
    [providerKey, { name: "Protected Room" }],
    ["ordinary-room", { name: "Ordinary Room" }],
  ];
  const batch = selectVenuePhotoBackfillBatch(venues, {
    [providerKey]: { galleryPool: [], photos: [] },
  }, { replace: true, limit: 10 });
  assert.deepEqual(batch.selected.map(([key]) => key), ["ordinary-room"]);
});

test("backfill batches skip accepted inventory and resume after the emitted cursor", () => {
  const venues = [
    ["alpha", { name: "Alpha Room", major: true, capacity: 400 }],
    ["bravo", { name: "Bravo Room", capacity: 300, galleryPool: [licensed("https://images.example/bravo.jpg")] }],
    ["charlie", { name: "Charlie Room", capacity: 200, photo: "https://legacy.example/charlie.jpg" }],
    ["delta", { name: "Delta Room", capacity: 100 }],
  ];
  const existing = {
    alpha: { galleryPool: [licensed("https://images.example/alpha.jpg")] },
  };
  const first = selectVenuePhotoBackfillBatch(venues, existing, { limit: 1 });
  assert.deepEqual(first.selected.map(([key]) => key), ["charlie"]);
  assert.equal(first.nextCursor, "charlie");
  assert.equal(first.hasMore, true);
  assert.equal(first.totalEligible, 2);

  const resumed = selectVenuePhotoBackfillBatch(venues, existing, {
    limit: 1,
    cursor: first.nextCursor,
  });
  assert.deepEqual(resumed.selected.map(([key]) => key), ["delta"]);
  assert.equal(resumed.hasMore, false);
  assert.throws(() => selectVenuePhotoBackfillBatch(venues, existing, {
    cursor: "not-a-real-key",
  }), /Unknown venue-photo cursor/u);
});

function commonsPage({ title, mime = "image/jpeg", description = "", lat, lng }) {
  return {
    title,
    imageinfo: [{
      mime,
      extmetadata: {
        ImageDescription: { value: description },
        ...(lat == null ? {} : { GPSLatitude: { value: lat } }),
        ...(lng == null ? {} : { GPSLongitude: { value: lng } }),
      },
    }],
  };
}

test("one-word venues require explicit live-venue context plus location evidence", () => {
  const history = { name: "History", place: "Toronto, Ontario, Canada", lat: 43.6667, lng: -79.3853 };
  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:History Toronto concert venue.png",
    mime: "image/png",
    description: "History is a music venue in Toronto.",
  }), history), true, "a city-matched one-word venue photo is no longer blanket-rejected");
  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:History Toronto.png",
    mime: "image/png",
    description: "A history project photographed in Toronto.",
  }), history), false, "a generic one-word match without venue context stays rejected");
  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:History exterior.webp",
    mime: "image/webp",
    description: "History concert venue entrance.",
    lat: 43.667,
    lng: -79.385,
  }), history), true, "nearby GPS corroborates explicit venue context");
  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:History exterior.webp",
    mime: "image/webp",
    description: "An unrelated building with the same name.",
    lat: 43.667,
    lng: -79.385,
  }), history), false, "GPS alone cannot prove an ambiguous one-word match");
  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:History logo.svg",
    mime: "image/svg+xml",
    description: "History music venue in Toronto.",
  }), history), false);
});

test("missing venue coordinates never become a Gulf of Guinea location match", () => {
  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:History exterior.webp",
    mime: "image/webp",
    description: "History concert venue entrance.",
    lat: 0,
    lng: 0,
  }), {
    name: "History",
    place: "",
    lat: null,
    lng: "",
  }), false);
});

test("venue-photo relevance rejects concert performers, crowds, and sports matches", () => {
  const allianzSydney = {
    name: "Allianz Stadium",
    place: "Sydney, New South Wales, Australia",
    lat: -33.8891,
    lng: 151.2254,
  };
  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:Elton John at Allianz Stadium, Sydney.jpg",
    description: "Elton John concert at Allianz Stadium in Sydney.",
  }), allianzSydney), false);

  const allstate = {
    name: "Allstate Arena",
    place: "Rosemont, Illinois, United States",
    lat: 42.0053,
    lng: -87.8878,
  };
  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:Rammstein @ Allstate Arena, Rosemont IL 5-4-12.jpg",
    description: "Rammstein performing at Allstate Arena in Rosemont.",
  }), allstate), false);
  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:Kanye West @ Allstate Arena, Rosemont 10 8 2016.jpg",
    description: "Kanye West onstage at Allstate Arena in Rosemont.",
  }), allstate), false);
  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:Palmeiras x Sao Paulo - Allianz Parque.jpg",
    description: "Palmeiras versus Sao Paulo game at Allianz Parque.",
  }), {
    name: "Allianz Parque",
    place: "Sao Paulo, Brazil",
  }), false);
});

test("venue-photo relevance rejects views and landscaping on venue grounds", () => {
  const alexandraPalace = {
    name: "Alexandra Palace",
    place: "London, England, United Kingdom",
    lat: 51.5941,
    lng: -0.1306,
  };
  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:City of London from The Terrace, Alexandra Palace, London N22.jpg",
    description: "A skyline view from the terrace at Alexandra Palace.",
  }), alexandraPalace), false);
  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:Flowerbeds, Alexandra Palace, London N22.jpg",
    description: "Flowerbeds and gardens in the grounds of Alexandra Palace.",
  }), alexandraPalace), false);
});

test("venue-photo relevance accepts a clearly structural building photo", () => {
  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:Allegiant Stadium, Las Vegas, Nevada.jpg",
    description: "Exterior architecture and entrance of Allegiant Stadium in Las Vegas.",
  }), {
    name: "Allegiant Stadium",
    place: "Las Vegas, Nevada, United States",
    lat: 36.0908,
    lng: -115.183,
  }), true);

  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:RBC Stage Toronto exterior.jpg",
    description: "Exterior entrance of the RBC Stage performance venue in Toronto.",
  }), {
    name: "RBC Stage",
    place: "Toronto, Ontario, Canada",
  }), true, "an official venue name containing an event token does not reject itself");

  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:Germany Hamburg Barclays Arena.jpg",
    description: "Exterior of Barclays Arena in Hamburg, Germany.",
  }), {
    name: "Barclays Arena",
    place: "Hamburg, Germany",
  }), true, "a prefix made entirely from venue location tokens stays eligible");
});

test("venue-photo relevance rejects an unexplained artist prefix", () => {
  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:Willie Nelson & Family BankNH Pavilion 108 Kimball Road Gilford NH August 2025 05.jpg",
    description: "Willie Nelson and Family at BankNH Pavilion in Gilford, New Hampshire.",
  }), {
    name: "BankNH Pavilion",
    place: "Gilford, New Hampshire, United States",
  }), false);
});

test("one-word Commons false matches reject schools, sculptures, and multilingual maps", () => {
  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:Paris, Université Panthéon-Assas, Faculté de droit -- 2014 -- 1672.jpg",
    description: "Building of the Panthéon-Assas University law faculty in Paris.",
    lat: 48.846944,
    lng: 2.344722,
  }), { name: "Panthéon", place: "Paris, Île-de-France, France", lat: 48.846111, lng: 2.345833 }), false);

  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:Satyricon 1 (1981) - Reuben Nakian (1897 - 1986).jpg",
    description: "Bronze sculpture by Reuben Nakian in Lisbon.",
    lat: 38.73642,
    lng: -9.15293,
  }), { name: "Satyricon", place: "Portland, Oregon, United States", lat: 45.524209, lng: -122.676773 }), false);

  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:Begehbare Berlinkarte, Schloßplatz, Berlin.jpg",
    description: "A walkable Berlin map at Schloßplatz.",
    lat: 52.518257,
    lng: 13.401432,
  }), { name: "Schloßplatz", place: "Berlin, Berlin, Germany", lat: 52.5175, lng: 13.402778 }), false);

  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:Satyricon.png",
    mime: "image/png",
    description: "Exterior of the Satyricon music venue in Portland, Oregon.",
  }), { name: "Satyricon", place: "Portland, Oregon, United States", lat: 45.524209, lng: -122.676773 }), true);
});

test("article-prefixed venues and namesake landmarks remain fail-closed", () => {
  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:Brig Beaver and Boston Tea Party Museum.jpg",
    description: "The museum ship at the Boston Tea Party Museum in Boston.",
  }), { name: "Boston Tea Party", place: "Boston, Massachusetts, United States" }), false);

  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:Bayou 4th Washington Crosses the Bayou.JPG",
    description: "A street crossing over the bayou in New Orleans.",
  }), { name: "The Bayou", place: "Washington, District of Columbia, United States" }), false);

  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:The well trimmed beech tree avenue.jpg",
    description: "A tree-lined well at Temple Newsam in Leeds.",
  }), { name: "The Well", place: "New York, New York, United States" }), false);

  assert.equal(isRelevantCommonsVenuePhoto(commonsPage({
    title: "File:The Well Leeds concert venue.jpg",
    description: "The Well live music venue in Leeds.",
  }), { name: "The Well", place: "Leeds, England, United Kingdom" }), true);
});
