import { randomUUID } from "node:crypto";
import { artistPath, eventPath, postPath, slugify, venuePath } from "../../../src/domain/urls.mjs";
import { canonicalVenueKey } from "../../../src/domain/venueIdentity.mjs";
import { activeAccountSql } from "../../accountVisibility.js";
import { publicArtistPhoto } from "../../artistPhotoCatalog.js";
import { publicVenuePhotoPool } from "../../venuePhotoCatalog.js";
import { publicTicketmasterEventImage } from "../../providerEventImage.js";
import { currentOrUpcomingTourDateSql } from "../../tourDateLifecycle.js";
import { tourDateHasNoPublishedMemorialSql } from "../../artistMemorialTourDateVisibility.js";
import { inPersonReviewSql } from "../../onlineReviews.js";
import { installPublicMusicEventPolicySql, publicIndexableMusicEventSql, publicMusicEventCandidateSql } from "../seo/publicEntityPolicy.js";
import { DEFAULT_CITY_COPY, EMPTY_CITY_EDITORIAL } from "./cityCopy.js";
import { archiveIdentityPart } from "../artistArchive/artistArchiveKeys.js";
import { cityIdentity, cityHttpsUrl, cityLocalDay, validateCityCopy, validateCityEditorial } from "./cityValidation.js";

const DAY = 86_400_000;
// Only public directory metadata is shared. Viewer-filtered galleries never enter this cache.
const registryCaches=new WeakMap();
const bounded = (value, fallback, maximum) => Number.isSafeInteger(Number(value)) && Number(value)>0 ? Math.min(Number(value),maximum) : fallback;
const parseObject = (value) => { try { const parsed = JSON.parse(value || "{}"); return parsed && !Array.isArray(parsed) && typeof parsed === "object" ? parsed : {}; } catch { return {}; } };
const publicTour = (alias,owner) => `${alias}.release_at<=?1 AND ${publicMusicEventCandidateSql(alias)} AND ${publicIndexableMusicEventSql(alias)}
  AND (${alias}.owner_id IS NULL OR ${activeAccountSql(owner)})
  AND (${alias}.owner_id IS NOT NULL OR COALESCE(${alias}.provider_active,1)=1 OR ${alias}.date<?2)`;
const cityWhere = (alias) => `TRIM(COALESCE(${alias}.venue_city,''))<>''
  AND UPPER(TRIM(${alias}.venue_country_code))=?3
  AND lower(trim(${alias}.venue_city)) IN (SELECT value FROM json_each(?6))
  AND pit_city_identity(${alias}.venue_country_code,${alias}.venue_city,${alias}.venue_region)=?4`;
const structured = (alias) => `TRIM(COALESCE(${alias}.venue_city,''))<>'' AND UPPER(TRIM(${alias}.venue_country_code)) GLOB '[A-Z][A-Z]'
  AND LENGTH(TRIM(${alias}.venue_country_code))=2 AND pit_city_identity(${alias}.venue_country_code,${alias}.venue_city,${alias}.venue_region)<>''`;
const photoProjection = (photo) => photo ? { url: photo.uri,alt: photo.title || "",credit: photo.by || "",
  sourceUrl: photo.sourcePage || "",licenseUrl: photo.licenseUrl || "" } : null;

