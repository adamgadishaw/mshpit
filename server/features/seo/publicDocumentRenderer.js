const esc = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const safeStructuredJson = (value) => JSON.stringify(value)
  .replace(/</g, "\\u003c")
  .replace(/>/g, "\\u003e")
  .replace(/&/g, "\\u0026")
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

const paragraphs = (value) => String(value || "").split(/\n{2,}/)
  .map((paragraph) => paragraph.trim())
  .filter(Boolean)
  .map((paragraph) => `<p>${esc(paragraph).replace(/\n/g, "<br />")}</p>`)
  .join("");

const publicHref = (value) => {
  const href = String(value || "").trim();
  return href.startsWith("/") && !href.startsWith("//") ? href : null;
};

const publicMediaUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
};

const publicHttpsUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
};

const dateLabel = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const [year, month, day] = String(value).split("-");
  return `${month}/${day}/${year}`;
};

const longDateLabel = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) return null;
  return new Intl.DateTimeFormat("en", {
    year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  }).format(date);
};

const dateTimeLabel = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const date = new Date(parsed);
  if (Number.isNaN(date.valueOf())) return null;
  return {
    iso: date.toISOString(),
    label: new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric" }).format(date),
  };
};

function link(path, label, className = "") {
  const href = publicHref(path);
  return href
    ? `<a${className ? ` class="${esc(className)}"` : ""} href="${esc(href)}">${esc(label)}</a>`
    : esc(label);
}

function breadcrumbs(document) {
  const items = (Array.isArray(document?.breadcrumbs) ? document.breadcrumbs : [])
    .filter((crumb) => publicHref(crumb?.path) && crumb?.name)
    .map((crumb, index, list) => `<li>${index === list.length - 1
      ? `<span aria-current="page">${esc(crumb.name)}</span>`
      : link(crumb.path, crumb.name)}</li>`)
    .join("");
  return items ? `<nav class="breadcrumbs" aria-label="Breadcrumb"><ol>${items}</ol></nav>` : "";
}

function mediaGallery(media, label, { primary = false } = {}) {
  const items = (Array.isArray(media) ? media : []).flatMap((asset, index) => {
    const url = publicMediaUrl(asset?.url);
    if (!url) return [];
    const alt = asset.altText || `${label || "Concert memory"} ${index + 1}`;
    if (asset.kind === "video") {
      const poster = publicMediaUrl(asset.posterUrl);
      const mime = String(asset.mimeType || "").startsWith("video/") ? ` type="${esc(asset.mimeType)}"` : "";
      return [`<figure class="media-item media-video"><video controls preload="${primary && index === 0 ? "metadata" : "none"}" playsinline${poster ? ` poster="${esc(poster)}"` : ""}${asset.width ? ` width="${esc(asset.width)}"` : ""}${asset.height ? ` height="${esc(asset.height)}"` : ""} aria-label="${esc(alt)}"><source src="${esc(url)}"${mime} />Your browser cannot play this video.</video><figcaption>${esc(alt)}</figcaption></figure>`];
    }
    const priority = primary && index === 0;
    return [`<figure class="media-item"><img src="${esc(url)}" alt="${esc(alt)}" loading="${priority ? "eager" : "lazy"}" decoding="async"${priority ? ' fetchpriority="high"' : ""}${asset.width ? ` width="${esc(asset.width)}"` : ""}${asset.height ? ` height="${esc(asset.height)}"` : ""} /><figcaption>${esc(alt)}</figcaption></figure>`];
  });
  return items.length ? `<div class="media-grid">${items.join("")}</div>` : "";
}

function compactPost(post, { full = false } = {}) {
  if (!post) return "";
  const author = post.author?.path
    ? link(post.author.path, post.author.handle ? `@${post.author.handle}` : post.author.name)
    : esc(post.author?.name || "Mshpit member");
  const artist = post.artist && post.artistPath ? link(post.artistPath, post.artist) : esc(post.artist || "");
  const showDate = dateLabel(post.showDate);
  const published = dateTimeLabel(post.publishedAt);
  const venue = post.venue && post.venuePath ? link(post.venuePath, post.venue) : esc(post.venue || "");
  const title = post.kind === "review" && post.artist
    ? `${artist}${post.venue ? ` <span class="muted">at ${venue}</span>` : ""}`
    : `<span>${author} shared an update</span>`;
  const body = full ? paragraphs(post.text) : `<p>${esc(post.text)}</p>`;
  return `<article class="post-card${full ? " post-full" : ""}">
    <header>
      <div><p class="eyebrow">${post.kind === "review" ? "Live review" : "From the community"}</p><h${full ? "1" : "3"}>${title}</h${full ? "1" : "3"}></div>
      ${post.rating != null && post.kind === "review" ? `<p class="rating" aria-label="Rated ${esc(post.rating)} out of 5">${esc(Number(post.rating).toFixed(1))}<span>/5</span></p>` : ""}
    </header>
    <p class="byline">By ${author}${showDate ? ` · <time datetime="${esc(post.showDate)}">${esc(showDate)}</time>` : published ? ` · <time datetime="${esc(published.iso)}">${esc(published.label)}</time>` : ""}</p>
    <div class="post-copy">${body}</div>
    ${mediaGallery(post.media, post.artist || "Concert post", { primary: full })}
    <footer><span>${esc(post.likes)} likes</span><span>${esc(post.comments)} comments</span>${!full && post.path ? link(post.path, "Read the full post", "text-link") : ""}</footer>
  </article>`;
}

