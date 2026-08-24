import assert from "node:assert/strict";
import test from "node:test";
import {
  artistWorkspaceOwnsArtist,
  artistWorkspaceIdentity,
  artistWorkspaceModel,
  profileManagementAction,
  profileManagementDestination,
  publicIdentityTarget,
} from "./artistWorkspace.mjs";

const artist = { id: "artist-1", role: "artist", artistName: "Model/Actriz" };

test("Artist HQ is available only to a named artist account", () => {
  assert.equal(artistWorkspaceModel({ session: { id: "fan", role: "fan" } }).authorized, false);
  assert.equal(artistWorkspaceModel({ session: { id: "admin", role: "admin" } }).authorized, false);
  assert.equal(artistWorkspaceModel({ session: { id: "artist", role: "artist" } }).authorized, false);
  assert.equal(artistWorkspaceModel({ session: artist }).authorized, true);
});

test("profile management exposes one safe destination for every account", () => {
  assert.deepEqual(artistWorkspaceIdentity(artist), { accountId: "artist-1", artistName: "Model/Actriz" });
  assert.equal(profileManagementDestination(artist), "artistHub");
  assert.equal(profileManagementDestination({ id: "pending", role: "artist", artistName: "   " }), "editProfile");
  assert.equal(profileManagementDestination({ id: "fan", role: "fan" }), "editProfile");
  assert.equal(profileManagementDestination({ id: "moderator", role: "moderator" }), "editProfile");
  assert.equal(profileManagementDestination({ id: "admin", role: "admin", artistName: "Admin Act" }), "editProfile");
});

test("every account surface gets one consistently named management action", () => {
  assert.deepEqual(profileManagementAction(artist), {
    key: "manageProfile",
    destination: "artistHub",
    icon: "music",
    title: "Manage profile",
    detail: "Public artist profile, page updates, and live dates",
  });
  assert.deepEqual(profileManagementAction({ id: "fan", role: "fan" }), {
    key: "manageProfile",
    destination: "editProfile",
    icon: "edit",
    title: "Manage profile",
    detail: "Photo, bio, music, and personal details",
  });
});

test("artist ownership and public identity never grant an admin an unauthorized workspace", () => {
  assert.equal(artistWorkspaceOwnsArtist(artist, " model/actriz "), true);
  assert.equal(artistWorkspaceOwnsArtist(artist, "Another Artist"), false);
  assert.equal(artistWorkspaceOwnsArtist({ id: "admin", role: "admin", artistName: "Model/Actriz" }, "Model/Actriz"), false);
  assert.deepEqual(publicIdentityTarget(artist), { kind: "artist", artistName: "Model/Actriz" });
  assert.deepEqual(publicIdentityTarget({ id: "fan", role: "fan" }), { kind: "profile", userId: "fan" });
});

test("promo readiness reflects public identity, music, updates, and live conversion", () => {
  const model = artistWorkspaceModel({
    session: artist,
    profile: { bio: "A new era built for the room and everybody moving inside it.", avatarUri: "https://media.example/avatar.jpg", banner: "https://media.example/banner.jpg", feedEnabled: true },
    posts: [{ id: "update-1" }],
    catalog: { topTracks: [{ title: "Mosquito" }] },
    summary: {
      upcoming: [{ id: "show-1", date: "2026-09-01", venue: "History", ticketUrl: "https://tickets.example/show" }],
      nights: [{ id: "night-1" }],
      totalRatings: 42,
      avgOverall: 4.7,
    },
  });

  assert.equal(model.score, 100);
  assert.equal(model.stageReady, true);
  assert.equal(model.nextMove, null);
  assert.equal(model.nextShow.venue, "History");
  assert.equal(model.spotlightTrack.title, "Mosquito");
  assert.deepEqual(model.stats, { upcomingShows: 1, updates: 1, nights: 1, ratings: 42, liveScore: 4.7 });
});

test("the next move is deterministic and missing ticket links remain honest", () => {
  const model = artistWorkspaceModel({
    session: artist,
    profile: { avatarUri: "https://media.example/avatar.jpg" },
    summary: {
      upcoming: [
        { id: "later", date: "2026-12-01", venue: "The Forum", ticketUrl: "" },
        { id: "sooner", date: "2026-10-01", venue: "The Anthem", ticketUrl: "http://unsafe.example" },
      ],
    },
  });

  assert.equal(model.nextShow.id, "sooner");
  assert.equal(model.nextMove.key, "banner");
  assert.equal(model.completion.find((item) => item.key === "tickets").complete, false);
  assert.equal(model.score, 25);
});
