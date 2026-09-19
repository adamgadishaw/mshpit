const text = (value) => typeof value === "string" ? value.trim() : "";

// Page ownership is independent of the moderator-granted artist check.
export function artistWorkspaceIdentity(session) {
  const artistName = text(session?.artistName);
  return session?.role === "artist" && artistName
    ? { accountId: String(session.id || ""), artistName }
    : null;
}

export function profileManagementDestination(session) {
  return artistWorkspaceIdentity(session) ? "artistHub" : "editProfile";
}

export function profileManagementAction(session) {
  const destination = profileManagementDestination(session);
  return {
    key: "manageProfile", destination,
    icon: destination === "artistHub" ? "music" : "edit",
    title: "Manage profile",
    detail: destination === "artistHub"
      ? "Artist page, posts, and upcoming shows"
      : "Profile photo, bio, favorite music, and personal details",
  };
}

export function artistWorkspaceOwnsArtist(session, artistName) {
  const identity = artistWorkspaceIdentity(session);
  return !!identity && identity.artistName.toLocaleLowerCase() === text(artistName).toLocaleLowerCase();
}

export function publicIdentityTarget(user) {
  const identity = artistWorkspaceIdentity(user);
  if (identity) return { kind: "artist", artistName: identity.artistName };
  return { kind: "profile", userId: String(user?.id || "") };
}