function homeMain(document) {
  const artists = document.artists.map((artist) => `<li class="artist-card">
    <p class="eyebrow">${artist.genre.length ? esc(artist.genre.slice(0, 2).join(" · ")) : "Artist page"}</p>
    <h3>${link(artist.path, artist.name)}</h3>
    ${artist.description ? `<p>${esc(artist.description)}</p>` : ""}
    ${artist.reviewCount ? `<p class="micro">${esc(artist.reviewCount)} fan ${artist.reviewCount === 1 ? "review" : "reviews"}</p>` : ""}
  </li>`).join("");
  const posts = document.posts.map((post) => compactPost(post)).join("");
  return `<main id="main">
    <section class="hero">
      <p class="eyebrow">Your life's musical journey</p>
      <h1>Remember every show.<br /><em>Find your people.</em></h1>
      <p class="hero-copy">Log the nights that changed you, share what it really felt like to be there, and discover live music through people whose taste you trust.</p>
      <div class="actions"><a class="button primary" href="/signup">Join Mshpit</a><a class="button" href="/events">Browse upcoming concerts</a></div>
    </section>
    ${artists ? `<section class="section"><div class="section-heading"><div><p class="eyebrow">In the pit now</p><h2>Artists worth exploring</h2></div><a href="/artists">Browse all artists</a></div><ul class="artist-grid">${artists}</ul></section>` : ""}
    ${posts ? `<section class="section"><div class="section-heading"><div><p class="eyebrow">From the crowd</p><h2>Nights people remember</h2></div><a href="/feed">Open the feed</a></div><div class="post-list">${posts}</div></section>` : ""}
  </main>`;
}

function discoverMain(document) {
  const artists = document.artists.map((artist) => `<li class="artist-card">
    <p class="eyebrow">${artist.genre.length ? esc(artist.genre.slice(0, 2).join(" · ")) : "Artist page"}</p>
    <h3>${link(artist.path, artist.name)}</h3>
    ${artist.description ? `<p>${esc(artist.description)}</p>` : ""}
  </li>`).join("");
  const events = document.events.map((event) => `<li><time datetime="${esc(event.startDateTime || event.date)}"><strong>${esc(dateLabel(event.date))}</strong>${event.localTime ? `<small>${esc(event.localTime)}</small>` : ""}</time><div><h3>${link(event.path, event.name)}</h3><p>${link(event.artistPath, event.artist)} · ${link(event.venuePath, event.venue)}${event.place ? ` · ${esc(event.place)}` : ""}</p></div>${event.soldOut ? '<span class="pill">Sold out</span>' : ""}</li>`).join("");
  const posts = document.posts.map((post) => compactPost(post)).join("");
  return `<main id="main">
    ${breadcrumbs(document)}
    <section class="directory-hero"><p class="eyebrow">Explore the live archive</p><h1>Discover music through the people who were there.</h1><p>${esc(document.description)}</p><div class="actions"><a class="button primary" href="/events">Browse upcoming concerts</a><a class="button" href="/artists">Explore artists</a></div></section>
    ${artists ? `<section class="section"><div class="section-heading"><div><p class="eyebrow">Artists on Mshpit</p><h2>Live pages worth exploring</h2></div><a href="/artists">Browse the artist directory</a></div><ul class="artist-grid">${artists}</ul></section>` : ""}
    ${events ? `<section class="section"><div class="section-heading"><div><p class="eyebrow">Coming up</p><h2>Concerts around the world</h2></div><a href="/events">Browse all upcoming concerts</a></div><ol class="event-list">${events}</ol></section>` : ""}
    ${posts ? `<section class="section"><div class="section-heading"><div><p class="eyebrow">From the crowd</p><h2>Fan reviews people are responding to</h2></div></div><div class="post-list">${posts}</div></section>` : ""}
  </main>`;
}

