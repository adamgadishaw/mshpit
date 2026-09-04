import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveShowKey,
  archiveTourNameIdentity,
  archiveTourKey,
  decodeArchiveShowKey,
  decodeArchiveTourKey,
  normalizeArchivePart,
} from "./artistArchiveKeys.js";
import { createArtistArchiveService } from "./artistArchiveService.js";

function row({
  id,
  userId = id,
  artist = "Alpha",
  artistKey = "alpha",
  venue = "History Hall",
  city = "Toronto",
  date = "2024-06-01",
  overall = 4.5,
  tour = "Neon World Tour",
  review = `Review ${id}`,
  photosPublic = true,
  likes = 0,
  comments = 0,
  createdAt = 1,
} = {}) {
  return {
    id,
    user_id: userId,
    u_name: `Fan ${userId}`,
    u_handle: userId,
    u_initials: "FN",
    u_avatar: null,
    u_color: "#123456",
    artist,
    artist_key: artistKey,
    venue,
    venue_key: venue.toLowerCase().replaceAll(" ", "-"),
    city,
    date,
    overall,
    band: overall,
    room: overall,
    tour,
    review,
    photos_public: photosPublic ? 1 : 0,
    photos: JSON.stringify([`https://media.test/${id}.jpg`]),
    like_count: likes,
    comment_count: comments,
    created_at: createdAt,
  };
}

function fixture(rows, { mediaForId, upcomingRows } = {}) {
  const matching = ({ show, tour }) => rows.filter((entry) => {
    if (show) return entry.date === show.date
      && entry.venue_key.toLowerCase() === show.venueIdentity.toLowerCase();
    if (tour.tourIdentity.startsWith("year:")) return !entry.tour && entry.date.startsWith(tour.tourIdentity.slice(5));
    return archiveTourNameIdentity(entry.tour, entry.artist)
      === archiveTourNameIdentity(String(tour.tourIdentity || "").slice(5), entry.artist);
  });
  const repository = {
    findReviewRows: () => rows,
    findScopedReviewRows: ({ show, tour, cursor, limit }) => {
      const scoped = matching({ show, tour });
      const start = cursor ? scoped.findIndex((entry) => entry.id === cursor.id) + 1 : 0;
      return scoped.slice(start, start + limit);
    },
    countScopedReviewRows: ({ show, tour }) => matching({ show, tour }).length,
    findUpcomingRows: () => upcomingRows || [{
      id: "tm-world",
      artist: "Alpha",
      venue: "Tokyo Dome",
      place: "Tokyo, Japan",
      date: "2030-03-01",
      ticket_url: "https://www.ticketmaster.com/world",
      sold_out: 0,
      source: "ticketmaster",
      release_at: 0,
      owner_id: null,
    }],
    findReactionCounts: (items) => new Map(items.map(({ postId, url }) => [`${postId}\0${url}`, url.includes("popular") ? 10 : 1])),
  };
  const projectMediaState = (postIds) => ({
    linkedPostIds: new Set(postIds),
    assetsByPost: new Map(postIds.map((id) => [id, mediaForId?.(id) || [{
      url: `https://media.test/${id}.jpg`,
      kind: "image",
      posterUrl: null,
      altText: `${id} crowd photo`,
    }]])),
  });
  return createArtistArchiveService({ repository, projectMediaState, today: () => "2028-01-01" });
}

test("archive keys are opaque, reversible, typed, and reject malformed input", () => {
  const show = archiveShowKey({ artistIdentity: "alpha", venueIdentity: "history-hall", city: "Toronto", date: "2024-06-01" });
  assert.deepEqual(decodeArchiveShowKey(show), {
    artistIdentity: "alpha",
    venueIdentity: "history-hall",
    city: "",
    date: "2024-06-01",
  });
  assert.equal(show, archiveShowKey({ artistIdentity: "alpha", venueIdentity: "history-hall", city: "San Francisco", date: "2024-06-01" }));
  const tour = archiveTourKey({ artistIdentity: "alpha", tourIdentity: "tour:neon world tour", tourLabel: "Neon World Tour" });
  assert.deepEqual(decodeArchiveTourKey(tour), { artistIdentity: "alpha", tourIdentity: "tour:neon", tourLabel: "" });
  assert.equal(decodeArchiveShowKey(tour), null);
  assert.equal(decodeArchiveTourKey("tour.not-base64"), null);
  const longShow = archiveShowKey({
    artistIdentity: "artist-".repeat(25),
    venueIdentity: "venue-".repeat(30),
    city: "city-".repeat(35),
    date: "2024-06-01",
  });
  assert.ok(longShow.length > 240);
  assert.ok(decodeArchiveShowKey(longShow), "valid long keys must survive the route's 1,800-character allowance");
  assert.notEqual(
    archiveShowKey({ artistIdentity: "alpha", venueIdentity: "a-b", city: "Toronto", date: "2024-06-01" }),
    archiveShowKey({ artistIdentity: "alpha", venueIdentity: "a b", city: "Toronto", date: "2024-06-01" }),
    "punctuation-distinct venue identities cannot collapse into one selection",
  );
});

