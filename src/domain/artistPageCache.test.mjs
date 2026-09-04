import assert from "node:assert/strict";
import test from "node:test";

import {
  artistPageCacheForViewer,
  artistPageResourceKind,
  artistPageCacheStorageKeys,
  clearArtistPageCache,
  createArtistPageCacheState,
  createArtistPageReadCoordinator,
  handoffArtistPageCache,
  resolveArtistPageRefresh,
} from "./artistPageCache.mjs";

test("a confirmed artist save supersedes reads begun before and during the save", () => {
  const reads = createArtistPageReadCoordinator();
  const resource = artistPageResourceKind("steve lacy");
  const beforeSaveRead = reads.claim(resource, "u_admin");
  const saveFence = reads.claim(resource, "u_admin");
  const duringSaveRead = reads.claim(resource, "u_admin");
  const confirmedSaveCommit = reads.claim(resource, "u_admin");

  assert.equal(reads.isCurrent(beforeSaveRead, "u_admin"), false);
  assert.equal(reads.isCurrent(saveFence, "u_admin"), false);
  assert.equal(reads.isCurrent(duringSaveRead, "u_admin"), false);
  assert.equal(reads.isCurrent(confirmedSaveCommit, "u_admin"), true);
});

test("artist page cache rotates to the next viewer without carrying the prior viewer snapshot", () => {
  const accountA = createArtistPageCacheState("u_a", {
    profiles: { turnstile: { bio: "visible to A" } },
    posts: { turnstile: [{ id: "a-only" }] },
  });
  const accountB = handoffArtistPageCache(accountA, "u_b", {
    profiles: { turnstile: { bio: "visible to B" } },
    posts: { turnstile: [] },
  });

  assert.notEqual(artistPageCacheStorageKeys("u_a").profiles, artistPageCacheStorageKeys("u_b").profiles);
  assert.equal(accountB.accountId, "u_b");
  assert.equal(accountB.profiles.turnstile.bio, "visible to B");
  assert.deepEqual(accountB.posts.turnstile, []);
  assert.deepEqual(artistPageCacheForViewer(accountA, "u_b").profiles, {});
});

test("a block boundary clears personalized artist data and fences its in-flight read", () => {
  const reads = createArtistPageReadCoordinator();
  const claim = reads.claim("artist-page:turnstile", "u_a");
  const before = createArtistPageCacheState("u_a", {
    profiles: { turnstile: { ownerId: "u_blocked", bio: "do not retain" } },
    posts: { turnstile: [{ id: "blocked-update" }] },
  });

  reads.reset();
  const after = clearArtistPageCache(before);

  assert.deepEqual(after.profiles, {});
  assert.deepEqual(after.posts, {});
  assert.equal(after.boundaryEpoch, before.boundaryEpoch + 1);
  assert.equal(reads.isCurrent(claim, "u_a"), false);
});

test("a failed same-viewer refresh retains the last confirmed snapshot", () => {
  const confirmed = createArtistPageCacheState("u_a", {
    profiles: { turnstile: { bio: "last confirmed" } },
    posts: { turnstile: [{ id: "confirmed" }] },
  });

  const failed = resolveArtistPageRefresh(confirmed, "turnstile", { ok: false });

  assert.equal(failed, confirmed);
  assert.equal(failed.profiles.turnstile.bio, "last confirmed");
  assert.equal(failed.posts.turnstile[0].id, "confirmed");
});

test("a confirmed refresh authoritatively replaces the selected artist snapshot", () => {
  const before = createArtistPageCacheState("u_a", {
    profiles: { turnstile: { bio: "old", banner: "old.jpg" } },
    posts: { turnstile: [{ id: "old" }], geese: [{ id: "keep" }] },
  });
  const after = resolveArtistPageRefresh(before, "turnstile", {
    ok: true,
    profile: {},
    posts: [],
  });

  assert.deepEqual(after.profiles.turnstile, {});
  assert.deepEqual(after.posts.turnstile, []);
  assert.equal(after.posts.geese[0].id, "keep");
});