function searchMain(document) {
  return `<main id="main">
    ${breadcrumbs(document)}
    <section class="directory-hero"><p class="eyebrow">Find it on Mshpit</p><h1>Search artists, concerts and people.</h1><p>${esc(document.description)}</p><div class="actions"><a class="button primary" href="/artists">Browse artists</a><a class="button" href="/events">Browse upcoming concerts</a><a class="button" href="/discover">Open Discover</a></div></section>
    <section class="section empty-state"><p class="eyebrow">Interactive search</p><h2>Search across the whole community in the Mshpit app.</h2><p>With JavaScript enabled, this page searches artists, upcoming shows, venues, members and songs in one place. Public artist and event directories remain available through the links above.</p></section>
  </main>`;
}

function artistMain(document) {
  const { artist, stats } = document;
  const events = document.events.map((event) => `<li><time datetime="${esc(event.startDateTime || event.date)}"><strong>${esc(dateLabel(event.date))}</strong>${event.localTime ? `<small>${esc(event.localTime)}</small>` : ""}</time><div><h3>${link(event.path, event.name)}</h3><p>${link(event.venuePath, event.venue)}${event.place ? ` · ${esc(event.place)}` : ""}</p></div>${event.soldOut ? '<span class="pill">Sold out</span>' : event.statusLabel !== "scheduled" ? `<span class="pill">${esc(event.statusLabel)}</span>` : ""}</li>`).join("");
  const concerts = (document.concerts || []).map((concert) => `<li><time datetime="${esc(concert.date)}"><strong>${esc(dateLabel(concert.date))}</strong></time><div><h3>${link(concert.path, concert.venue)}</h3>${concert.city ? `<p>${esc(concert.city)}</p>` : ""}</div><span class="archive-score">${concert.averageRating != null ? `${esc(concert.averageRating.toFixed(1))}/5 · ` : ""}${esc(concert.ratingCount)} ${concert.ratingCount === 1 ? "rating" : "ratings"}</span></li>`).join("");
  const updates = document.updates.map((update) => {
    const date = dateTimeLabel(update.publishedAt);
    return `<article class="update"><p>${esc(update.text)}</p>${date ? `<time datetime="${esc(date.iso)}">${esc(date.label)}</time>` : ""}</article>`;
  }).join("");
  const reviews = document.reviews.map((review) => compactPost(review)).join("");
  const memorialDate = longDateLabel(document.memorial?.deathDate);
  const memorialSource = publicHttpsUrl(document.memorial?.citation?.url);
  const memorialAccomplishments = (Array.isArray(document.memorial?.accomplishments)
    ? document.memorial.accomplishments : [])
    .map((item) => `<li>${esc(item)}</li>`)
    .join("");
  const memorial = document.memorial && memorialDate && memorialSource
    ? `<section class="section memorial" id="memorial" aria-labelledby="memorial-heading">
      <div class="memorial-mark" aria-hidden="true">IN<br>MEMORY</div>
      <div><p class="eyebrow">In remembrance</p><h2 id="memorial-heading">Remembering ${esc(artist.name)}</h2>
      <p class="memorial-date">Died <time datetime="${esc(document.memorial.deathDate)}">${esc(memorialDate)}</time></p>
      <div class="memorial-copy">${paragraphs(document.memorial.summary)}</div>
      ${memorialAccomplishments ? `<div class="memorial-legacy"><h3>Creative legacy</h3><ul>${memorialAccomplishments}</ul></div>` : ""}
      <div class="memorial-thanks"><h3>With gratitude</h3>${paragraphs(document.memorial.thankYou)}</div>
      <p class="memorial-source">Verified source: <a href="${esc(memorialSource)}" rel="noopener noreferrer">${esc(document.memorial.citation.title)}</a></p></div>
    </section>`
    : "";
  return `<main id="main">
    ${breadcrumbs(document)}
    <section class="profile-hero">
      <p class="eyebrow">Artist on Mshpit</p>
      <h1>${esc(artist.name)}</h1>
      ${artist.genres.length ? `<p class="genres">${esc(artist.genres.join(" · "))}</p>` : ""}
      ${artist.bio ? `<div class="bio">${paragraphs(artist.bio)}</div>` : ""}
      <dl class="stats"><div><dt>Fan reviews</dt><dd>${esc(stats.reviewCount)}</dd></div>${stats.averageRating != null ? `<div><dt>Live rating</dt><dd>${esc(stats.averageRating.toFixed(1))}<small>/5</small></dd></div>` : ""}${artist.formed ? `<div><dt>Active since</dt><dd>${esc(artist.formed)}</dd></div>` : ""}</dl>
    </section>
    ${memorial}
    ${events ? `<section class="section"><div class="section-heading"><div><p class="eyebrow">On the road</p><h2>Upcoming shows</h2></div></div><ol class="event-list">${events}</ol></section>` : ""}
    ${concerts ? `<section class="section"><div class="section-heading"><div><p class="eyebrow">From the archive</p><h2>Top-rated concert nights</h2></div></div><ol class="event-list archive-list">${concerts}</ol></section>` : ""}
    ${updates ? `<section class="section"><div class="section-heading"><div><p class="eyebrow">Official notes</p><h2>From ${esc(artist.name)}</h2></div></div><div class="updates">${updates}</div></section>` : ""}
    ${reviews ? `<section class="section"><div class="section-heading"><div><p class="eyebrow">People who were there</p><h2>Top live reviews</h2></div></div><div class="post-list">${reviews}</div></section>` : ""}
  </main>`;
}

