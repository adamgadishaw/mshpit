import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  adminPlaybackHealthPresentation,
  buildModerationReportRows,
  canRemoveReportTarget,
  filterModerationMembers,
  filterModerationReports,
  formatModerationTimestamp,
  confirmedRoleMutationPatch,
  moderationMemberIsLockedOwner,
  moderationMemberStatus,
  moderationTargetLabel,
  nextVisibleLimit,
  normalizeAdminMemberQuery,
  patchModerationMemberContext,
  reconcileSelectedMemberId,
  roleChangeRequiresOwnerApproval,
  staffActionStillOwned,
  summarizeModerationMembers,
  summarizeModerationReports,
  trackReportDetails,
} from "./moderationConsole.mjs";

const NOW = 1_000_000;

test("admin playback health never treats an undisclosed public field as a missing key", () => {
  assert.deepEqual(adminPlaybackHealthPresentation({ ok: true, capabilities: {} }), {
    status: "unknown",
    bad: false,
    configured: null,
    message: "Playback diagnostics are unavailable.",
    detail: "Refresh the moderation overview. This does not mean the YouTube key is missing.",
  });
  assert.equal(adminPlaybackHealthPresentation({ services: { youtubeConfigured: false } }).status, "unconfigured");
  assert.equal(adminPlaybackHealthPresentation({
    services: {
      youtubeConfigured: true,
      youtubeLookup: {
        search: { used: 2, limit: 100, remaining: 98 },
        actorAllowance: { eligible: true, used: 1, limit: 20, remaining: 19, adminBypass: true },
      },
    },
  }).status, "healthy");
});