test("archive aggregates distinct performances and reviewers, ranks confidence, and fails private media closed", () => {
  const rows = [
    row({ id: "single-five", venue: "Tiny Club", date: "2025-01-01", overall: 5, tour: null }),
    row({ id: "private-popular", venue: "History Hall", overall: 4.7, photosPublic: false, likes: 100, createdAt: 30 }),
    row({ id: "repeat-new", userId: "repeat", venue: "History Hall", overall: 4.8, createdAt: 20 }),
    row({ id: "repeat-old", userId: "repeat", venue: "History Hall", overall: 2, createdAt: 10 }),
    ...Array.from({ length: 8 }, (_, index) => row({
      id: `crowd-${index}`,
      userId: `crowd-${index}`,
      venue: "History Hall",
      overall: 4.7,
      createdAt: 9 - index,
    })),
  ];
  const archive = fixture(rows).readArchive({ artistKey: "alpha", name: "Alpha", viewer: { id: "viewer" } });

  assert.equal(archive.shows.length, 2);
  const history = archive.shows.find((show) => show.venue === "History Hall");
  assert.equal(history.ratingCount, 10, "repeat ratings count once per account");
  assert.equal(history.reviewCount, 10);
  assert.ok(history.avgRating > 4.69 && history.avgRating < 4.72);
  assert.notEqual(history.cover?.postId, "private-popular", "private media cannot become an archive cover");
  assert.equal(archive.topShows[0].venue, "History Hall", "well-supported rating beats a lone five-star score");
  assert.equal(archive.tours.length, 2, "named tours and ungrouped years remain selectable");
  assert.equal(archive.upcoming[0].venue, "Tokyo Dome");
  assert.equal(archive.upcoming[0].ticketUrl, "https://www.ticketmaster.com/world");
  assert.deepEqual(archive.totals, { shows: 2, ratings: 11, reviews: 11, tours: 2, upcoming: 1 });
});

test("archive projections drop unsafe provider and ownerless legacy ticket links", () => {
  const archive = fixture([], { upcomingRows: [
    {
      id: "bad-provider", artist: "Alpha", venue: "Bad Hall", place: "Toronto", date: "2030-01-01",
      ticket_url: "https://ticketmaster.com.evil-site.com/phish", source: "ticketmaster", owner_id: null,
    },
    {
      id: "owned-custom", artist: "Alpha", venue: "Artist Hall", place: "Toronto", date: "2030-01-02",
      ticket_url: "https://tickets.artist-example.com/show#buy", source: "artist-submitted", owner_id: "artist-1",
    },
    {
      id: "ownerless-custom", artist: "Alpha", venue: "Legacy Hall", place: "Toronto", date: "2030-01-03",
      ticket_url: "https://tickets.unknown-example.com/show", source: "legacy-import", owner_id: null,
    },
  ] }).readArchive({ artistKey: "alpha", name: "Alpha" });
  assert.deepEqual(archive.upcoming.map((show) => show.ticketUrl), [
    "",
    "https://tickets.artist-example.com/show",
    "",
  ]);
});

test("show and tour review reads validate artist binding and paginate without leaking another scope", () => {
  const rows = [
    row({ id: "one", createdAt: 3 }),
    row({ id: "two", createdAt: 2 }),
    row({ id: "three", createdAt: 1 }),
    row({ id: "other-show", venue: "Elsewhere", createdAt: 4 }),
  ];
  const service = fixture(rows);
  const archive = service.readArchive({ artistKey: "alpha", name: "Alpha" });
  const show = archive.shows.find((entry) => entry.venue === "History Hall");
  const first = service.readReviews({ artistKey: "alpha", name: "Alpha", showKey: show.key, limit: 2 });
  assert.deepEqual(first.reviews.map((review) => review.id), ["one", "two"]);
  assert.match(first.nextCursor, /^cursor\./);
  assert.deepEqual(service.readReviews({ artistKey: "alpha", name: "Alpha", showKey: show.key, cursor: first.nextCursor }).reviews.map((review) => review.id), ["three"]);

  const tour = service.readReviews({ artistKey: "alpha", name: "Alpha", tourKey: show.tourKey, limit: 20 });
  assert.deepEqual(tour.reviews.map((review) => review.id), ["one", "two", "three", "other-show"]);
  assert.equal(service.readReviews({ artistKey: "beta", name: "Beta", showKey: show.key }), null);
});

test("tour identity collapses case and punctuation variants without losing their reviews", () => {
  const rows = [
    row({ id: "new-display", venue: "Arena Two", date: "2025-06-02", tour: "Neon World Tour", createdAt: 4 }),
    row({ id: "punctuation", venue: "Arena One", date: "2025-06-01", tour: "NEON-WORLD TOUR", createdAt: 3 }),
    row({ id: "extra-spaces", venue: "Arena One", date: "2025-06-01", tour: "  neon   world tour  ", createdAt: 2 }),
  ];
  const service = fixture(rows);
  const archive = service.readArchive({ artistKey: "alpha", name: "Alpha" });

  assert.equal(archive.tours.length, 1);
  assert.equal(archive.tours[0].name, "Neon World Tour", "a real fan-entered display label remains visible");
  const page = service.readReviews({ artistKey: "alpha", name: "Alpha", tourKey: archive.tours[0].key, limit: 20 });
  assert.deepEqual(page.reviews.map((review) => review.id), ["new-display", "punctuation", "extra-spaces"]);
  assert.equal(page.total, 3);
});