function memberMain(document) {
  const { member, stats } = document;
  const avatar = publicMediaUrl(member.avatar);
  const posts = document.posts.map((post) => compactPost(post)).join("");
  return `<main id="main">
    ${breadcrumbs(document)}
    <section class="profile-hero member-hero">
      ${avatar ? `<img class="avatar" src="${esc(avatar)}" alt="${esc(member.name)}" width="112" height="112" />` : `<div class="avatar avatar-fallback" aria-hidden="true">${esc(member.name.slice(0, 1).toUpperCase())}</div>`}
      <p class="eyebrow">Mshpit member</p>
      <h1>${esc(member.name)}</h1>
      ${member.handle ? `<p class="handle">@${esc(member.handle)}</p>` : ""}
      ${member.bio ? `<div class="bio">${paragraphs(member.bio)}</div>` : ""}
      <dl class="stats"><div><dt>Posts</dt><dd>${esc(stats.postCount)}</dd></div><div><dt>Followers</dt><dd>${esc(stats.followerCount)}</dd></div></dl>
    </section>
    ${posts ? `<section class="section"><div class="section-heading"><div><p class="eyebrow">Concert diary</p><h2>Shared nights</h2></div></div><div class="post-list">${posts}</div></section>` : ""}
  </main>`;
}

function postMain(document) {
  const comments = document.comments.map((comment) => {
    const date = dateTimeLabel(comment.publishedAt);
    const author = comment.author.path
      ? link(comment.author.path, comment.author.handle ? `@${comment.author.handle}` : comment.author.name)
      : esc(comment.author.name);
    return `<li class="comment${comment.parentId ? " comment-reply" : ""}" id="comment-${esc(comment.id)}"><div class="comment-meta"><strong>${author}</strong>${date ? `<time datetime="${esc(date.iso)}">${esc(date.label)}</time>` : ""}</div>${paragraphs(comment.text)}</li>`;
  }).join("");
  return `<main id="main" class="post-page">
    ${breadcrumbs(document)}
    ${compactPost(document.post, { full: true })}
    <section class="section comments"><div class="section-heading"><div><p class="eyebrow">After the show</p><h2>Comments</h2></div><span>${esc(document.post.comments)}</span></div>${comments ? `<ol>${comments}</ol>` : '<p class="empty">No public comments yet.</p>'}</section>
  </main>`;
}

function eventDetails(event) {
  const ticket = publicHttpsUrl(event.ticketUrl);
  const date = longDateLabel(event.date);
  const venue = link(event.venuePath, event.venue);
  return `<dl class="event-facts">
    <div><dt>Date</dt><dd><time datetime="${esc(event.startDateTime || event.date)}">${esc(date || event.date)}${event.localTime ? ` at ${esc(event.localTime)}` : ""}</time></dd></div>
    <div><dt>Venue</dt><dd>${venue}</dd></div>
    ${event.place ? `<div><dt>Location</dt><dd>${esc(event.place)}</dd></div>` : ""}
    ${event.statusLabel && event.statusLabel !== "scheduled" ? `<div><dt>Status</dt><dd>${esc(event.statusLabel)}</dd></div>` : ""}
  </dl>${ticket ? `<p class="ticket-action"><a class="button primary" href="${esc(ticket)}" rel="sponsored noopener noreferrer">View tickets</a><small>Tickets are handled by the linked provider.</small></p>` : ""}`;
}

function eventMain(document) {
  const { event } = document;
  const posts = document.posts.map((post) => compactPost(post)).join("");
  return `<main id="main">
    ${breadcrumbs(document)}
    <section class="profile-hero event-hero">
      <p class="eyebrow">Live event</p>
      <h1>${link(event.artistPath, event.artist)} <em>at ${link(event.venuePath, event.venue)}</em></h1>
      ${eventDetails(event)}
    </section>
    ${posts ? `<section class="section"><div class="section-heading"><div><p class="eyebrow">People who were there</p><h2>Fan memories from this show</h2></div></div><div class="post-list">${posts}</div></section>` : `<section class="section empty-state"><p class="eyebrow">The archive starts here</p><h2>No fan memories have been shared for this date yet.</h2><p>After the show, fans can log a review and choose which photos appear in public galleries.</p></section>`}
  </main>`;
}