test("admin playback health distinguishes account and shared YouTube allowances", () => {
  const projection = (youtubeLookup) => adminPlaybackHealthPresentation({
    services: { youtubeConfigured: true, youtubeLookup },
  });
  const healthy = projection({
    search: { used: 12, limit: 100, remaining: 88 },
    actorAllowance: { eligible: true, used: 3, limit: 20, remaining: 17, adminBypass: true },
  });
  assert.equal(healthy.status, "healthy");
  assert.match(healthy.detail, /Shared provider searches: 12 of 100 \/ 88 left/);
  assert.match(healthy.detail, /This account: 3 of 20 explicit new-track lookups \/ 17 left/);
  assert.match(healthy.detail, /admin verification bypass/);

  const ineligible = projection({
    search: { used: 12, limit: 100, remaining: 88 },
    actorAllowance: { eligible: false, used: 0, limit: 20, remaining: 20 },
  });
  assert.equal(ineligible.status, "account_ineligible");
  assert.match(ineligible.detail, /Verify this account's email/);

  const actorSpent = projection({
    search: { used: 12, limit: 100, remaining: 88 },
    actorAllowance: { eligible: true, used: 20, limit: 20, remaining: 0 },
  });
  assert.equal(actorSpent.status, "actor_spent");
  assert.match(actorSpent.detail, /midnight Pacific/);

  const sharedSpent = projection({
    search: { used: 100, limit: 100, remaining: 0 },
    actorAllowance: { eligible: true, used: 4, limit: 20, remaining: 16 },
  });
  assert.equal(sharedSpent.status, "shared_spent");
  assert.match(sharedSpent.message, /shared YouTube search allowance/);
});

test("AdminScreen reads playback diagnostics from the authenticated staff route", () => {
  const screenSource = fs.readFileSync(new URL("../screens/AdminScreen.jsx", import.meta.url), "utf8");
  const serviceSource = fs.readFileSync(new URL("../features/admin/services/adminHealthApi.mjs", import.meta.url), "utf8");
  assert.match(screenSource, /readAdminHealth\(\{ signal: controller\.signal \}\)/);
  assert.doesNotMatch(screenSource, /api\("\/api\/(?:admin\/)?health"/);
  assert.match(serviceSource, /api\("\/api\/admin\/health"/);
  assert.doesNotMatch(serviceSource, /api\("\/api\/health"/);
});

test("member status gives bans priority and ignores expired timeouts", () => {
  assert.equal(moderationMemberStatus({ isBanned: true, suspendedUntil: NOW + 1 }, NOW), "banned");
  assert.equal(moderationMemberStatus({ suspendedUntil: NOW + 1 }, NOW), "suspended");
  assert.equal(moderationMemberStatus({ suspendedUntil: NOW - 1 }, NOW), "active");
  assert.equal(moderationMemberStatus({}, NOW), "active");
});

test("Owner and privileged-role helpers keep pending authority out of local state", () => {
  assert.equal(moderationMemberIsLockedOwner({ owner: true, role: "admin" }), true);
  assert.equal(moderationMemberIsLockedOwner({ owner: false, role: "admin" }), false);
  assert.equal(roleChangeRequiresOwnerApproval("fan", "moderator"), true);
  assert.equal(roleChangeRequiresOwnerApproval("admin", "artist"), true);
  assert.equal(roleChangeRequiresOwnerApproval("fan", "artist"), false);
  assert.equal(confirmedRoleMutationPatch({ ok: true, pending: true, role: "admin", handle: "fan_admin" }), null);
  assert.equal(confirmedRoleMutationPatch({ ok: true, role: "admin" }), null);
  assert.deepEqual(confirmedRoleMutationPatch({ ok: true, role: "moderator", handle: "@fan_mod" }), { role: "moderator", handle: "fan_mod" });
});

test("Store adopts only an applied server role response", () => {
  const storeSource = fs.readFileSync(new URL("../store.js", import.meta.url), "utf8");
  const start = storeSource.indexOf("const setUserRole =");
  const end = storeSource.indexOf("const setVerified =", start);
  assert.ok(start >= 0 && end > start);
  const slice = storeSource.slice(start, end);
  assert.match(slice, /confirmedRoleMutationPatch\(result\)/);
  assert.match(slice, /if \(appliedPatch\)/);
  assert.doesNotMatch(slice, /patchStaffMember\(id, \{ role/);
});

test("moderation timestamps never render invalid dates and include timezone for actions", () => {
  assert.equal(formatModerationTimestamp(null), "Unknown time");
  assert.equal(formatModerationTimestamp("not-a-date"), "Unknown time");
  assert.equal(formatModerationTimestamp("", { fallback: "" }), "");
  const rendered = formatModerationTimestamp("2026-08-13T22:15:00.000Z", { locale: "en-CA" });
  assert.match(rendered, /2026/);
  assert.match(rendered, /:15/);
  assert.doesNotMatch(rendered, /Invalid/);
});

test("visible limits are bounded and selected members reconcile across filters and layouts", () => {
  assert.equal(nextVisibleLimit(30, 95, 30), 60);
  assert.equal(nextVisibleLimit(90, 95, 30), 95);
  assert.equal(nextVisibleLimit(-4, 5, 0), 1);
  const filtered = [{ id: "first" }, { id: "selected" }];
  assert.equal(reconcileSelectedMemberId("selected", filtered, { wide: true }), "selected");
  assert.equal(reconcileSelectedMemberId("gone", filtered, { wide: true }), "first");
  assert.equal(reconcileSelectedMemberId("gone", filtered, { wide: false }), null);
  assert.equal(reconcileSelectedMemberId(null, [], { wide: true }), null);
});

test("staff member queries normalize handles without widening private search scope", () => {
  assert.equal(normalizeAdminMemberQuery("  @jcolefan  "), "jcolefan");
  assert.equal(normalizeAdminMemberQuery("@@moderator"), "moderator");
  assert.equal(normalizeAdminMemberQuery("member-id", 6), "member");
  assert.equal(normalizeAdminMemberQuery(null), "");
});

test("a multi-write staff action cannot continue after account or role changes", () => {
  const initiatingScope = "staff-a\u0000admin";
  assert.equal(staffActionStillOwned(initiatingScope, { id: "staff-a", role: "admin" }), true);
  assert.equal(staffActionStillOwned(initiatingScope, { id: "staff-b", role: "admin" }), false);
  assert.equal(staffActionStillOwned(initiatingScope, { id: "staff-a", role: "moderator" }), false);
  assert.equal(staffActionStillOwned(initiatingScope, { id: "staff-a", role: "fan" }), false);
  assert.equal(staffActionStillOwned(initiatingScope, null), false);
});

test("report rows include reporter, author, and target context for triage", () => {
  const rows = buildModerationReportRows(
    [{ id: "r1", targetType: "post", targetId: "p1", reporterId: "reporter", reason: "Harassment", status: "open" }],
    {
      users: [
        { id: "author", name: "Post Author", handle: "author" },
        { id: "reporter", name: "Concerned Fan", handle: "fan" },
      ],
      posts: [{ id: "p1", userId: "author", artist: "J. Cole", venue: "Scotiabank Arena", review: "Target preview" }],
    },
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].target.title, "J. Cole");
  assert.equal(rows[0].target.excerpt, "Target preview");
  assert.equal(rows[0].author.handle, "author");
  assert.equal(rows[0].reporter.handle, "fan");
  assert.equal(rows[0].target.missing, false);
  assert.equal(rows[0].createdAt, null);
  assert.match(rows[0].searchText, /scotiabank arena/);
});

test("comment context is resolved from grouped comment state", () => {
  const [row] = buildModerationReportRows(
    [{ id: "r2", targetType: "comment", targetId: "c1", reporterId: "u2", reason: "spam", status: "open" }],
    {
      users: [{ id: "u1", name: "Commenter", handle: "commenter" }],
      comments: { p9: [{ id: "c1", userId: "u1", text: "Buy fake tickets" }] },
    },
  );
  assert.equal(row.target.title, "Comment by Commenter");
  assert.equal(row.target.metadata, "On post p9");
  assert.equal(row.target.missing, false);
});

test("authoritative server context and reporter take priority over stale local cache", () => {
  const [row] = buildModerationReportRows([{
    id: "server-report",
    targetType: "post",
    targetId: "p1",
    reason: "abuse",
    status: "open",
    reporter: { id: "r1", name: "Server Reporter", handle: "server-reporter" },
    content: {
      type: "post",
      exists: true,
      removed: false,
      artist: "J. Cole",
      venue: "Scotiabank Arena",
      excerpt: "Authoritative excerpt",
      author: { id: "a1", name: "Server Author", handle: "server-author", isBanned: true, suspendedUntil: NOW + 10, avatarUri: "https://example.com/avatar.jpg" },
    },
  }], {
    users: [{ id: "r1", name: "Stale Reporter", handle: "stale" }],
    posts: [{ id: "p1", artist: "Stale artist", review: "Stale excerpt" }],
  });

  assert.equal(row.reporter.name, "Server Reporter");
  assert.equal(row.author.name, "Server Author");
  assert.equal(row.author.isBanned, true);
  assert.equal(row.author.suspendedUntil, NOW + 10);
  assert.equal(row.author.avatarUri, "https://example.com/avatar.jpg");
  assert.equal(row.target.title, "J. Cole");
  assert.equal(row.target.excerpt, "Authoritative excerpt");
});

test("only server-attested exact media reaches the moderation preview model", () => {
  const [trusted] = buildModerationReportRows([{
    id: "trusted-media",
    targetType: "artist_profile",
    targetId: "j. cole",
    reason: "unsafe image",
    content: {
      type: "artist_profile",
      exists: true,
      artistKey: "j. cole",
      author: { id: "artist-owner", name: "Artist owner", handle: "artist-owner" },
      reportedMedia: "https://media.example/assets/users/artist-owner/avatar/exact.jpg",
      reportedMediaTrusted: true,
    },
  }]);
  assert.equal(trusted.target.reportedMedia, "https://media.example/assets/users/artist-owner/avatar/exact.jpg");
  assert.equal(trusted.target.reportedMediaTrusted, true);

  const [untrusted] = buildModerationReportRows([{
    id: "untrusted-media",
    targetType: "post",
    targetId: "p1",
    reason: "unsafe image",
    content: {
      type: "post",
      exists: true,
      reportedMedia: "https://attacker.example/moderator-tracker.gif",
      reportedMediaTrusted: false,
      reportedMediaUnavailable: true,
    },
  }]);
  assert.equal(untrusted.target.reportedMedia, null);
  assert.equal(untrusted.target.reportedMediaTrusted, false);
  assert.equal(untrusted.target.reportedMediaUnavailable, true);
});

test("server-declared missing content stays missing even when a stale local row exists", () => {
  const [row] = buildModerationReportRows([{
    id: "gone",
    targetType: "post",
    targetId: "p1",
    reason: "spam",
    status: "open",
    content: { type: "post", exists: false },
  }], { posts: [{ id: "p1", artist: "Stale local post" }] });

  assert.equal(row.target.missing, true);
  assert.match(row.target.excerpt, /could not find/i);
});

test("an arbitrary cached user cannot override authoritative embedded author state", () => {
  const [row] = buildModerationReportRows([{
    id: "stale-author",
    targetType: "post",
    targetId: "p1",
    reason: "abuse",
    status: "open",
    content: { type: "post", exists: true, excerpt: "target", author: { id: "a1", name: "Server Author", handle: "server-author", role: "moderator", isBanned: true, suspendedUntil: NOW + 10 } },
  }], { users: [{ id: "a1", name: "Cached Author", handle: "cached-author", role: "fan", isBanned: false, suspendedUntil: null }] });

  assert.equal(row.author.name, "Server Author");
  assert.equal(row.author.handle, "server-author");
  assert.equal(row.author.role, "moderator");
  assert.equal(row.author.isBanned, true);
  assert.equal(row.author.suspendedUntil, NOW + 10);
  assert.equal(moderationMemberStatus(row.author, NOW), "banned");
});

test("a completed member mutation explicitly advances embedded queue context", () => {
  const current = {
    reports: [{
      id: "r1",
      reporter: { id: "reporter", isBanned: false },
      content: { author: { id: "author", isBanned: false, suspendedUntil: null } },
    }],
    recentActions: [{ id: "a1", actor: { id: "author", role: "moderator" } }],
  };
  const next = patchModerationMemberContext(current, "author", { isBanned: true });
  assert.equal(next.reports[0].content.author.isBanned, true);
  assert.equal(next.reports[0].reporter.isBanned, false);
  assert.equal(next.recentActions[0].actor.isBanned, true);
  assert.equal(current.reports[0].content.author.isBanned, false, "the server snapshot stays immutable");
});

test("report filters search resolved context and preserve missing-target warnings", () => {
  const rows = buildModerationReportRows([
    { id: "r1", targetType: "post", targetId: "gone", reason: "spam", status: "open" },
    { id: "r2", targetType: "user", targetId: "u1", reason: "impersonation", status: "open" },
    { id: "closed", targetType: "post", targetId: "p2", status: "dismissed" },
  ], { users: [{ id: "u1", name: "Fake Artist", handle: "fake" }] });

  assert.deepEqual(filterModerationReports(rows, { targetType: "user" }).map((row) => row.id), ["r2"]);
  assert.deepEqual(filterModerationReports(rows, { query: "fake artist" }).map((row) => row.id), ["r2"]);
  assert.deepEqual(summarizeModerationReports(rows), {
    total: 2,
    missingContext: 1,
    byType: { post: 1, user: 1 },
  });
});

test("member filters put restricted accounts first without mutating input", () => {
  const members = [
    { id: "active", name: "Active Fan", handle: "active", role: "fan" },
    { id: "mod", name: "Mod", handle: "mod", role: "moderator" },
    { id: "timed", name: "Timed Artist", handle: "timed", role: "artist", suspendedUntil: NOW + 10 },
    { id: "banned", name: "Banned Fan", handle: "banned", role: "fan", isBanned: true, verified: true },
  ];
  const originalOrder = members.map((member) => member.id);

  assert.deepEqual(filterModerationMembers(members, { status: "restricted", now: NOW }).map((member) => member.id), ["banned", "timed"]);
  assert.deepEqual(filterModerationMembers(members, { role: "moderator", now: NOW }).map((member) => member.id), ["mod"]);
  assert.deepEqual(filterModerationMembers(members, { query: "artist", now: NOW }).map((member) => member.id), ["timed"]);
  assert.deepEqual(members.map((member) => member.id), originalOrder);

  assert.deepEqual(summarizeModerationMembers(members, NOW), {
    total: 4,
    active: 2,
    suspended: 1,
    banned: 1,
    restricted: 2,
    verified: 1,
    byRole: { fan: 2, moderator: 1, artist: 1 },
  });
});

test("target labels and removal capability match the existing server actions", () => {
  assert.equal(moderationTargetLabel("fan_message"), "Fan club message");
  assert.equal(moderationTargetLabel("artist_profile"), "Artist profile");
  assert.equal(moderationTargetLabel("future_target"), "Future Target");
  assert.equal(canRemoveReportTarget("post"), true);
  assert.equal(canRemoveReportTarget("artist_profile"), true);
  assert.equal(canRemoveReportTarget("message"), true);
  assert.equal(canRemoveReportTarget("user"), false);
});

test("song workflow accepts authoritative track content and legacy JSON reports", () => {
  assert.deepEqual(trackReportDetails({
    targetId: "song-key",
    reason: "playback issue",
    content: { type: "track", title: "No Role Modelz", artist: "J. Cole", category: "wrong_video", note: "live version", suggestedVideoId: "abcdefghijk", provider: "deezer", sourceId: "1124841682" },
  }), {
    title: "No Role Modelz", artist: "J. Cole", category: "wrong_video", note: "live version", suggestedVideoId: "abcdefghijk", provider: "deezer", sourceId: "1124841682",
  });
  assert.deepEqual(trackReportDetails({ targetId: "legacy", reason: JSON.stringify({ title: "Legacy song", category: "missing" }) }), {
    title: "Legacy song", artist: "", category: "missing", note: "", suggestedVideoId: "", provider: null, sourceId: null,
  });
});

test("moderation sources keep visible punctuation ASCII-safe", () => {
  const paths = [
    new URL("./moderationConsole.mjs", import.meta.url),
    new URL("../components/moderation/ModerationConsole.jsx", import.meta.url),
    new URL("../screens/AdminScreen.jsx", import.meta.url),
  ];
  for (const path of paths) {
    const source = fs.readFileSync(path, "utf8");
    assert.doesNotMatch(source, /[^\x00-\x7F]/u);
  }
});

test("console source keeps bounded rendering, cursor reachability, and atomic action guards", () => {
  const consoleSource = fs.readFileSync(new URL("../components/moderation/ModerationConsole.jsx", import.meta.url), "utf8");
  const adminSource = fs.readFileSync(new URL("../screens/AdminScreen.jsx", import.meta.url), "utf8");

  assert.match(consoleSource, /const REPORT_PAGE_SIZE = 30/);
  assert.match(consoleSource, /const MEMBER_PAGE_SIZE = 40/);
  assert.match(consoleSource, /loadMoreModerationConsole/);
  assert.match(consoleSource, /loadMoreAdminMembersStrict/);
  assert.match(consoleSource, /actionInFlight\.current/);
  assert.match(consoleSource, /new AbortController\(\)/);
  assert.match(consoleSource, /accessibilityRole="search"/);
  assert.match(consoleSource, /minHeight: 44/);
  assert.match(consoleSource, /permanently queued for deletion/);
  assert.match(consoleSource, /never the deleted media/);
  assert.match(consoleSource, /Only this exact message will be hidden from both participants/);
  assert.match(consoleSource, /will not send another notification/);
  assert.match(adminSource, /adminMemberDirectory=\{adminMemberDirectory\}/);
  assert.equal((adminSource.match(/dismissReport\(r\.id\)/g) || []).length, 1,
    "pin/no-video actions use the server's disposition; only the explicit Dismiss button writes dismiss");
});