export function createCityGuideRepository(database) {
  if (!database?.prepare) throw new TypeError("City guides require a database");
  database.function?.("pit_public_slug", { deterministic: true }, slugify);
  database.function?.("pit_artist_identity", { deterministic: true }, archiveIdentityPart);
  database.function?.("pit_city_identity", { deterministic: true }, (code,city,region)=>cityIdentity(code,city,region)?.citySlug || "");
  installPublicMusicEventPolicySql(database);
  const profile = database.prepare("SELECT * FROM city_profiles WHERE country_code=? AND city_slug=?");
  const copyRow = database.prepare("SELECT * FROM city_site_copy WHERE id='city'");
  const registryQuery = database.prepare(`WITH located_tours AS MATERIALIZED (
    SELECT td.*,UPPER(TRIM(td.venue_country_code)) AS city_country_code,
      pit_city_identity(td.venue_country_code,td.venue_city,td.venue_region) AS resolved_city_slug
    FROM tour_dates td LEFT JOIN users owner ON owner.id=td.owner_id
    WHERE TRIM(COALESCE(td.venue_city,''))<>'' AND UPPER(TRIM(td.venue_country_code)) GLOB '[A-Z][A-Z]'
      AND LENGTH(TRIM(td.venue_country_code))=2 AND ${publicTour("td","owner")}
  ), public_city_tours AS MATERIALIZED (
    SELECT * FROM located_tours WHERE resolved_city_slug<>''
  ), city_rows AS (
    SELECT cv.country_code,cv.city_slug,cv.city,cv.country,0 AS updated_at,cv.region FROM city_catalog_venues cv
      WHERE pit_city_identity(cv.country_code,cv.city,cv.region)=cv.city_slug
    UNION ALL SELECT cp.country_code,cp.city_slug,cp.city,cp.country,cp.updated_at,cp.region FROM city_profiles cp
      WHERE pit_city_identity(cp.country_code,cp.city,cp.region)=cp.city_slug
    UNION ALL SELECT td.city_country_code,td.resolved_city_slug,TRIM(td.venue_city),
      COALESCE(td.venue_country,''),td.updated_at,COALESCE(td.venue_region,'') FROM public_city_tours td
  ), venue_rows AS (
    SELECT cv.country_code,cv.city_slug,lower(trim(cv.name)) AS name FROM city_catalog_venues cv
      WHERE pit_city_identity(cv.country_code,cv.city,cv.region)=cv.city_slug
    UNION SELECT td.city_country_code,td.resolved_city_slug,lower(trim(td.venue))
      FROM public_city_tours td WHERE TRIM(COALESCE(td.venue,''))<>''
  ), venue_counts AS (
    SELECT country_code,city_slug,COUNT(*) AS venue_count FROM venue_rows GROUP BY country_code,city_slug
  ), upcoming_counts AS (
    SELECT td.city_country_code AS country_code,td.resolved_city_slug AS city_slug,
      COUNT(DISTINCT lower(trim(td.artist))||char(31)||lower(trim(td.venue))||char(31)||td.date) AS upcoming_count
      FROM public_city_tours td WHERE ${currentOrUpcomingTourDateSql("td","?2")}
        AND ${tourDateHasNoPublishedMemorialSql("td")}
      GROUP BY country_code,city_slug
  ) SELECT cr.country_code,cr.city_slug,MIN(cr.city) AS city,MAX(cr.country) AS country,MAX(cr.updated_at) AS updated_at,
      COALESCE(vc.venue_count,0) AS venue_count,COALESCE(uc.upcoming_count,0) AS upcoming_count,
      cp.editorial_json,cp.revision,json_group_array(DISTINCT lower(trim(cr.city))) AS city_aliases,MAX(cr.region) AS region
    FROM city_rows cr LEFT JOIN venue_counts vc ON vc.country_code=cr.country_code AND vc.city_slug=cr.city_slug
    LEFT JOIN upcoming_counts uc ON uc.country_code=cr.country_code AND uc.city_slug=cr.city_slug
    LEFT JOIN city_profiles cp ON cp.country_code=cr.country_code AND cp.city_slug=cr.city_slug
    GROUP BY cr.country_code,cr.city_slug ORDER BY upcoming_count DESC,venue_count DESC,city COLLATE NOCASE,cr.country_code`);
  const venueQuery = database.prepare(`SELECT td.venue,td.source,td.venue_provider_id,td.venue_city,td.venue_country,
    COUNT(DISTINCT CASE WHEN ${currentOrUpcomingTourDateSql("td","?2")} AND ${tourDateHasNoPublishedMemorialSql("td")}
      THEN lower(trim(td.artist))||char(31)||td.date END) AS upcoming_count,
    MIN(td.date) AS first_date FROM tour_dates td LEFT JOIN users owner ON owner.id=td.owner_id
    WHERE ${cityWhere("td")} AND ${publicTour("td","owner")} AND TRIM(COALESCE(td.venue,''))<>''
    GROUP BY lower(trim(td.venue)),td.source,td.venue_provider_id
    ORDER BY upcoming_count DESC,td.venue COLLATE NOCASE LIMIT 200`);
  const curatedVenues = database.prepare("SELECT * FROM city_catalog_venues WHERE country_code=? AND city_slug=? ORDER BY capacity DESC,name LIMIT 200");
  const eventQuery = database.prepare(`SELECT td.* FROM tour_dates td LEFT JOIN users owner ON owner.id=td.owner_id
    WHERE ${cityWhere("td")} AND ${publicTour("td","owner")} AND ${currentOrUpcomingTourDateSql("td","?2")}
      AND ${tourDateHasNoPublishedMemorialSql("td")}
    ORDER BY td.date,COALESCE(td.start_local_time,''),td.id LIMIT 240`);
  const artistByKey = database.prepare("SELECT norm,name,public_slug,mbid FROM artists WHERE norm=?");
  const artistByName = database.prepare("SELECT norm,name,public_slug,mbid FROM artists WHERE name=? COLLATE NOCASE LIMIT 2");
  const artistsQuery = database.prepare(`SELECT a.norm,a.name,a.public_slug,a.mbid,
    COUNT(DISTINCT lower(trim(td.venue))||char(31)||td.date) AS show_count
    FROM tour_dates td JOIN artists a ON a.norm=td.artist_key LEFT JOIN users owner ON owner.id=td.owner_id
    WHERE ${cityWhere("td")} AND ${publicTour("td","owner")}
    GROUP BY a.norm ORDER BY show_count DESC,a.rank_score DESC,a.name COLLATE NOCASE LIMIT 12`);
  const fanPhotos = database.prepare(`SELECT p.id AS post_id,p.artist,p.venue,p.date,p.created_at,v.public_url,v.width,v.height,
      a.alt_text, a.id AS asset_id
    FROM posts p JOIN users u ON u.id=p.user_id
    JOIN post_media pm ON pm.post_id=p.id JOIN media_assets a ON a.id=pm.asset_id AND a.owner_id=p.user_id
    JOIN media_objects source_object ON source_object.owner_id=a.owner_id AND source_object.object_key=a.source_key
    JOIN media_variants v ON v.id=a.render_variant_id AND v.asset_id=a.id AND v.role='render'
    JOIN media_objects render_object ON render_object.owner_id=a.owner_id AND render_object.object_key=v.object_key
    WHERE p.removed=0 AND p.photos_public=1 AND ${inPersonReviewSql("p")} AND ${activeAccountSql("u")}
      AND u.profile_audience='everyone'
      AND a.kind='image' AND a.status='ready' AND a.source_verified_at IS NOT NULL
      AND a.metadata_status='declared' AND a.codec_status='not_applicable'
      AND source_object.status IN ('issued','associated') AND a.render_state='ready'
      AND v.status='verified' AND v.verification_origin='private_derivative_v1'
      AND render_object.storage_scope='public' AND render_object.status IN ('issued','associated')
      AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.target_id IN (p.id,a.id) AND r.status='open')
      AND (?5 IS NULL OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=?5 AND b.blocked_id=p.user_id) OR (b.blocked_id=?5 AND b.blocker_id=p.user_id)))
      AND (EXISTS (SELECT 1 FROM tour_dates td LEFT JOIN users owner ON owner.id=td.owner_id
        WHERE ${cityWhere("td")} AND ${publicTour("td","owner")}
          AND lower(trim(td.venue))=lower(trim(p.venue)) AND td.date=p.date
          AND ((p.artist_key IS NOT NULL AND td.artist_key=p.artist_key) OR
            (p.artist_key IS NULL AND lower(trim(td.artist))=lower(trim(p.artist)))))
        OR EXISTS (SELECT 1 FROM city_catalog_venues cv
          WHERE cv.country_code=?3 AND cv.city_slug=?4
            AND (cv.venue_key=p.venue_key OR (p.venue_key IS NULL AND cv.name=p.venue COLLATE NOCASE))
            AND NOT EXISTS (SELECT 1 FROM city_catalog_venues collision
              WHERE collision.name=cv.name COLLATE NOCASE
                AND (collision.country_code<>cv.country_code OR collision.city_slug<>cv.city_slug))))
      AND NOT EXISTS (SELECT 1 FROM tour_dates other LEFT JOIN users other_owner ON other_owner.id=other.owner_id
        WHERE ${publicTour("other","other_owner")} AND TRIM(COALESCE(other.venue_city,''))<>''
          AND UPPER(TRIM(other.venue_country_code)) GLOB '[A-Z][A-Z]' AND LENGTH(TRIM(other.venue_country_code))=2
          AND lower(trim(other.venue))=lower(trim(p.venue)) AND other.date=p.date
          AND lower(trim(other.artist))=lower(trim(p.artist)) AND NOT (${cityWhere("other")}))
    ORDER BY p.created_at DESC,p.id DESC,pm.position LIMIT 48`);
  function registry(at = Date.now()) {
    const day = cityLocalDay(at);
    const registryCache=registryCaches.get(database);
    if (registryCache && registryCache.day===day && at-registryCache.at>=0 && at-registryCache.at<60_000) return registryCache.cities;
    const rows = registryQuery.all(at,day).map((row) => {
      const identity = cityIdentity(row.country_code,row.city,row.region);
      const editorial = parseObject(row.editorial_json);
      return { ...identity,aliases:JSON.parse(row.city_aliases),country:row.country || new Intl.DisplayNames(["en"],{ type:"region" }).of(row.country_code),
        venueCount:Number(row.venue_count || 0),upcomingCount:Number(row.upcoming_count || 0),
        hasEditorial:[editorial.intro,editorial.history,editorial.influence].some((value) => String(value || "").trim().length >= 80),updatedAt:Number(row.updated_at || 0),revision:Number(row.revision || 0) };
    });
    registryCaches.set(database,{ at,day,cities:rows });
    return rows;
  }
  function readCopy() {
    const row = copyRow.get();
    return { copy:{ ...DEFAULT_CITY_COPY,...parseObject(row?.copy_json) },revision:Number(row?.revision || 0),updatedAt:Number(row?.updated_at || 0) };
  }
  function listCities({ q="",country="",limit=30,cursor=null,at=Date.now() } = {}) {
    const query = String(q || "").trim().toLowerCase().slice(0,160),code=String(country || "").trim().toUpperCase();
    const offset = /^\d{1,7}$/u.test(String(cursor ?? "")) ? Number(cursor) : 0;
    const all = registry(at).filter((row) => (!code || row.countryCode===code)
      && (!query || `${row.city} ${row.country} ${row.citySlug}`.toLowerCase().includes(query)));
    const count=bounded(limit,30,100),cities=all.slice(offset,offset+count);
    return { cities,nextCursor:offset+count<all.length ? String(offset+count) : null,total:all.length };
  }
  function getGuide({countryCode,citySlug,viewerId=null,at=Date.now()} = {}) {
    const code=String(countryCode || "").toUpperCase(),slug=String(citySlug || "").toLowerCase();
    const city=registry(at).find((row) => row.countryCode===code && row.citySlug===slug);
    if (!city) return null;
    const row=profile.get(code,slug),editorial={...EMPTY_CITY_EDITORIAL,...parseObject(row?.editorial_json)};
    const earliest=cityLocalDay(at-DAY),args=[at,earliest,code,slug,viewerId,JSON.stringify(city.aliases)];
    const venueMap=new Map();
    for (const venue of curatedVenues.all(code,slug)) {
      const photo=photoProjection(publicVenuePhotoPool(venue.name,{limit:1})[0]);
      venueMap.set(canonicalVenueKey(venue.name),{name:venue.name,key:venue.venue_key,path:venuePath(venue.name),city:city.city,
        countryCode:city.countryCode,place:[city.city,city.country].filter(Boolean).join(", "),photo,upcomingCount:0,capacity:venue.capacity || null});
    }
    for (const venue of venueQuery.all(at,cityLocalDay(at,editorial.timeZone || "UTC"),code,slug,viewerId,args[5])) {
      const key=canonicalVenueKey(venue.venue),prior=venueMap.get(key),photo=photoProjection(publicVenuePhotoPool(venue.venue,
        {limit:1,source:venue.source,providerVenueId:venue.venue_provider_id})[0]);
      venueMap.set(key,{...prior,name:venue.venue,key,path:venuePath({name:venue.venue,source:venue.source,providerVenueId:venue.venue_provider_id}),
        source:venue.source,providerVenueId:venue.venue_provider_id,city:city.city,countryCode:city.countryCode,
        place:[city.city,city.country].filter(Boolean).join(", "),photo:photo || prior?.photo || null,
        upcomingCount:Math.max(prior?.upcomingCount || 0,Number(venue.upcoming_count || 0))});
    }
    const venues=[...venueMap.values()].sort((a,b) => b.upcomingCount-a.upcomingCount || (b.capacity || 0)-(a.capacity || 0) || a.name.localeCompare(b.name));
    const seenEvents=new Set(),today=[],upcoming=[];
    for (const event of eventQuery.all(...args)) {
      const zone=event.event_timezone || editorial.timeZone || "UTC",localDay=cityLocalDay(at,zone);
      const end=event.event_end_date || event.date;
      if (end<localDay) continue;
      const identity=`${event.artist.toLowerCase()}|${event.venue.toLowerCase()}|${event.date}`;
      if (seenEvents.has(identity)) continue;
      seenEvents.add(identity);
      const image=publicTicketmasterEventImage(event);
      const item={id:event.id,artist:event.artist,artistKey:event.artist_key || null,eventName:event.event_name || event.artist,
        date:event.date,endDate:event.event_end_date || null,startLocalTime:event.start_local_time || null,
        timeZone:zone,venue:event.venue,venuePath:venuePath({name:event.venue,source:event.source,providerVenueId:event.venue_provider_id}),
        path:eventPath(event.id),image:image?.uri || null,url:cityHttpsUrl(event.ticket_url) || null};
      if (event.date<=localDay && end>=localDay && today.length<48) today.push(item);
      if (upcoming.length<80) upcoming.push(item);
    }
    const toArtist=(artist,detail={})=>({name:artist.name,key:artist.norm,publicSlug:artist.public_slug,path:artistPath(artist),
      image:publicArtistPhoto(artist.norm,{artistMbid:artist.mbid})?.uri || null,showCount:Number(artist.show_count || 0),...detail});
    const artists=[],artistKeys=new Set();
    for (const item of editorial.artists || []) {
      const candidates=item.artistKey ? [artistByKey.get(item.artistKey)].filter(Boolean) : artistByName.all(item.name);
      const artist=candidates.length===1 ? candidates[0] : null;
      const identity=artist?.norm || item.name.toLowerCase();
      if (artistKeys.has(identity)) continue;
      artistKeys.add(identity);
      artists.push(artist ? toArtist(artist,{description:item.description,sourceUrl:item.sourceUrl,local:true})
        : {name:item.name,key:null,path:null,image:null,showCount:0,description:item.description,sourceUrl:item.sourceUrl,local:true});
    }
    const performingArtists=artistsQuery.all(...args).map((artist) => toArtist(artist,{local:false}));
    const photos=[],seenPhotos=new Set();
    for (const photo of fanPhotos.all(...args)) {
      const url=cityHttpsUrl(photo.public_url);
      if (!url || seenPhotos.has(url)) continue;
      seenPhotos.add(url);
      photos.push({url,alt:photo.alt_text || `${photo.artist} at ${photo.venue}`,kind:"fan",postId:photo.post_id,path:postPath(photo.post_id),width:photo.width,height:photo.height});
      if (photos.length>=12) break;
    }
    if (editorial.stockImage?.url && !seenPhotos.has(editorial.stockImage.url)) photos.push({...editorial.stockImage,kind:"city"});
    return {city,editorial,venues,venueHasMore:city.venueCount>venues.length,artists,performingArtists,today,upcoming,photos,
      copy:readCopy().copy,revision:Number(row?.revision || 0),updatedAt:Number(row?.updated_at || 0),localDate:cityLocalDay(at,editorial.timeZone || "UTC")};
  }
  const audit=database.prepare(`INSERT INTO moderation_actions
    (id,actor_id,action,target_type,target_id,reason,prior_state,next_state,request_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  function transaction(fn) {
    database.exec("SAVEPOINT city_editorial_write");
    try { const result=fn();database.exec("RELEASE city_editorial_write");return result; }
    catch(error) {database.exec("ROLLBACK TO city_editorial_write");database.exec("RELEASE city_editorial_write");throw error;}
  }
  function record({actorId,requestId,at},target,prior,next) {
    audit.run(randomUUID(),actorId,"city_content_update",target==="copy" ? "city_copy" : "city",target,"",
      JSON.stringify(prior),JSON.stringify(next),requestId || null,at);
  }
  return Object.freeze({
    listCities,readCopy,getGuide,
    listSitemapCities({at=Date.now()}={}) {return registry(at).filter((city)=>city.hasEditorial || city.venueCount>0 || city.upcomingCount>0);},
    saveEditorial({countryCode,citySlug,revision,editorial,actorId,requestId=null,at=Date.now()}) {
      const validated=validateCityEditorial(editorial);
      const city=registry(at).find((row)=>row.countryCode===countryCode && row.citySlug===citySlug);
      if (!city) return {notFound:true};
      const result=transaction(()=>{
        const old=profile.get(countryCode,citySlug);
        if (Number(old?.revision || 0)!==revision) return {conflict:true};
        database.prepare(`INSERT INTO city_profiles(country_code,city_slug,city,country,editorial_json,revision,updated_at,updated_by,region)
          VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(country_code,city_slug) DO UPDATE SET
          editorial_json=excluded.editorial_json,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
          .run(countryCode,citySlug,city.city,city.country,JSON.stringify(validated),revision+1,at,actorId,city.region);
        record({actorId,requestId,at},`${countryCode}/${citySlug}`,parseObject(old?.editorial_json),validated);
        return {ok:true};
      });
      registryCaches.delete(database);
      return result;
    },
    saveCopy({revision,copy,actorId,requestId=null,at=Date.now()}) {
      const validated=validateCityCopy(copy);
      return transaction(()=>{
        const old=copyRow.get();
        if (Number(old?.revision || 0)!==revision) return {conflict:true};
        database.prepare(`UPDATE city_site_copy SET copy_json=?,revision=?,updated_at=?,updated_by=? WHERE id='city'`)
          .run(JSON.stringify(validated),revision+1,at,actorId);
        record({actorId,requestId,at},"copy",parseObject(old?.copy_json),validated);
        return {ok:true};
      });
    },
  });
}
