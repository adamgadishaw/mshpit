import assert from "node:assert/strict";
import test from "node:test";

import { artistLegacyPresentation } from "./artistLegacyPresentation.mjs";

test("a legacy transition immediately masks cached owner identity and posts", () => {
  assert.deepEqual(artistLegacyPresentation({
    legacyMode: true,
    cachedArtist: {
      ownerBio: "Former owner bio",
      banner: "https://owner.example/banner.jpg",
      photo: "https://owner.example/avatar.jpg",
      profileAvatarUri: "https://owner.example/avatar.jpg",
      ownerId: "u_former_owner",
    },
    catalogArtist: {
      bio: "Catalogue biography",
      photo: "https://catalog.example/artist.jpg",
    },
    cachedPosts: [{ id: "owner-post", text: "Not editorial" }],
    gallery: [{ uri: "https://fans.example/show.jpg", source: "fan" }],
  }), {
    bio: "Catalogue biography",
    bannerUri: "https://catalog.example/artist.jpg",
    profileUri: "https://catalog.example/artist.jpg",
    profileAvatarUri: null,
    profileOwnerId: null,
    posts: [],
    heroGallery: [],
  });
});

test("only a current legacy-projected response can add staff profile content and notes", () => {
  const note = { id: "history-1", text: "Staff-written context" };
  const input = {
    legacyMode: true,
    cachedArtist: { ownerBio: "Stale", banner: "https://owner.example/stale.jpg", ownerId: "u_old" },
    catalogArtist: { bio: "Catalogue biography", photo: "https://catalog.example/artist.jpg" },
    cachedPosts: [{ id: "stale-owner-post" }],
    confirmedPage: {
      legacyProfile: true,
      profile: {
        bio: "Staff-curated biography",
        banner: "https://staff.example/banner.jpg",
        avatarUri: "https://staff.example/avatar.jpg",
      },
      posts: [note],
    },
    gallery: [{ uri: "https://fans.example/show.jpg", source: "fan" }],
  };
  assert.deepEqual(artistLegacyPresentation(input), {
    bio: "Staff-curated biography",
    bannerUri: "https://staff.example/banner.jpg",
    profileUri: "https://staff.example/avatar.jpg",
    profileAvatarUri: "https://staff.example/avatar.jpg",
    profileOwnerId: null,
    posts: [note],
    heroGallery: [],
  });

  assert.deepEqual(artistLegacyPresentation({
    ...input,
    confirmedPage: { ...input.confirmedPage, legacyProfile: false },
  }), {
    bio: "Catalogue biography",
    bannerUri: "https://catalog.example/artist.jpg",
    profileUri: "https://catalog.example/artist.jpg",
    profileAvatarUri: null,
    profileOwnerId: null,
    posts: [],
    heroGallery: [],
  }, "an ordinary response completed before the memorial transition is not editorial provenance");
});

test("ordinary artist pages retain cached owner presentation and community hero media", () => {
  const gallery = [{ uri: "https://fans.example/show.jpg", source: "fan" }];
  const posts = [{ id: "artist-update" }];
  assert.deepEqual(artistLegacyPresentation({
    legacyMode: false,
    cachedArtist: {
      ownerBio: "Owner bio",
      banner: "https://owner.example/banner.jpg",
      photo: "https://owner.example/avatar.jpg",
      profileAvatarUri: "https://owner.example/avatar.jpg",
      ownerId: "u_owner",
    },
    catalogArtist: { bio: "Catalogue biography", photo: "https://catalog.example/artist.jpg" },
    cachedPosts: posts,
    gallery,
  }), {
    bio: "Owner bio",
    bannerUri: "https://owner.example/banner.jpg",
    profileUri: "https://owner.example/avatar.jpg",
    profileAvatarUri: "https://owner.example/avatar.jpg",
    profileOwnerId: "u_owner",
    posts,
    heroGallery: gallery,
  });
});