test("J. Cole Fall-Off labels amalgamate across fans while K.O.D stays a distinct tour", () => {
  const rows = [
    row({ id: "adam", userId: "adam", artist: "J. Cole", artistKey: "j-cole", venue: "Scotiabank Arena", date: "2026-07-27", tour: "The Fall-Off Tour", createdAt: 6 }),
    row({ id: "buddy", userId: "buddy", artist: "J. Cole", artistKey: "j-cole", venue: "Scotiabank Arena", date: "2026-07-27", tour: "The Fall off", createdAt: 5 }),
    row({ id: "cloe", userId: "cloe", artist: "J. Cole", artistKey: "j-cole", venue: "Scotiabank Arena", date: "2026-07-27", tour: "The fall-off", createdAt: 4 }),
    row({ id: "andrew", userId: "andrew", artist: "J. Cole", artistKey: "j-cole", venue: "Scotiabank Arena", date: "2026-07-28", tour: "The Fall Off World Tour", createdAt: 3 }),
    row({ id: "kod", userId: "kod-fan", artist: "J. Cole", artistKey: "j-cole", venue: "History Hall", date: "2018-10-04", tour: "K.O.D", createdAt: 2 }),
  ];
  const service = fixture(rows);
  const archive = service.readArchive({ artistKey: "j-cole", name: "J. Cole" });

  assert.equal(archive.tours.length, 2, "only safe presentation and generic suffix variants merge");
  const fallOff = archive.tours.find((tour) => tour.showCount === 2);
  assert.equal(fallOff?.name, "The Fall-Off Tour", "the cleanest label represents the merged tour");
  assert.equal(fallOff?.ratingCount, 4);
  const page = service.readReviews({ artistKey: "j-cole", name: "J. Cole", tourKey: fallOff.key, limit: 20 });
  assert.deepEqual(page.reviews.map((review) => review.id), ["adam", "buddy", "cloe", "andrew"]);
  assert.equal(page.total, 4);
  assert.equal(archive.tours.find((tour) => tour.name === "K.O.D")?.showCount, 1);
});

test("tour identity keeps meaningful title words distinct", () => {
  const archive = fixture([
    row({ id: "base", venue: "Arena One", date: "2025-06-01", tour: "The Fall-Off Tour" }),
    row({ id: "arena", venue: "Arena Two", date: "2025-06-02", tour: "The Fall-Off Arena Tour" }),
    row({ id: "after", venue: "Arena Three", date: "2025-06-03", tour: "The Fall-Off After Hours Tour" }),
  ]).readArchive({ artistKey: "alpha", name: "Alpha" });

  assert.deepEqual(archive.tours.map((tour) => tour.name).sort(), [
    "The Fall-Off After Hours Tour",
    "The Fall-Off Arena Tour",
    "The Fall-Off Tour",
  ]);
});

test("one performance merges city aliases and keeps a representative city label", () => {
  const rows = [
    row({ id: "abbreviation", city: "SF", createdAt: 2 }),
    row({ id: "full-city", city: "San Francisco", createdAt: 1 }),
  ];
  const service = fixture(rows);
  const archive = service.readArchive({ artistKey: "alpha", name: "Alpha" });

  assert.equal(archive.shows.length, 1);
  assert.equal(archive.shows[0].place, "San Francisco");
  const page = service.readReviews({ artistKey: "alpha", name: "Alpha", showKey: archive.shows[0].key, limit: 20 });
  assert.deepEqual(page.reviews.map((review) => review.id), ["abbreviation", "full-city"]);
  assert.equal(page.total, 2);
});

test("archive covers never select a video without a usable fan poster", () => {
  const rows = [
    row({ id: "blank-video", likes: 50, createdAt: 3 }),
    row({ id: "poster-video", likes: 20, createdAt: 2 }),
    row({ id: "fan-photo", likes: 1, createdAt: 1 }),
  ];
  const service = fixture(rows, {
    mediaForId: (id) => id === "blank-video" ? [{
      url: "https://media.test/blank-video.mp4",
      kind: "video",
      posterUrl: null,
    }] : id === "poster-video" ? [{
      url: "https://media.test/poster-video.mp4",
      kind: "video",
      posterUrl: "https://media.test/poster-video.jpg",
    }] : [{
      url: "https://media.test/fan-photo.jpg",
      kind: "image",
      posterUrl: null,
    }],
  });

  const archive = service.readArchive({ artistKey: "alpha", name: "Alpha" });
  assert.equal(archive.shows[0].cover?.postId, "fan-photo", "a real fan photo remains the preferred archive cover");
  assert.notEqual(archive.shows[0].cover?.postId, "blank-video");
});