function concertMain(document) {
  const { concert } = document;
  const reviews = document.reviews.map((review) => compactPost(review)).join("");
  return `<main id="main">
    ${breadcrumbs(document)}
    <section class="profile-hero event-hero">
      <p class="eyebrow">Fan concert archive</p>
      <h1>${link(concert.artistPath, concert.artist)} <em>at ${link(concert.venuePath, concert.venue)}</em></h1>
      <p class="hero-copy"><time datetime="${esc(concert.date)}">${esc(longDateLabel(concert.date) || concert.date)}</time>${concert.city ? ` · ${esc(concert.city)}` : ""}</p>
      <dl class="stats"><div><dt>Fan ratings</dt><dd>${esc(concert.ratingCount)}</dd></div>${concert.averageRating != null ? `<div><dt>Average rating</dt><dd>${esc(concert.averageRating.toFixed(1))}<small>/5</small></dd></div>` : ""}</dl>
    </section>
    <section class="section"><div class="section-heading"><div><p class="eyebrow">The crowd remembers</p><h2>Reviews and photos from this night</h2></div></div><div class="post-list">${reviews}</div></section>
  </main>`;
}

function venueMain(document) {
  const { venue } = document;
  const events = document.events.map((event) => `<li><time datetime="${esc(event.startDateTime || event.date)}"><strong>${esc(dateLabel(event.date))}</strong></time><div><h3>${link(event.path, event.name)}</h3><p>${link(event.artistPath, event.artist)}${event.place ? ` · ${esc(event.place)}` : ""}</p></div>${event.soldOut ? '<span class="pill">Sold out</span>' : ""}</li>`).join("");
  const posts = document.posts.map((post) => compactPost(post)).join("");
  return `<main id="main">
    ${breadcrumbs(document)}
    <section class="profile-hero"><p class="eyebrow">Live music venue</p><h1>${esc(venue.name)}</h1>${venue.place ? `<p class="hero-copy">${esc(venue.place)}</p>` : ""}</section>
    ${events ? `<section class="section"><div class="section-heading"><div><p class="eyebrow">On the calendar</p><h2>Upcoming concerts</h2></div></div><ol class="event-list">${events}</ol></section>` : ""}
    ${posts ? `<section class="section"><div class="section-heading"><div><p class="eyebrow">From the floor</p><h2>Fan reviews and photos</h2></div></div><div class="post-list">${posts}</div></section>` : ""}
  </main>`;
}

function directoryMain(document) {
  const isArtists = document.directoryKind === "artists";
  const artists = document.artists.map((artist) => `<li class="artist-card"><p class="eyebrow">${artist.genre.length ? esc(artist.genre.slice(0, 2).join(" · ")) : "Artist page"}</p><h2>${link(artist.path, artist.name)}</h2>${artist.description ? `<p>${esc(artist.description)}</p>` : ""}</li>`).join("");
  const events = document.events.map((event) => `<li><time datetime="${esc(event.startDateTime || event.date)}"><strong>${esc(dateLabel(event.date))}</strong></time><div><h2>${link(event.path, event.name)}</h2><p>${link(event.artistPath, event.artist)} · ${link(event.venuePath, event.venue)}${event.place ? ` · ${esc(event.place)}` : ""}</p></div>${event.soldOut ? '<span class="pill">Sold out</span>' : ""}</li>`).join("");
  return `<main id="main">
    ${breadcrumbs(document)}
    <section class="directory-hero"><p class="eyebrow">Mshpit directory</p><h1>${isArtists ? "Artists in the live archive" : "Upcoming concerts worldwide"}</h1><p>${esc(document.description)}</p></section>
    <section class="section" aria-label="${isArtists ? "Artist directory" : "Event directory"}">${isArtists ? `<ul class="artist-grid directory-grid">${artists}</ul>` : `<ol class="event-list directory-events">${events}</ol>`}</section>
  </main>`;
}

export function renderPublicDocumentMain(document) {
  if (!document || !["home", "discover", "search", "artist", "member", "post", "event", "concert", "venue", "directory"].includes(document.kind)) return null;
  if (document.kind === "home") return homeMain(document);
  if (document.kind === "discover") return discoverMain(document);
  if (document.kind === "search") return searchMain(document);
  if (document.kind === "artist") return artistMain(document);
  if (document.kind === "member") return memberMain(document);
  if (document.kind === "post") return postMain(document);
  if (document.kind === "event") return eventMain(document);
  if (document.kind === "concert") return concertMain(document);
  if (document.kind === "venue") return venueMain(document);
  return directoryMain(document);
}

