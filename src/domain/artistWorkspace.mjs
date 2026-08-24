const text = (value) => typeof value === "string" ? value.trim() : "";
const rows = (value) => Array.isArray(value) ? value.filter(Boolean) : [];

export function artistWorkspaceIdentity(session) {
  const artistName = text(session?.artistName);
  return session?.role === "artist" && artistName
    ? { accountId: String(session.id || ""), artistName }
    : null;
}

// Artists have one top-level profile-management doorway. The regular member
// editor remains the safe fallback for every other account, including an artist
// role whose approved artist identity has not been attached yet.
export function profileManagementDestination(session) {
  return artistWorkspaceIdentity(session) ? "artistHub" : "editProfile";
}

// Every shell surface consumes the same action descriptor. The destination can
// differ by account type, but the user-facing promise never does: this is the
// one place to manage the identity they use on Pit.
export function profileManagementAction(session) {
  const destination = profileManagementDestination(session);
  return {
    key: "manageProfile",
    destination,
    icon: destination === "artistHub" ? "music" : "edit",
    title: "Manage profile",
    detail: destination === "artistHub"
      ? "Public artist profile, page updates, and live dates"
      : "Photo, bio, music, and personal details",
  };
}

export function artistWorkspaceOwnsArtist(session, artistName) {
  const identity = artistWorkspaceIdentity(session);
  return !!identity && identity.artistName.toLocaleLowerCase() === text(artistName).toLocaleLowerCase();
}

// A verified artist account has one public identity: its official artist page.
// Other accounts keep the member profile used by handles, follows, and diaries.
export function publicIdentityTarget(user) {
  const identity = artistWorkspaceIdentity(user);
  if (identity) return { kind: "artist", artistName: identity.artistName };
  return { kind: "profile", userId: String(user?.id || "") };
}

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
    completionItem("avatar", "Add an artist portrait", "Make the profile recognizable everywhere in Pit.", hasAvatar, "edit"),
    completionItem("banner", "Dress the marquee", "Use a wide live shot, campaign image, or current era artwork.", hasBanner, "edit"),
    completionItem("bio", "Tell the current story", "Give fans at least a few lines about this era of the artist.", bio.length >= 40, "edit"),
    completionItem("catalog", "Connect the music", "A matched catalog lets fans move from discovery to listening.", topTracks.length > 0, "preview"),
    completionItem("show", "Put a show on the board", "Upcoming performances make the page useful right now.", upcoming.length > 0, "tour"),
    completionItem("tickets", "Add an official ticket path", "Turn show interest into a real next step without invented links.", hasTicket, "tour"),
    completionItem("feed", "Show page updates", "Give short announcements a verified home on the public artist profile.", feedEnabled, "edit"),
    completionItem("update", "Publish the first page update", "Share release news, a live clip, a ticket alert, or a studio note.", updates.length > 0, "post"),
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
