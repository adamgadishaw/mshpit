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

function cityCollectionFixture(overrides = {}) {
  return {
    countryCode:"CA",country:"Canada",city:"Toronto",citySlug:"toronto",page:1,hasNext:false,
    venues:[{ venue_identity:"name:history",venue:"History" }],
    concerts:[{ artist:"Alpha",venue:"History",date:"2026-08-01",review_count:1 }],
    ...overrides,
  };
}

test("city directories link to a verified guide with editable copy without loading its gallery", () => {
  const raw = cityCollectionFixture();
  let copy = "Music guide to {city}";
  const calls = [];
  const cityGuideRepository = {
    listSitemapCities(options) { calls.push(options);return [{ countryCode:"CA",citySlug:"toronto",city:"Toronto",path:"/city/ca/toronto" }]; },
    readCopy() { return { copy:{ cityGuideLink:copy } }; },
    getGuide() { assert.fail("Directory links must not load a city gallery"); },
  };
  const documents = createPublicCollectionDocumentService({
    repository:fakeRepository({ readCityVenues:()=>raw,readCityConcerts:()=>raw }),origin:ORIGIN,cityGuideRepository,
  });
  const venues = documents.cityVenuesDocument({ at:1234 });
  assert.deepEqual(venues.relatedLinks,[
    { path:"/concerts/ca/toronto",label:"Concerts in Toronto, Canada" },
    { path:"/city/ca/toronto",label:"Music guide to Toronto" },
  ]);
  assert.equal(Object.isFrozen(venues.relatedLinks),true);
  assert.equal(Object.isFrozen(venues.relatedLinks[1]),true);
  assert.match(renderPublicDocument(venues),/href="\/city\/ca\/toronto"[^>]*>Music guide to Toronto<\/a>/u);
  copy = "Explore {city}'s venues & music";
  const concerts = documents.cityConcertsDocument({ at:5678 });
  assert.deepEqual(concerts.relatedLinks,[
    { path:"/venues/ca/toronto",label:"Venues in Toronto, Canada" },
    { path:"/city/ca/toronto",label:"Explore Toronto's venues & music" },
  ]);
  assert.match(renderPublicDocument(concerts),/Explore Toronto&#39;s venues &amp; music/u);
  assert.deepEqual(calls,[{ at:1234 },{ at:5678 }]);
  assert.equal(documents.cityVenuesDocument({ at:"not a timestamp" }).relatedLinks.length,2);
  assert.equal(Number.isSafeInteger(calls.at(-1).at),true);
});

test("city guide cross-links omit unverified, ambiguous, and noncanonical identities", () => {
  const toronto = { countryCode:"CA",citySlug:"toronto",city:"Toronto",path:"/city/ca/toronto" };
  const scenarios = [
    { name:"not in public registry",rows:[] },
    { name:"wrong country",rows:[{ ...toronto,countryCode:"US" }] },
    { name:"wrong city",rows:[{ ...toronto,citySlug:"ottawa" }] },
    { name:"external URL",rows:[{ ...toronto,path:"https://example.org/city/ca/toronto" }] },
    { name:"noncanonical path",rows:[{ ...toronto,path:"/city/ca/toronto?preview=1" }] },
    { name:"duplicate identity",rows:[toronto,toronto] },
    { name:"unknown region",raw:{ countryCode:"US",country:"United States",city:"Portland",citySlug:"portland" },
      rows:[{ countryCode:"US",citySlug:"portland-oregon",city:"Portland",path:"/city/us/portland-oregon" }] },
  ];
  for (const scenario of scenarios) {
    const raw = cityCollectionFixture(scenario.raw);
    const documents = createPublicCollectionDocumentService({
      repository:fakeRepository({ readCityVenues:()=>raw,readCityConcerts:()=>raw }),
      cityGuideRepository:{ listSitemapCities:()=>scenario.rows,readCopy:()=>({ copy:{ cityGuideLink:"Music guide to {city}" } }) },
    });
    for (const method of ["cityVenuesDocument","cityConcertsDocument"]) {
      assert.equal(documents[method]().relatedLinks.length,1,scenario.name);
    }
  }
});

test("city guide cross-links preserve a confirmed regional identity and tolerate absent metadata", () => {
  const raw = cityCollectionFixture({ countryCode:"US",country:"United States",city:"Portland",citySlug:"portland",region:"OR" });
  const repository = fakeRepository({ readCityVenues:()=>raw });
  const cityGuideRepository = {
    listSitemapCities:()=>[{ countryCode:"US",citySlug:"portland-oregon",city:"Portland",path:"/city/us/portland-oregon" }],
    readCopy:()=>({ copy:{ cityGuideLink:"Music guide to {city}" } }),
  };
  const document = createPublicCollectionDocumentService({ repository,cityGuideRepository:()=>cityGuideRepository }).cityVenuesDocument();
  assert.equal(document.relatedLinks[1].path,"/city/us/portland-oregon");
  assert.equal(createPublicCollectionDocumentService({ repository,cityGuideRepository:()=>null }).cityVenuesDocument().relatedLinks.length,1);
});
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
  assert.equal(second.heading,"Concert venues in Toronto, Canada");
  assert.equal(second.venues[0].path,"/venue/ticketmaster-venue-100");
  assert.equal(second.venues[1].path,"/venue/independent-room");
  assert.equal(second.venues[2].path,null,"an unproven name remains visible text without a dead link");
  assert.deepEqual(second.breadcrumbs.map((crumb) => crumb.name),["Mshpit","Venues","Toronto, Canada - Page 2"]);

  assertItemParity(second,second.venues);
  const rendered = renderPublicDocument(second);
  assert.match(rendered,/Toronto, Canada/);
  assert.match(rendered,/<h1>Concert venues in Toronto, Canada — Page 2<\/h1>/u);
  assert.match(rendered,/Provider Hall/);
  assert.equal(rendered.includes('href="/concerts/ca/toronto"'),true);
  assert.doesNotMatch(rendered,/href="\/venue\/unproven-room"/u);
});