export function renderPublicDocumentHead(document) {
  if (!document?.canonicalUrl || !document?.title || !document?.description) return null;
  const indexable = document.indexable !== false;
  const contentImage = publicMediaUrl(document.image);
  const image = contentImage || publicMediaUrl(new URL("/og.png", document.canonicalUrl).toString());
  const video = publicHttpsUrl(document.video?.url);
  const publishedAt = dateTimeLabel(document.publishedAt)?.iso || null;
  const modifiedAt = dateTimeLabel(document.modifiedAt)?.iso || null;
  const ogType = document.kind === "post" ? "article" : document.kind === "member" ? "profile" : "website";
  const structured = (Array.isArray(document.jsonLd) ? document.jsonLd : [])
    .map((value) => `<script type="application/ld+json">${safeStructuredJson(value)}</script>`)
    .join("\n    ");
  return `<title>${esc(document.title)}</title>
    <meta name="description" content="${esc(document.description)}" />
    <meta name="theme-color" content="#080807" />
    <meta name="robots" content="${indexable ? "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" : "noindex,follow"}" />
    ${indexable ? `<link rel="canonical" href="${esc(document.canonicalUrl)}" />` : ""}
    <link rel="icon" href="/logo.svg" type="image/svg+xml" />
    <meta property="og:site_name" content="${esc(document.siteName || "Mshpit")}" />
    <meta property="og:locale" content="en_CA" />
    <meta property="og:type" content="${ogType}" />
    <meta property="og:title" content="${esc(document.title)}" />
    <meta property="og:description" content="${esc(document.description)}" />
    <meta property="og:url" content="${esc(document.canonicalUrl)}" />
    ${image ? `<meta property="og:image" content="${esc(image)}" />
    ${contentImage && document.imageWidth ? `<meta property="og:image:width" content="${esc(document.imageWidth)}" />` : !contentImage ? '<meta property="og:image:width" content="1200" />' : ""}
    ${contentImage && document.imageHeight ? `<meta property="og:image:height" content="${esc(document.imageHeight)}" />` : !contentImage ? '<meta property="og:image:height" content="630" />' : ""}
    ${contentImage && document.imageMimeType ? `<meta property="og:image:type" content="${esc(document.imageMimeType)}" />` : ""}
    <meta property="og:image:alt" content="${esc(document.title)}" />` : ""}
    ${video ? `<meta property="og:video" content="${esc(video)}" />
    <meta property="og:video:secure_url" content="${esc(video)}" />
    ${document.video?.mimeType ? `<meta property="og:video:type" content="${esc(document.video.mimeType)}" />` : ""}
    ${document.video?.width ? `<meta property="og:video:width" content="${esc(document.video.width)}" />` : ""}
    ${document.video?.height ? `<meta property="og:video:height" content="${esc(document.video.height)}" />` : ""}` : ""}
    ${publishedAt ? `<meta property="article:published_time" content="${esc(publishedAt)}" />` : ""}
    ${modifiedAt ? `<meta property="article:modified_time" content="${esc(modifiedAt)}" />` : ""}
    <meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />
    <meta name="twitter:title" content="${esc(document.title)}" />
    <meta name="twitter:description" content="${esc(document.description)}" />
    ${image ? `<meta name="twitter:image" content="${esc(image)}" />
    <meta name="twitter:image:alt" content="${esc(document.title)}" />` : ""}
    ${structured}`;
}

