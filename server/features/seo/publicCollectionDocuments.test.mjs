import assert from "node:assert/strict";
import test from "node:test";
import { archiveShowKey } from "../artistArchive/artistArchiveKeys.js";
import { renderPublicDocument } from "./publicDocuments.js";
import { createPublicCollectionDocumentService } from "./publicCollectionDocuments.js";

const ORIGIN = "https://www.example.test";

function fakeRepository(overrides = {}) {
  return {
    readCityVenues: overrides.readCityVenues || (() => null),
    readCityConcerts: overrides.readCityConcerts || (() => null),
    readArtistConcerts: overrides.readArtistConcerts || (() => null),
  };
}
function itemList(document) {
  return document.jsonLd.find((node) => node["@type"] === "CollectionPage").mainEntity;
}
function assertItemParity(document,items) {
  const list = itemList(document);
  const page = document.jsonLd.find((node) => node["@type"] === "CollectionPage");
  assert.equal(page.isPartOf["@type"],"WebSite");
  assert.equal(page.publisher["@type"],"Organization");
  assert.equal(page.publisher.name,"Mshpit");
  assert.equal(list.numberOfItems,items.length);
  assert.deepEqual(list.itemListElement.map((item) => item.position),items.map((_,index) => index + 1));
  assert.deepEqual(list.itemListElement.map((item) => item.name),items.map((item) => item.name));
  assert.deepEqual(
    list.itemListElement.map((item) => item.url || null),
    items.map((item) => item.path ? new URL(item.path,ORIGIN).toString() : null),
  );
}

test("city venue documents have clean page metadata, safe venue links, JSON-LD parity, and city cross-links", () => {
  const repository = fakeRepository({
    readCityVenues(options) {
      const page = Number(options.page || 1);
      return {
        kind:"city-venues",countryCode:"CA",country:"Canada",city:"Toronto",citySlug:"toronto",
        page,pageSize:12,itemCount:25,venueCount:15,hasNext:true,
        venues:[
          {
            venue_identity:"provider:ticketmaster:venue-100",venue:"Provider Hall",
            source:"Ticketmaster",venue_provider_id:"Venue-100",venue_region:"Ontario",
            venue_country:"Canada",latest_at:1_725_000_000_000,
          },
          {
            venue_identity:"name:independent room",venue:"Independent Room",
            source:null,venue_provider_id:null,venue_region:"Ontario",venue_country:"Canada",
          },
          {
            venue_identity:"unknown:unsafe",venue:"Unproven Room",
            source:null,venue_provider_id:null,venue_region:"Ontario",venue_country:"Canada",
          },
        ],
      };
    },
  });
  const documents = createPublicCollectionDocumentService({ repository,origin:ORIGIN });
  const first = documents.cityVenuesDocument({ countryCode:"ca",citySlug:"toronto",page:1 });
  const second = documents.cityVenuesDocument({ countryCode:"ca",citySlug:"toronto",page:2 });

  assert.equal(first.kind,"directory");
  assert.equal(first.directoryKind,"venues");
  assert.notEqual(first.title,second.title);
  assert.notEqual(first.description,second.description);
  assert.equal(second.title,"Concert Venues in Toronto, Canada - Page 2 | Mshpit");
  assert.equal(second.canonicalPath,"/venues/ca/toronto/page/2");
  assert.equal(second.canonicalUrl,`${ORIGIN}/venues/ca/toronto/page/2`);
  assert.equal(second.previousPath,"/venues/ca/toronto");
  assert.equal(second.nextPath,"/venues/ca/toronto/page/3");
  assert.equal(second.relatedPath,"/concerts/ca/toronto");
  assert.equal(second.relatedLabel,"Concerts in Toronto, Canada");
  assert.equal(second.venues[0].path,"/venue/ticketmaster-venue-100");
  assert.equal(second.venues[1].path,"/venue/independent-room");
  assert.equal(second.venues[2].path,null,"an unproven name remains visible text without a dead link");
  assert.deepEqual(second.breadcrumbs.map((crumb) => crumb.name),["Mshpit","Venues","Toronto, Canada - Page 2"]);

  assertItemParity(second,second.venues);
  const rendered = renderPublicDocument(second);
  assert.match(rendered,/Toronto, Canada/);
  assert.match(rendered,/Provider Hall/);
  assert.equal(rendered.includes('href="/concerts/ca/toronto"'),true);
  assert.doesNotMatch(rendered,/href="\/venue\/unproven-room"/u);
});

