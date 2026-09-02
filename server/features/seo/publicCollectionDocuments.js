import {
  artistConcertsPath,
  artistPath,
  cityConcertsPath,
  cityVenuesPath,
  concertPath,
  venuePath,
} from "../../../src/domain/urls.mjs";
import { archiveShowKey } from "../artistArchive/artistArchiveKeys.js";
import { isStrictCalendarDate } from "./publicEntityPolicy.js";
import { createPublicCollectionRepository } from "./publicCollectionRepository.js";

const SITE_NAME = "Mshpit";
const DEFAULT_ORIGIN = "https://www.mshpit.com";

function cleanLine(value, maximum = 200) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
}
function normalizedOrigin(value) {
  try {
    const parsed = new URL(value || DEFAULT_ORIGIN);
    if (!["http:","https:"].includes(parsed.protocol) || parsed.username || parsed.password) return DEFAULT_ORIGIN;
    return parsed.origin;
  } catch {
    return DEFAULT_ORIGIN;
  }
}
const absolute = (origin,path) => new URL(path,`${origin}/`).toString();
const safeCount = (value) => Math.max(0,Math.trunc(Number(value) || 0));
const safeRating = (value,count) => {
  const rating = Number(value);
  return count > 0 && Number.isFinite(rating) && rating >= 1 && rating <= 5 ? rating : null;
};
const safeTimestamp = (value) => {
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : null;
};
const validDate = (value) => {
  const date = cleanLine(value,10);
  return isStrictCalendarDate(date) ? date : null;
};
const pageSuffix = (page) => page > 1 ? ` - Page ${page}` : "";
const freezeRows = (rows) => Object.freeze(rows.map((row) => Object.freeze(row)));

function breadcrumbNode(origin,breadcrumbs) {
  return Object.freeze({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbs.map((crumb,index) => Object.freeze({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absolute(origin,crumb.path),
    })),
  });
}
function collectionNode({ origin,path,name,description,items }) {
  return Object.freeze({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${absolute(origin,path)}#page`,
    name,
    url: absolute(origin,path),
    description,
    isPartOf: Object.freeze({
      "@type": "WebSite","@id": `${absolute(origin,"/")}#website`,
      name: SITE_NAME,url: absolute(origin,"/"),
    }),
    publisher: Object.freeze({
      "@type": "Organization","@id": `${absolute(origin,"/")}#organization`,
      name: SITE_NAME,url: absolute(origin,"/"),
    }),
    mainEntity: Object.freeze({
      "@type": "ItemList",
      numberOfItems: items.length,
      itemListElement: items.map((item,index) => Object.freeze({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        ...(item.path ? { url: absolute(origin,item.path) } : {}),
      })),
    }),
  });
}
function metadata({ origin,path,title,description }) {
  return {
    siteName: SITE_NAME,
    title,
    description,
    canonicalPath: path,
    canonicalUrl: absolute(origin,path),
    image: null,
    indexable: true,
  };
}

function venueItem(row,identity) {
  const name = cleanLine(row?.venue,180);
  if (!name) return null;
  const providerVenueId = cleanLine(row?.venue_provider_id,160);
  const source = cleanLine(row?.source,80);
  const venueIdentity = cleanLine(row?.venue_identity,360);
  const providerStable = !!providerVenueId && venueIdentity.startsWith("provider:");
  const nameStable = !providerVenueId && venueIdentity.startsWith("name:");
  const path = providerStable
    ? venuePath({ name,providerVenueId,source })
    : nameStable ? venuePath(name) : null;
  const region = cleanLine(row?.venue_region,120);
  const country = cleanLine(row?.venue_country,120) || identity.country;
  return Object.freeze({
    name,path,
    place: cleanLine([identity.city,region,country].filter(Boolean).join(", "),180) || null,
    reviewCount: 0,
    featuredArtist: null,
    featuredArtistPath: null,
    featuredEvent: null,
    modifiedAt: safeTimestamp(row?.latest_at),
  });
}
function concertItem(row,{ city = null,knownArtist = null } = {}) {
  const date = validDate(row?.date);
  const artist = cleanLine(row?.artist,160);
  const venue = cleanLine(row?.venue,180);
  if (!date || !artist || !venue) return null;
  const key = archiveShowKey({
    artistIdentity: row?.artist_key || row?.show_artist || artist,
    venueIdentity: row?.venue_key || row?.show_venue || venue,
    date,
  });
  const publicSlug = knownArtist?.public_slug || cleanLine(row?.artist_public_slug,160);
  const artistPage = publicSlug ? artistPath({ name: artist,publicSlug }) : null;
  const ratingCount = safeCount(row?.rating_count);
  return Object.freeze({
    key,
    path: concertPath(key),
    artist,
    artistPath: artistPage,
    venue,
    // City concert/archive rows do not prove a canonical venue identity.
    // Rendering plain text is safer than manufacturing a dead/merged link.
    venuePath: null,
    city: cleanLine(city ?? row?.city,120) || null,
    date,
    ratingCount,
    reviewCount: safeCount(row?.review_count),
    averageRating: safeRating(row?.average_rating,ratingCount),
    modifiedAt: safeTimestamp(row?.latest_at),
  });
}