test("city venue directories show licensed venue photos in cards, social metadata, and MusicVenue items", () => {
  const repository = fakeRepository({
    readCityVenues() {
      return {
        kind:"city-venues",countryCode:"CA",country:"Canada",city:"Toronto",citySlug:"toronto",
        page:1,pageSize:12,itemCount:1,venueCount:1,hasNext:false,
        venues:[{
          venue_identity:"name:rogers centre",venue:"Rogers Centre",
          source:null,venue_provider_id:null,venue_region:"Ontario",venue_country:"Canada",
          latest_at:1_725_000_000_000,
        }],
      };
    },
  });
  const document = createPublicCollectionDocumentService({ repository,origin:ORIGIN })
    .cityVenuesDocument({ countryCode:"ca",citySlug:"toronto" });
  const html = renderPublicDocument(document);
  const listItem = itemList(document).itemListElement[0];

  assert.equal(document.imageProvenance,"licensed-venue");
  assert.match(document.image,/^https:\/\/pub-[a-z0-9]+\.r2\.dev\/venues\/licensed\//u);
  assert.equal(listItem.item["@type"],"MusicVenue");
  assert.equal(listItem.item.image,document.venues[0].image);
  assert.match(html,/class="directory-venue-photo"/u);
  assert.match(html,/property="og:image" content="https:\/\/pub-/u);
  assert.match(html,/name="twitter:image" content="https:\/\/pub-/u);
  assert.match(html,/>License<\/a>/u);
  assert.match(html,/Converted to WebP and resized/u);
  assert.doesNotMatch(html,/<div class="directory-venue-fallback"/u);
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
  assert.match(html,/<h1>Concerts in Toronto, Canada<\/h1>/u);
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
  assert.equal(second.title,"Bruno Mars Concert Archive & Reviews - Page 2 | Mshpit");
  assert.equal(second.canonicalPath,"/artist/bruno-mars/concerts/page/2");
  assert.equal(second.previousPath,"/artist/bruno-mars/concerts");
  assert.equal(second.nextPath,null);
  assert.equal(second.relatedPath,"/artist/bruno-mars");
  assert.equal(second.relatedLabel,"Bruno Mars artist profile");
  assert.equal(second.heading,"Bruno Mars concert archive");
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
  const rendered = renderPublicDocument(second);
  assert.equal(rendered.includes('href="/artist/bruno-mars"'),true);
  assert.match(rendered,/<h1>Bruno Mars concert archive — Page 2<\/h1>/u);
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

test("location and artist directory headings escape stored catalogue text", () => {
  const hostileCity = 'City </h1><img src=x onerror="alert(1)">';
  const cityDocument = createPublicCollectionDocumentService({
    origin:ORIGIN,
    repository:fakeRepository({
      readCityVenues:() => ({
        countryCode:"CA",country:"Canada",city:hostileCity,citySlug:"hostile-city",
        page:1,hasNext:false,
        venues:[{ venue_identity:"name:safe hall",venue:"Safe Hall" }],
      }),
    }),
  }).cityVenuesDocument({ countryCode:"ca",citySlug:"hostile-city" });
  const cityHtml = renderPublicDocument(cityDocument);
  assert.doesNotMatch(cityHtml, /<h1>[^<]*<\/h1><img/u);
  assert.match(cityHtml, /&lt;\/h1&gt;&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/u);

  const hostileArtist = 'Artist </h1><script>alert("x")</script>';
  const artistDocument = createPublicCollectionDocumentService({
    origin:ORIGIN,
    repository:fakeRepository({
      readArtistConcerts:() => ({
        artist:{ norm:"hostile",name:hostileArtist,public_slug:"hostile-artist" },
        page:1,hasNext:false,
        concerts:[{
          show_venue:"safe hall",artist:hostileArtist,artist_key:"hostile",venue:"Safe Hall",
          venue_key:"safe hall",date:"2026-08-01",review_count:1,
        }],
      }),
    }),
  }).artistConcertsDocument({ publicSlug:"hostile-artist" });
  const artistHtml = renderPublicDocument(artistDocument);
  assert.doesNotMatch(artistHtml, /<\/h1><script>/u);
  assert.match(artistHtml, /&lt;\/h1&gt;&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/u);
});
