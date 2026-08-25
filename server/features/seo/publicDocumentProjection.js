import { artistPath, profilePath, showPath } from "../../../src/domain/urls.mjs";
import { postMediaStateByPost } from "../../mediaAssets.js";
import { safeOwnedReadyMediaUrl } from "../../publicMedia.js";

const SITE_NAME = "Mshpit";
const DEFAULT_ORIGIN = "https://www.mshpit.com";

function cleanLine(value, maximum = 200) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function cleanBody(value, maximum = 8_000) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maximum);
}

function summary(value, maximum = 160) {
  const text = cleanLine(value, maximum + 80);
  if (text.length <= maximum) return text;
  const sample = text.slice(0, maximum);
  const boundary = sample.lastIndexOf(" ");
  return `${(boundary > maximum * 0.6 ? sample.slice(0, boundary) : sample).trimEnd()}…`;
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function genres(value) {
  const candidates = parseArray(value).length ? parseArray(value) : String(value || "").split(/[,;/|]/);
  return [...new Set(candidates.map((genre) => cleanLine(genre, 60)).filter(Boolean))].slice(0, 8);
}

function count(value) {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function rating(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 5 ? parsed : null;
}

function timestamp(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function isoTimestamp(value) {
  const at = timestamp(value);
  if (at == null) return null;
  const date = new Date(at);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function validDate(value) {
  const date = cleanLine(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function normalizedOrigin(value) {
  try {
    const parsed = new URL(value || DEFAULT_ORIGIN);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return DEFAULT_ORIGIN;
    return parsed.origin;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

function internalPath(value, fallback = "/") {
  const path = typeof value === "string" ? value.trim() : "";
  return path.startsWith("/") && !path.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(path)
    ? path
    : fallback;
}

function absolute(origin, path) {
  return new URL(internalPath(path), `${origin}/`).toString();
}

function canonicalPath(override, fallback) {
  return internalPath(override, internalPath(fallback));
}

function canonicalPostPath(paths, row) {
  return internalPath(paths.post(row), showPath(row.id));
}

function canonicalMemberPath(paths, row) {
  return internalPath(paths.member(row), profilePath(row.u_handle || row.handle));
}

function canonicalArtistPath(paths, row) {
  return internalPath(paths.artist(row), artistPath(row.name));
}

function publicMediaForRows(database, rows, { galleryOnly = false, maxPerPost = 2 } = {}) {
  const safeRows = Array.isArray(rows) ? rows.filter((row) => row?.id && row?.user_id) : [];
  const state = postMediaStateByPost(database, safeRows.map((row) => row.id));
  const result = new Map();

  for (const row of safeRows) {
    if (galleryOnly && !row.photos_public) {
      result.set(row.id, []);
      continue;
    }

    if (state.linkedPostIds.has(row.id)) {
      const assets = (state.assetsByPost.get(row.id) || []).slice(0, maxPerPost).flatMap((asset) => {
        const kind = asset?.kind === "image" || asset?.kind === "video" ? asset.kind : null;
        const url = kind
          ? safeOwnedReadyMediaUrl(database, { ownerId: row.user_id, url: asset.url, kind })
          : null;
        if (!url) return [];
        return [{
          kind,
          url,
          posterUrl: kind === "video" && typeof asset.posterUrl === "string" ? asset.posterUrl : null,
          altText: cleanLine(asset.altText, 500),
          mimeType: cleanLine(asset.mimeType, 100) || null,
          width: count(asset.width) || null,
          height: count(asset.height) || null,
        }];
      });
      result.set(row.id, assets);
      continue;
    }

    const legacy = [];
    for (const candidate of parseArray(row.photos).slice(0, maxPerPost)) {
      const imageUrl = safeOwnedReadyMediaUrl(database, { ownerId: row.user_id, url: candidate, kind: "image" });
      const videoUrl = imageUrl ? null : safeOwnedReadyMediaUrl(database, { ownerId: row.user_id, url: candidate, kind: "video" });
      if (imageUrl) legacy.push({ kind: "image", url: imageUrl, posterUrl: null, altText: "", mimeType: null, width: null, height: null });
      else if (videoUrl) legacy.push({ kind: "video", url: videoUrl, posterUrl: null, altText: "", mimeType: null, width: null, height: null });
    }
    result.set(row.id, legacy);
  }
  return result;
}

function safeProfileImage(database, ownerId, value) {
  return safeOwnedReadyMediaUrl(database, { ownerId, url: value, kind: "image" });
}

function postCard(row, media, paths, { textLimit = 8_000 } = {}) {
  const authorName = cleanLine(row.u_name, 100) || "A Mshpit member";
  const handle = cleanLine(row.u_handle, 40).replace(/^@+/, "");
  return Object.freeze({
    id: String(row.id),
    path: canonicalPostPath(paths, row),
    author: Object.freeze({
      name: authorName,
      handle: handle || null,
      path: handle ? canonicalMemberPath(paths, row) : null,
    }),
    kind: row.kind === "status" ? "status" : "review",
    artist: cleanLine(row.artist, 160) || null,
    artistPath: cleanLine(row.artist, 160) ? internalPath(paths.artist({
      name: row.artist,
      norm: row.artist_key,
      public_slug: row.artist_public_slug,
    }), artistPath({ name: row.artist, public_slug: row.artist_public_slug })) : null,
    venue: cleanLine(row.venue, 180) || null,
    city: cleanLine(row.city, 120) || null,
    showDate: validDate(row.date),
    rating: rating(row.overall),
    text: cleanBody(row.review, textLimit),
    media: Array.isArray(media) ? media : [],
    likes: count(row.like_count),
    comments: count(row.comment_count),
    publishedAt: timestamp(row.created_at),
    modifiedAt: timestamp(row.updated_at) || timestamp(row.created_at),
  });
}

function siteReference(origin) {
  return { "@type": "WebSite", name: SITE_NAME, url: `${origin}/` };
}

export function createPublicDocumentProjector({ database, origin = DEFAULT_ORIGIN, paths = {} } = {}) {
  if (!database?.prepare) throw new TypeError("Public SEO projection requires a database");
  const publicOrigin = normalizedOrigin(origin);
  const publicPaths = Object.freeze({
    artist: typeof paths.artist === "function" ? paths.artist : (row) => artistPath(row),
    member: typeof paths.member === "function" ? paths.member : (row) => profilePath(row.u_handle || row.handle),
    post: typeof paths.post === "function" ? paths.post : (row) => showPath(row.id),
  });

  return Object.freeze({
    home(raw = {}, { canonicalPath: requestedPath = "/" } = {}) {
      const path = canonicalPath(requestedPath, "/");
      const artists = (raw.artists || []).map((row) => Object.freeze({
        name: cleanLine(row.name, 160),
        path: canonicalArtistPath(publicPaths, row),
        genre: genres(row.genre),
        description: summary(row.bio, 220),
        reviewCount: count(row.review_count),
      })).filter((artist) => artist.name);
      // A public feed post is not automatically consent to feature its media on
      // the marketing homepage. The interactive landing reel has its own
      // landing_showcase publication gate; this document stays text-only.
      const posts = (raw.posts || []).map((row) => postCard(row, [], publicPaths, { textLimit: 420 }));
      const description = "Log the concerts that shape your story, share the nights you were there, and discover live music through people whose taste you trust.";
      return Object.freeze({
        kind: "home",
        siteName: SITE_NAME,
        title: "Mshpit — Your life's musical journey",
        description,
        canonicalPath: path,
        canonicalUrl: absolute(publicOrigin, path),
        image: null,
        artists,
        posts,
        jsonLd: [Object.freeze({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: SITE_NAME,
          alternateName: ["PIT", "mshpit.com"],
          url: `${publicOrigin}/`,
          description,
        })],
      });
    },

    artist(raw, { canonicalPath: requestedPath = null } = {}) {
      if (!raw?.artist) return null;
      const source = raw.artist;
      const path = canonicalPath(requestedPath, canonicalArtistPath(publicPaths, source));
      const mediaByPost = publicMediaForRows(database, raw.reviews || [], { galleryOnly: true, maxPerPost: 3 });
      const reviews = (raw.reviews || []).map((row) => postCard(row, mediaByPost.get(row.id), publicPaths));
      const profileOwner = raw.profile?.owner_id || null;
      const avatar = profileOwner ? safeProfileImage(database, profileOwner, raw.profile.avatar_uri) : null;
      const banner = profileOwner ? safeProfileImage(database, profileOwner, raw.profile.banner) : null;
      const fanImage = reviews.flatMap((review) => review.media)
        .map((asset) => asset.kind === "image" ? asset.url : asset.posterUrl)
        .find(Boolean) || null;
      const name = cleanLine(source.name, 160);
      const bio = cleanBody(raw.profile?.bio || source.bio, 2_000);
      const reviewCount = count(raw.stats?.review_count);
      const averageRating = rating(raw.stats?.average_rating);
      const description = summary(bio || `${name} live reviews, fan photos, artist updates and upcoming performances on Mshpit.`);
      const events = (raw.events || []).map((event) => Object.freeze({
        id: String(event.id),
        venue: cleanLine(event.venue, 180) || "Venue to be announced",
        place: cleanLine(event.place, 160) || null,
        date: validDate(event.date),
        soldOut: !!event.sold_out,
      })).filter((event) => event.date);
      const updates = (raw.updates || []).map((update) => Object.freeze({
        id: String(update.id),
        text: cleanBody(update.text, 2_000),
        publishedAt: timestamp(update.created_at),
      })).filter((update) => update.text);
      const entity = {
        // The catalogue currently does not preserve whether an artist is a
        // solo person or a group. A generic Thing is accurate for both; falsely
        // labelling Bruno Mars as a MusicGroup would be worse than less-specific
        // structured data until provider type is persisted.
        "@type": "Thing",
        name,
        url: absolute(publicOrigin, path),
        ...(bio ? { description: bio } : {}),
        ...((avatar || banner || fanImage) ? { image: avatar || banner || fanImage } : {}),
      };
      return Object.freeze({
        kind: "artist",
        siteName: SITE_NAME,
        title: `${name} live — reviews, photos and shows | Mshpit`,
        description,
        canonicalPath: path,
        canonicalUrl: absolute(publicOrigin, path),
        image: banner || avatar || fanImage,
        artist: Object.freeze({ name, bio, genres: genres(source.genre), country: cleanLine(source.country, 100) || null, formed: cleanLine(source.formed, 80) || null }),
        stats: Object.freeze({ reviewCount, averageRating }),
        reviews,
        updates,
        events,
        jsonLd: [Object.freeze({
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: `${name} on Mshpit`,
          url: absolute(publicOrigin, path),
          description,
          ...(isoTimestamp(Math.max(timestamp(source.updated_at) || 0, timestamp(raw.profile?.updated_at) || 0, timestamp(raw.stats?.latest_at) || 0))
            ? { dateModified: isoTimestamp(Math.max(timestamp(source.updated_at) || 0, timestamp(raw.profile?.updated_at) || 0, timestamp(raw.stats?.latest_at) || 0)) }
            : {}),
          about: entity,
          isPartOf: siteReference(publicOrigin),
        })],
      });
    },

    member(raw, { canonicalPath: requestedPath = null } = {}) {
      if (!raw?.member) return null;
      const source = raw.member;
      const path = canonicalPath(requestedPath, canonicalMemberPath(publicPaths, source));
      // A profile is an aggregate gallery context. Respect the member's
      // explicit artist/profile-gallery opt-out even though the attachment
      // remains visible on its original post page.
      const mediaByPost = publicMediaForRows(database, raw.posts || [], { galleryOnly: true });
      const posts = (raw.posts || []).map((row) => postCard(row, mediaByPost.get(row.id), publicPaths));
      const name = cleanLine(source.name, 100) || "Mshpit member";
      const handle = cleanLine(source.handle, 40).replace(/^@+/, "");
      const bio = cleanBody(source.bio, 2_000);
      const avatar = safeProfileImage(database, source.id, source.avatar_uri);
      const banner = safeProfileImage(database, source.id, source.banner);
      const description = summary(bio || `${name} shares live music memories and recommendations on Mshpit.`);
      const person = {
        "@type": "Person",
        name,
        ...(handle ? { alternateName: `@${handle}` } : {}),
        url: absolute(publicOrigin, path),
        ...(bio ? { description: bio } : {}),
        ...(avatar ? { image: avatar } : {}),
      };
      return Object.freeze({
        kind: "member",
        siteName: SITE_NAME,
        title: `${name}${handle ? ` (@${handle})` : ""} | Mshpit`,
        description,
        canonicalPath: path,
        canonicalUrl: absolute(publicOrigin, path),
        image: banner || avatar || posts.flatMap((post) => post.media).find((asset) => asset.kind === "image")?.url || null,
        member: Object.freeze({ name, handle: handle || null, bio, avatar, banner, artistName: cleanLine(source.artist_name, 160) || null }),
        stats: Object.freeze({ postCount: count(raw.stats?.post_count), followerCount: count(raw.stats?.follower_count) }),
        posts,
        jsonLd: [Object.freeze({
          "@context": "https://schema.org",
          "@type": "ProfilePage",
          name: `${name} on Mshpit`,
          url: absolute(publicOrigin, path),
          description,
          mainEntity: person,
          isPartOf: siteReference(publicOrigin),
        })],
      });
    },

    post(raw, { canonicalPath: requestedPath = null } = {}) {
      if (!raw?.post) return null;
      const source = raw.post;
      const path = canonicalPath(requestedPath, canonicalPostPath(publicPaths, source));
      const media = publicMediaForRows(database, [source], { maxPerPost: 8 }).get(source.id) || [];
      const card = postCard(source, media, publicPaths);
      const comments = (raw.comments || []).map((comment) => {
        const handle = cleanLine(comment.u_handle, 40).replace(/^@+/, "");
        return Object.freeze({
          id: String(comment.id),
          text: cleanBody(comment.text, 2_000),
          author: Object.freeze({
            name: cleanLine(comment.u_name, 100) || "Mshpit member",
            handle: handle || null,
            path: handle ? internalPath(publicPaths.member({ handle, u_handle: handle }), profilePath(handle)) : null,
            avatar: safeProfileImage(database, comment.user_id, comment.u_avatar),
          }),
          publishedAt: timestamp(comment.created_at),
        });
      }).filter((comment) => comment.text);
      const isReview = card.kind === "review" && !!card.artist;
      const headline = isReview
        ? `${card.artist}${card.venue ? ` at ${card.venue}` : ""} — ${card.author.name}'s review`
        : `${card.author.name} on Mshpit`;
      const description = summary(card.text || `${headline}.`);
      const imageUrls = media.flatMap((asset) => asset.kind === "image" ? [asset.url] : (asset.posterUrl ? [asset.posterUrl] : []));
      const posting = {
        "@context": "https://schema.org",
        "@type": "SocialMediaPosting",
        headline,
        articleBody: card.text,
        url: absolute(publicOrigin, path),
        author: {
          "@type": "Person",
          name: card.author.name,
          ...(card.author.handle ? { alternateName: `@${card.author.handle}` } : {}),
          ...(card.author.path ? { url: absolute(publicOrigin, card.author.path) } : {}),
        },
        ...(isoTimestamp(card.publishedAt) ? { datePublished: isoTimestamp(card.publishedAt) } : {}),
        ...(isoTimestamp(card.modifiedAt) ? { dateModified: isoTimestamp(card.modifiedAt) } : {}),
        ...(card.artist ? { about: { "@type": "Thing", name: card.artist, ...(card.artistPath ? { url: absolute(publicOrigin, card.artistPath) } : {}) } } : {}),
        ...(imageUrls.length ? { image: imageUrls } : {}),
        interactionStatistic: [
          { "@type": "InteractionCounter", interactionType: "https://schema.org/LikeAction", userInteractionCount: card.likes },
          { "@type": "InteractionCounter", interactionType: "https://schema.org/CommentAction", userInteractionCount: card.comments },
        ],
        isPartOf: siteReference(publicOrigin),
      };
      return Object.freeze({
        kind: "post",
        siteName: SITE_NAME,
        title: `${headline} | Mshpit`,
        description,
        canonicalPath: path,
        canonicalUrl: absolute(publicOrigin, path),
        image: imageUrls[0] || null,
        post: card,
        comments,
        jsonLd: [Object.freeze(posting)],
      });
    },
  });
}