test("city concert documents escape hostile data, omit zero ratings, and keep list schema visible-item exact", () => {
  const hostileArtist = 'Bad </script><script>alert("x")</script> Artist';
  const hostileVenue = 'Hall <img src=x onerror="alert(1)">';
  const repository = fakeRepository({
    readCityConcerts() {
      return {
        kind:"city-concerts",countryCode:"CA",country:"Canada",city:"Toronto",citySlug:"toronto",
        page:1,pageSize:12,itemCount:3,venueCount:2,hasNext:false,
        concerts:[
          {
            show_artist:"bad artist",show_venue:"bad hall",artist:hostileArtist,
            artist_key:"bad artist",artist_public_slug:"bad-artist",venue:hostileVenue,
            venue_key:"bad hall",date:"2026-08-01",rating_count:0,average_rating:0,
            review_count:1,latest_at:1_725_000_000_000,
          },
          {
            show_artist:"unknown",show_venue:"safe hall",artist:"Unknown Artist",
            artist_key:null,artist_public_slug:null,venue:"Safe Hall",venue_key:"safe hall",
            date:"2026-08-02",rating_count:2,average_rating:4.5,review_count:2,
          },
        ],
      };
    },
  });
  const document = createPublicCollectionDocumentService({ repository,origin:ORIGIN })
    .cityConcertsDocument({ countryCode:"ca",citySlug:"toronto" });
  assert.equal(document.canonicalPath,"/concerts/ca/toronto");
  assert.equal(document.relatedPath,"/venues/ca/toronto");
  assert.equal(document.relatedLabel,"Venues in Toronto, Canada");
  assert.equal(document.concerts[0].averageRating,null);
  assert.equal(document.concerts[0].artistPath,"/artist/bad-artist");
  assert.equal(document.concerts[1].artistPath,null);
  assert.equal(document.concerts.every((concert) => concert.venuePath === null),true);
  assert.equal(JSON.stringify(document.jsonLd).includes("AggregateRating"),false);
  assertItemParity(document,document.concerts.map((concert) => ({
    ...concert,name:`${concert.artist} at ${concert.venue}`,
  })));

  const html = renderPublicDocument(document);
  assert.doesNotMatch(html,/<\/script><script>/u);
  assert.doesNotMatch(html,/<img src=x onerror=/u);
  assert.match(html,/Bad &lt;\/script&gt;&lt;script&gt;/u);
  assert.equal(html.includes("\\u003c/script\\u003e"),true,"JSON-LD escapes closing script markup");
  assert.doesNotMatch(html,/0\.0\/5/u);
  assert.equal(html.includes('href="/venues/ca/toronto"'),true);
});

test("artist archive documents use the known artist identity, exact pagination, breadcrumbs, and profile cross-link", () => {
  const repository = fakeRepository({
    readArtistConcerts(options) {
      const page = Number(options.page || 1);
      return {
        kind:"artist-concerts",artist:{ norm:"bruno mars",name:"Bruno Mars",public_slug:"bruno-mars" },
        page,pageSize:12,itemCount:14,hasNext:page === 1,
        concerts:[
          {
            show_venue:"history",artist:"Bruno Mars",artist_key:"bruno mars",
            venue:"History",venue_key:"history",city:"Toronto",date:"2026-08-01",
            rating_count:0,average_rating:0,review_count:1,
          },
          {
            show_venue:"arena",artist:"Bruno Mars",artist_key:"bruno mars",
            venue:"Arena",venue_key:"arena",city:"Chicago",date:"2026-07-01",
            rating_count:4,average_rating:4.75,review_count:5,
          },
        ],
      };
    },
  });
  const documents = createPublicCollectionDocumentService({ repository,origin:ORIGIN });
  const first = documents.artistConcertsDocument({ publicSlug:"bruno-mars",page:1 });
  const second = documents.artistConcertsDocument({ publicSlug:"bruno-mars",page:2 });

  assert.notEqual(first.title,second.title);
  assert.equal(second.title,"Bruno Mars Concert Archive & Fan Reviews - Page 2 | Mshpit");
  assert.equal(second.canonicalPath,"/artist/bruno-mars/concerts/page/2");
  assert.equal(second.previousPath,"/artist/bruno-mars/concerts");
  assert.equal(second.nextPath,null);
  assert.equal(second.relatedPath,"/artist/bruno-mars");
  assert.equal(second.relatedLabel,"Bruno Mars artist profile");
  assert.deepEqual(second.breadcrumbs.map((crumb) => crumb.path),[
    "/","/artists","/artist/bruno-mars","/artist/bruno-mars/concerts/page/2",
  ]);
  assert.equal(second.concerts.every((concert) => concert.artistPath === "/artist/bruno-mars"),true);
  assert.equal(second.concerts.every((concert) => concert.venuePath === null),true);
  assert.equal(second.concerts[0].averageRating,null);
  assert.equal(JSON.stringify(second.jsonLd).includes("AggregateRating"),false);
  assertItemParity(second,second.concerts.map((concert) => ({
    ...concert,name:`${concert.artist} at ${concert.venue}`,
  })));

  const expectedKey = archiveShowKey({ artistIdentity:"bruno mars",venueIdentity:"history",date:"2026-08-01" });
  assert.equal(second.concerts[0].path,`/concert/${encodeURIComponent(expectedKey)}`);
  assert.equal(renderPublicDocument(second).includes('href="/artist/bruno-mars"'),true);
});

test("unqualified repository results and missing canonical artist identity return null", () => {
  const empty = createPublicCollectionDocumentService({
    repository:fakeRepository(),origin:ORIGIN,
  });
  assert.equal(empty.cityVenuesDocument({ countryCode:"ca",citySlug:"toronto" }),null);
  assert.equal(empty.cityConcertsDocument({ countryCode:"ca",citySlug:"toronto" }),null);
  assert.equal(empty.artistConcertsDocument({ publicSlug:"unknown" }),null);

  const missingSlug = createPublicCollectionDocumentService({
    origin:ORIGIN,
    repository:fakeRepository({
      readArtistConcerts:() => ({
        artist:{ norm:"missing",name:"Missing",public_slug:null },page:1,hasNext:false,
        concerts:[{ artist:"Missing",venue:"Hall",date:"2026-08-01",review_count:1 }],
      }),
    }),
  });
  assert.equal(missingSlug.artistConcertsDocument({ artistKey:"missing" }),null);
});