function baseDirectory({ kind,page,hasNext,path,pathFor,origin,title,description,breadcrumbs,items,relatedPath,relatedLabel }) {
  const previousPath = page > 1 ? pathFor(page - 1) : null;
  const nextPath = hasNext ? pathFor(page + 1) : null;
  const listItems = items.map((item) => ({
    name: item.name || [item.artist,item.venue].filter(Boolean).join(" at "),
    path: item.path,
  }));
  return Object.freeze({
    kind: "directory",
    directoryKind: kind,
    page,
    hasNext,
    previousPath,
    nextPath,
    ...metadata({ origin,path,title,description }),
    artists: Object.freeze([]),
    events: Object.freeze([]),
    venues: kind === "venues" ? items : Object.freeze([]),
    concerts: kind === "concerts" ? items : Object.freeze([]),
    breadcrumbs,
    relatedPath,
    relatedLabel,
    jsonLd: Object.freeze([
      collectionNode({ origin,path,name:title.replace(/ \| Mshpit$/u,""),description,items:listItems }),
      breadcrumbNode(origin,breadcrumbs),
    ]),
  });
}

export function createPublicCollectionDocumentService({ database,origin = DEFAULT_ORIGIN,repository = null } = {}) {
  const publicOrigin = normalizedOrigin(origin);
  const source = repository || createPublicCollectionRepository(database);

  const service = {
    cityVenuesDocument(options = {}) {
      const raw = source.readCityVenues(options);
      if (!raw) return null;
      const page = raw.page;
      const pathFor = (targetPage) => cityVenuesPath(raw,targetPage);
      const path = pathFor(page);
      const city = cleanLine(raw.city,120);
      const country = cleanLine(raw.country,120) || cleanLine(raw.countryCode,2);
      if (!path || !city || !country) return null;
      const venues = freezeRows((raw.venues || []).slice(0,12).map((row) => venueItem(row,{ city,country })).filter(Boolean));
      if (!venues.length) return null;
      const context = `${city}, ${country}`;
      const title = `Concert Venues in ${context}${pageSuffix(page)} | Mshpit`;
      const description = `Browse live music venues in ${context} with real upcoming Mshpit concert activity${page > 1 ? ` on page ${page}` : ""}.`;
      const breadcrumbs = freezeRows([
        { name:"Mshpit",path:"/" },
        { name:"Venues",path:"/venues" },
        { name:page > 1 ? `${context} - Page ${page}` : context,path },
      ]);
      return baseDirectory({
        kind:"venues",page,hasNext:raw.hasNext === true,path,pathFor,origin:publicOrigin,title,description,
        breadcrumbs,items:venues,
        relatedPath:cityConcertsPath(raw),relatedLabel:`Concerts in ${context}`,
      });
    },

    cityConcertsDocument(options = {}) {
      const raw = source.readCityConcerts(options);
      if (!raw) return null;
      const page = raw.page;
      const pathFor = (targetPage) => cityConcertsPath(raw,targetPage);
      const path = pathFor(page);
      const city = cleanLine(raw.city,120);
      const country = cleanLine(raw.country,120) || cleanLine(raw.countryCode,2);
      if (!path || !city || !country) return null;
      const concerts = freezeRows((raw.concerts || []).slice(0,12)
        .map((row) => concertItem(row,{ city })).filter(Boolean));
      if (!concerts.length) return null;
      const context = `${city}, ${country}`;
      const title = `Concerts in ${context}: Reviews & Ratings${pageSuffix(page)} | Mshpit`;
      const description = `Explore real concert nights in ${context} documented by Mshpit fans with reviews and live-performance ratings${page > 1 ? ` on page ${page}` : ""}.`;
      const breadcrumbs = freezeRows([
        { name:"Mshpit",path:"/" },
        { name:"Concert archive",path:"/concerts" },
        { name:page > 1 ? `${context} - Page ${page}` : context,path },
      ]);
      return baseDirectory({
        kind:"concerts",page,hasNext:raw.hasNext === true,path,pathFor,origin:publicOrigin,title,description,
        breadcrumbs,items:concerts,
        relatedPath:cityVenuesPath(raw),relatedLabel:`Venues in ${context}`,
      });
    },

    artistConcertsDocument(options = {}) {
      const raw = source.readArtistConcerts(options);
      if (!raw) return null;
      const page = raw.page;
      const artistName = cleanLine(raw.artist?.name,160);
      const publicSlug = cleanLine(raw.artist?.public_slug,160);
      const artistPage = publicSlug ? artistPath({ name:artistName,publicSlug }) : null;
      const pathFor = (targetPage) => artistConcertsPath(publicSlug,targetPage);
      const path = pathFor(page);
      if (!artistName || !artistPage || !path) return null;
      const concerts = freezeRows((raw.concerts || []).slice(0,12)
        .map((row) => concertItem(row,{ knownArtist:raw.artist })).filter(Boolean));
      if (!concerts.length) return null;
      const title = `${artistName} Concert Archive & Reviews${pageSuffix(page)} | Mshpit`;
      const description = `Browse ${artistName}'s real concert history documented by Mshpit fans, including live reviews and ratings${page > 1 ? ` on page ${page}` : ""}.`;
      const breadcrumbs = freezeRows([
        { name:"Mshpit",path:"/" },
        { name:"Artists",path:"/artists" },
        { name:artistName,path:artistPage },
        { name:page > 1 ? `Concert archive - Page ${page}` : "Concert archive",path },
      ]);
      return baseDirectory({
        kind:"concerts",page,hasNext:raw.hasNext === true,path,pathFor,origin:publicOrigin,title,description,
        breadcrumbs,items:concerts,relatedPath:artistPage,relatedLabel:`${artistName} artist profile`,
      });
    },

    documentFor(request = {}) {
      if (request.kind === "city-venues") return service.cityVenuesDocument(request);
      if (request.kind === "city-concerts") return service.cityConcertsDocument(request);
      if (request.kind === "artist-concerts") return service.artistConcertsDocument(request);
      return null;
    },
  };
  return Object.freeze(service);
}

export { createPublicCollectionRepository };