const STYLES = `
  :root{color-scheme:dark;--ink:#f8f4ec;--muted:#aaa097;--line:#342f2a;--panel:#171512;--gold:#f4b72a;--rose:#ff6f7d;--max:1120px}
  *{box-sizing:border-box}html{background:#080807}body{margin:0;background:radial-gradient(circle at 76% 0,#2b1d0e 0,transparent 28rem),#080807;color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;overflow:auto}
  .seo-document{width:100%;min-height:100dvh}
  a{color:inherit;text-decoration-color:#70624d;text-underline-offset:.2em}a:hover{color:var(--gold)}img,video{display:block;max-width:100%}.skip{position:absolute;left:-9999px}.skip:focus{left:1rem;top:1rem;background:#fff;color:#000;padding:.7rem;z-index:10}
  .site-header{position:relative;border-bottom:1px solid var(--line);background:#0b0a09e8}.site-header>div{max-width:var(--max);margin:auto;padding:1rem 1.3rem;display:flex;align-items:center;justify-content:space-between;gap:1rem}.brand{font:900 1.45rem/1 ui-monospace,monospace;letter-spacing:.22em;text-decoration:none;color:var(--gold)}nav{display:flex;gap:1rem;color:#d9d1c6;font-size:.9rem}
  main{max-width:var(--max);margin:auto;padding:0 1.3rem 5rem}.breadcrumbs{padding-top:1.25rem;color:var(--muted);font-size:.78rem}.breadcrumbs ol{display:flex;flex-wrap:wrap;gap:.45rem;list-style:none;margin:0;padding:0}.breadcrumbs li:not(:last-child)::after{content:"/";margin-left:.45rem;color:#6c6259}.hero,.profile-hero,.directory-hero{padding:clamp(4rem,11vw,8rem) 0;border-bottom:1px solid var(--line)}.hero{max-width:900px}.eyebrow{margin:0 0 .8rem;color:var(--gold);font:800 .72rem/1.2 ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase}.hero h1,.profile-hero h1,.directory-hero h1{max-width:930px;margin:0;font:900 clamp(3.2rem,9vw,7.4rem)/.92 Georgia,serif;letter-spacing:-.05em}.hero h1 em,.event-hero h1 em{color:var(--rose);font-weight:400}.hero-copy,.directory-hero>p:last-child{max-width:690px;margin:2rem 0 0;color:#d7cfc4;font-size:clamp(1.05rem,2.3vw,1.35rem)}.actions{display:flex;flex-wrap:wrap;gap:.7rem;margin-top:2rem}.button{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:.8rem 1.2rem;text-decoration:none;font-weight:800}.button.primary{background:var(--gold);border-color:var(--gold);color:#130d03}
  .section{padding:4rem 0;border-bottom:1px solid var(--line);content-visibility:auto;contain-intrinsic-size:auto 700px}.section-heading{display:flex;justify-content:space-between;align-items:end;gap:1rem;margin-bottom:1.5rem}.section-heading h2{margin:0;font:800 clamp(1.8rem,4vw,3rem)/1.05 Georgia,serif}.artist-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.8rem;list-style:none;padding:0}.artist-card,.post-card,.update{background:linear-gradient(145deg,#191713,#11100e);border:1px solid var(--line);border-radius:1rem;padding:1.25rem}.artist-card h2,.artist-card h3{margin:.2rem 0;font-size:1.3rem}.artist-card>p:not(.eyebrow){color:#c8c0b6}.micro,.muted,.byline,.handle,.genres,.empty{color:var(--muted)}
  .post-list{display:grid;gap:1rem}.post-card>header{display:flex;align-items:start;justify-content:space-between;gap:1rem}.post-card h3,.post-card h1{margin:0;font:800 clamp(1.3rem,3vw,2rem)/1.14 Georgia,serif}.post-card h1{font-size:clamp(2rem,5vw,4rem)}.rating{margin:0;color:var(--gold);font-size:1.25rem;font-weight:900}.rating span{font-size:.75rem;color:var(--muted)}.byline{margin:.6rem 0 0;font-size:.85rem}.post-copy{max-width:780px;margin:1.2rem 0;color:#ddd4c8}.post-copy p{white-space:normal}.post-card footer{display:flex;flex-wrap:wrap;gap:1rem;margin-top:1rem;color:var(--muted);font-size:.8rem}.text-link{margin-left:auto;color:var(--ink);font-weight:800}.media-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.6rem;margin-top:1.2rem}.media-item{margin:0;border-radius:.8rem;overflow:hidden;background:#050505}.media-item img,.media-item video{width:100%;max-height:560px;object-fit:cover;aspect-ratio:var(--media-ratio,auto)}.media-item figcaption{padding:.55rem .7rem;color:var(--muted);font-size:.72rem}.post-full{padding:clamp(1.25rem,4vw,2.5rem);margin-top:3rem}.post-full .media-grid{grid-template-columns:1fr}
  .memorial{display:grid;grid-template-columns:auto 1fr;gap:1.25rem;background:linear-gradient(135deg,#211b16,#11100e);padding-left:clamp(1rem,3vw,2rem);padding-right:clamp(1rem,3vw,2rem)}.memorial-mark{display:grid;place-items:center;width:3.2rem;height:3.2rem;border:1px solid var(--gold);border-radius:50%;color:var(--gold);font:900 .52rem/1.05 ui-monospace,monospace;letter-spacing:.06em;text-align:center}.memorial h2{margin:0;font:800 clamp(2rem,5vw,3.6rem)/1.05 Georgia,serif}.memorial h3{margin:1.5rem 0 .5rem;font:800 1rem/1.2 ui-sans-serif,system-ui}.memorial-date{margin:.65rem 0;color:var(--muted)}.memorial-copy,.memorial-thanks{max-width:780px;color:#ddd4c8;font-size:1.08rem}.memorial-legacy ul{display:grid;gap:.4rem;max-width:780px;margin:.5rem 0 0;padding-left:1.2rem;color:#ddd4c8}.memorial-thanks p{margin:.5rem 0}.memorial-source{margin:1.2rem 0 0;color:var(--muted);font-size:.82rem}
  .profile-hero h1{max-width:850px}.profile-hero .bio{max-width:760px;margin-top:1.6rem;color:#d8d0c5;font-size:1.1rem}.stats{display:flex;flex-wrap:wrap;gap:2.4rem;margin:2rem 0 0}.stats div{display:flex;flex-direction:column-reverse}.stats dt{color:var(--muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.1em}.stats dd{margin:0;font:900 2rem/1 Georgia,serif}.stats small{font-size:.8rem;color:var(--muted)}.event-list{list-style:none;padding:0;margin:0}.event-list li{display:grid;grid-template-columns:7rem 1fr auto;align-items:center;gap:1rem;padding:1.1rem 0;border-top:1px solid var(--line)}.event-list time{display:grid;gap:.2rem}.event-list time small,.archive-score{color:var(--muted);font-size:.75rem}.event-list h2,.event-list h3,.event-list p{margin:0}.event-list h2{font-size:1rem}.pill{border:1px solid var(--rose);border-radius:99px;padding:.25rem .55rem;color:var(--rose);font-size:.7rem}.event-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem;margin:2.5rem 0 0}.event-facts div{border-top:1px solid var(--line);padding-top:.8rem}.event-facts dt{color:var(--muted);font-size:.7rem;letter-spacing:.1em;text-transform:uppercase}.event-facts dd{margin:.25rem 0 0;font-weight:800}.ticket-action{display:flex;align-items:center;gap:1rem;margin-top:2rem}.ticket-action small{color:var(--muted)}.updates{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.8rem}.update p{margin:0}.update time{display:block;margin-top:1rem;color:var(--muted);font-size:.8rem}.member-hero{position:relative}.avatar{border:1px solid var(--line);border-radius:50%;object-fit:cover;margin-bottom:1.2rem}.avatar-fallback{display:grid;place-items:center;background:#241d12;color:var(--gold);font:900 3rem Georgia,serif}.comments ol{list-style:none;padding:0;margin:0}.comment{padding:1.2rem 0;border-top:1px solid var(--line)}.comment-reply{margin-left:clamp(1rem,5vw,4rem);border-left:2px solid var(--line);padding-left:1rem}.comment p{max-width:760px}.comment-meta{display:flex;justify-content:space-between;gap:1rem}.comment-meta time{color:var(--muted);font-size:.8rem}.empty-state{max-width:760px}.directory-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
  .site-footer{max-width:var(--max);margin:auto;padding:2rem 1.3rem 3rem;display:flex;flex-wrap:wrap;justify-content:space-between;gap:1rem;color:var(--muted);font-size:.8rem}.site-footer div{display:flex;flex-wrap:wrap;gap:1rem}
  @media(max-width:900px){.directory-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){nav a:nth-child(n+4){display:none}.artist-grid,.updates,.directory-grid{grid-template-columns:1fr}.media-grid{grid-template-columns:1fr}.event-list li{grid-template-columns:5.5rem 1fr}.event-list .pill,.archive-score{grid-column:2}.event-facts{grid-template-columns:1fr}.ticket-action{align-items:flex-start;flex-direction:column}.section-heading{align-items:start}.profile-hero h1,.hero h1,.directory-hero h1{font-size:clamp(3rem,15vw,5rem)}}
`;

