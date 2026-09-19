import { artistWorkspaceIdentity } from "./artistAccountIdentity.mjs";
export { artistWorkspaceIdentity, profileManagementDestination, profileManagementAction, artistWorkspaceOwnsArtist, publicIdentityTarget } from "./artistAccountIdentity.mjs";

const text = (value) => typeof value === "string" ? value.trim() : "";
const rows = (value) => Array.isArray(value) ? value.filter(Boolean) : [];

function nextShow(upcoming) {
  return rows(upcoming).slice().sort((left, right) => {
    const dateOrder = text(left?.date).localeCompare(text(right?.date));
    if (dateOrder) return dateOrder;
    return text(left?.id).localeCompare(text(right?.id));
  })[0] || null;
}

function completionItem(key, label, detail, complete, action) {
  return { key, label, detail, complete: !!complete, action };
}

export function artistWorkspaceModel({ session, summary = {}, profile = {}, posts = [], catalog = {} } = {}) {
  const account = artistWorkspaceIdentity(session);
  if (!account) return { authorized: false, artistName: null, completion: [], score: 0 };

  const updates = rows(posts);
  const upcoming = rows(summary.upcoming);
  const topTracks = rows(catalog.topTracks);
  const show = nextShow(upcoming);
  const bio = text(profile.bio || summary.ownerBio || catalog.bio);
  const hasAvatar = !!text(profile.avatarUri || summary.profileAvatarUri || summary.photo);
  const hasBanner = !!text(profile.banner || summary.banner);
  const hasTicket = upcoming.some((event) => /^https:\/\//i.test(text(event?.ticketUrl)));
  const feedEnabled = profile.feedEnabled === true || summary.feedEnabled === true;

  const completion = [
    completionItem("avatar", "Add a profile photo", "Help fans recognize the artist across Mshpit.", hasAvatar, "edit"),
    completionItem("banner", "Add a page banner", "Use a wide live photo, current artwork, or promotion image.", hasBanner, "edit"),
    completionItem("bio", "Write a bio", "Tell fans what the artist is doing now.", bio.length >= 40, "edit"),
    completionItem("show", "Add an upcoming show", "Give fans a show they can plan for.", upcoming.length > 0, "tour"),
    completionItem("tickets", "Add a ticket link", "Link fans to an official ticket page.", hasTicket, "tour"),
    completionItem("feed", "Show artist posts", "Let fans see short posts on the artist page.", feedEnabled, "edit"),
    completionItem("update", "Publish the first artist post", "Share release news, a ticket alert, or a studio update.", updates.length > 0, "post"),
  ];
  const completeCount = completion.filter((item) => item.complete).length;
  const score = Math.round((completeCount / completion.length) * 100);
  const nextMove = completion.find((item) => !item.complete) || null;
  const totalRatings = Math.max(0, Math.trunc(Number(summary.totalRatings) || 0));
  const nights = rows(summary.nights);
  const rating = Number(summary.avgOverall) || 0;

  return {
    authorized: true,
    accountId: account.accountId,
    artistName: account.artistName,
    bio,
    hasAvatar,
    hasBanner,
    feedEnabled,
    completion,
    completeCount,
    score,
    stageReady: score >= 75,
    nextMove,
    nextShow: show,
    spotlightTrack: topTracks[0] || null,
    stats: {
      upcomingShows: upcoming.length,
      updates: updates.length,
      nights: nights.length,
      ratings: totalRatings,
      liveScore: rating > 0 ? rating : null,
    },
  };
}