export function renderPublicDocumentShell(document) {
  const main = renderPublicDocumentMain(document);
  if (!main) return null;
  // Keep the style element inside #root. React's createRoot replaces both the
  // semantic preview and these temporary styles when the interactive client
  // mounts, so crawler-first CSS cannot leak into the signed-in application.
  return `<style data-mshpit-public-document>${STYLES}</style>
    <div class="seo-document">
      <a class="skip" href="#main">Skip to content</a>
      <header class="site-header"><div><a class="brand" href="/" aria-label="Mshpit home">Mshpit</a><nav aria-label="Main navigation"><a href="/artists">Artists</a><a href="/events">Events</a><a href="/discover">Discover</a><a href="/search">Search</a><a href="/login">Log in</a></nav></div></header>
      ${main}
      <footer class="site-footer"><span>© ${new Date().getUTCFullYear()} Mshpit</span><div><a href="/about">About</a><a href="/contact">Contact</a><a href="/community-guidelines">Guidelines</a><a href="/ratings-methodology">Ratings</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/support">Support</a></div></footer>
    </div>`;
}

export function renderPublicDocument(document) {
  const head = renderPublicDocumentHead(document);
  const shell = renderPublicDocumentShell(document);
  if (!head || !shell) return null;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
    ${head}
  </head>
  <body>
    ${shell}
  </body>
</html>`;
}

export const escapePublicDocumentHtml = esc;
export const serializePublicStructuredData = safeStructuredJson;
