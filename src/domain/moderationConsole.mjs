import { staffScopeFor } from "./staffReadCoordinator.mjs";

const TARGET_LABELS = {
  post: "Post",
  comment: "Comment",
  user: "Member",
  message: "Direct message",
  fan_message: "Fan club message",
  lounge_message: "Lounge message",
  venue_review: "Venue review",
  artist_post: "Artist update",
  artist_profile: "Artist profile",
};

const DIRECTLY_REMOVABLE_TARGETS = new Set([
  "post",
  "comment",
  "message",
  "fan_message",
  "lounge_message",
  "venue_review",
  "artist_post",
  "artist_profile",
]);

const safeText = (value) => (typeof value === "string" ? value.trim() : "");
const lower = (value) => safeText(value).toLowerCase();
const ACCOUNT_ROLES = new Set(["fan", "artist", "moderator", "admin"]);
const HEAD_ROLES = new Set(["moderator", "admin"]);

export function moderationMemberIsLockedOwner(member) {
  return member?.owner === true;
}

export function roleChangeRequiresOwnerApproval(currentRole, requestedRole) {
  return HEAD_ROLES.has(lower(currentRole)) || HEAD_ROLES.has(lower(requestedRole));
}

// A successful request is not necessarily an applied mutation: privileged
// transitions return `pending: true` until the Founder acts. Only the exact
// role and handle echoed by an applied server response may update local state.
export function confirmedRoleMutationPatch(result) {
  if (!result || result.ok === false || result.pending === true) return null;
  const role = lower(result.role);
  const handle = safeText(result.handle).replace(/^@+/, "");
  return ACCOUNT_ROLES.has(role) && handle ? { role, handle } : null;
}

export function adminPlaybackHealthPresentation(health) {
  const services = health?.services;
  if (!services || typeof services.youtubeConfigured !== "boolean") {
    return {
      status: "unknown",
      bad: false,
      configured: null,
      message: "Playback diagnostics are unavailable.",
      detail: "Refresh the moderation overview. This does not mean the YouTube key is missing.",
    };
  }

  const lookup = services.youtubeLookup || {};
  const configured = services.youtubeConfigured;
  const paused = !!lookup.circuitOpen;
  const used = lookup.search?.used ?? null;
  const limit = lookup.search?.limit ?? null;
  const remaining = lookup.search?.remaining ?? null;
  const actor = lookup.actorAllowance || null;
  const actorUsed = actor?.used ?? null;
  const actorLimit = actor?.limit ?? null;
  const actorRemaining = actor?.remaining ?? null;
  const sharedSpent = configured && remaining != null && remaining <= 0;
  const actorSpent = configured && actor?.eligible === true && actorRemaining != null && actorRemaining <= 0;
  const sharedDetail = used == null
    ? "Shared provider usage unavailable"
    : `Shared provider searches: ${used}${limit != null ? ` of ${limit}` : ""}${remaining != null ? ` / ${remaining} left` : ""}`;
  const actorDetail = !actor
    ? "Current-account allowance unavailable"
    : actor.eligible
      ? `This account: ${actorUsed ?? 0}${actorLimit != null ? ` of ${actorLimit}` : ""} explicit new-track lookups${actorRemaining != null ? ` / ${actorRemaining} left` : ""}${actor.adminBypass ? " / admin verification bypass" : ""}`
      : "This account cannot start a cold lookup until its email is verified";
  const detail = `${sharedDetail} / ${actorDetail}${lookup.inFlight ? ` / ${lookup.inFlight} in flight` : ""}`;

  if (!configured) {
    return {
      status: "unconfigured",
      bad: true,
      configured,
      message: "No YouTube API key. Every song falls back to a 30-second preview.",
      detail: "Set YOUTUBE_API_KEY in the server environment, then redeploy.",
    };
  }
  if (paused) {
    return {
      status: "paused",
      bad: true,
      configured,
      message: `Lookup paused (${lookup.circuitCode || "provider error"}). Songs fall back to previews until it resumes.`,
      detail,
    };
  }
  if (actor && actor.eligible === false) {
    return {
      status: "account_ineligible",
      bad: true,
      configured,
      message: "This staff account is not eligible for new YouTube lookups.",
      detail: `${sharedDetail} / Verify this account's email. Cached and catalogue tracks still play.`,
    };
  }
  if (actorSpent) {
    return {
      status: "actor_spent",
      bad: true,
      configured,
      message: "This account's explicit new-track allowance is used for today.",
      detail: `${detail} / Resets at midnight Pacific; cached and catalogue tracks still play.`,
    };
  }
  if (sharedSpent) {
    return {
      status: "shared_spent",
      bad: true,
      configured,
      message: "Today's shared YouTube search allowance is used.",
      detail: `${detail} / Resets at midnight Pacific; uncached songs use previews until then.`,
    };
  }
  return {
    status: "healthy",
    bad: false,
    configured,
    message: "Configured and running.",
    detail,
  };
}

export function normalizeAdminMemberQuery(value, maxLength = 80) {
  const limit = Math.max(1, Number.isFinite(Number(maxLength)) ? Math.floor(Number(maxLength)) : 80);
  return safeText(value).replace(/^@+/, "").trim().slice(0, limit);
}

export function staffActionStillOwned(initiatingScope, currentSession) {
  return !!initiatingScope && initiatingScope === staffScopeFor(currentSession);
}

function timestampValue(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value !== "string" || !value.trim()) return NaN;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return Date.parse(value);
}

export function formatModerationTimestamp(value, { includeTime = true, fallback = "Unknown time", locale } = {}) {
  const timestamp = timestampValue(value);
  if (!Number.isFinite(timestamp)) return fallback;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return fallback;
  const options = includeTime
    ? { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }
    : { year: "numeric", month: "short", day: "numeric" };
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return date.toISOString();
  }
}

export function nextVisibleLimit(current, total, pageSize) {
  const safeTotal = Math.max(0, Number.isFinite(Number(total)) ? Math.floor(Number(total)) : 0);
  const safePage = Math.max(1, Number.isFinite(Number(pageSize)) ? Math.floor(Number(pageSize)) : 1);
  const safeCurrent = Math.max(0, Number.isFinite(Number(current)) ? Math.floor(Number(current)) : 0);
  return Math.min(safeTotal, safeCurrent + safePage);
}

export function reconcileSelectedMemberId(selectedId, filteredMembers, { wide = false } = {}) {
  const rows = Array.isArray(filteredMembers) ? filteredMembers : [];
  if (selectedId && rows.some((member) => member?.id === selectedId)) return selectedId;
  return wide ? (rows[0]?.id || null) : null;
}

function groupsToItems(groups) {
  return Object.entries(groups || {}).flatMap(([groupKey, items]) =>
    (Array.isArray(items) ? items : []).map((item) => ({ ...item, groupKey }))
  );
}

function publicMember(member) {
  if (!member) return null;
  return {
    id: member.id || null,
    name: safeText(member.name) || "Unknown member",
    handle: safeText(member.handle),
    role: safeText(member.role) || "fan",
    initials: member.initials || null,
    avatarUri: member.avatarUri || null,
    avatarColor: member.avatarColor || null,
    isBanned: !!member.isBanned,
    suspendedUntil: member.suspendedUntil || null,
  };
}

function embeddedTargetContext(report, type) {
  const content = report?.content;
  if (!content || typeof content !== "object") return null;
  const exists = content.exists !== false;
  const embeddedUser = type === "user" ? content.user : null;
  const author = publicMember(content.author || embeddedUser);
  let title = `${moderationTargetLabel(type)} ${report.targetId || "(unknown ID)"}`;
  let excerpt = "A text preview is unavailable for this target.";
  let metadata = "";

  if (type === "post") {
    title = content.postKind === "status"
      ? `${author?.name || "A member"}'s update`
      : safeText(content.artist) || `${author?.name || "A member"}'s concert post`;
    excerpt = safeText(content.excerpt) || (content.mediaCount ? `${content.mediaCount} attached photo${content.mediaCount === 1 ? "" : "s"}` : excerpt);
    metadata = [content.venue, content.createdAt ? formatModerationTimestamp(content.createdAt, { includeTime: false, fallback: "" }) : ""].map(safeText).filter(Boolean).join(" / ");
  } else if (type === "comment") {
    title = `Comment by ${author?.name || "a member"}`;
    excerpt = safeText(content.excerpt) || excerpt;
    metadata = content.postId ? `On post ${content.postId}` : "";
  } else if (type === "user") {
    title = embeddedUser?.name || "Member report";
    excerpt = [embeddedUser?.handle ? `@${embeddedUser.handle}` : "", embeddedUser?.role || "fan"].filter(Boolean).join(" / ");
    metadata = content.restricted ? "Account is currently restricted" : "Account is currently active";
  } else if (type === "fan_message") {
    title = `${moderationTargetLabel(type)} by ${author?.name || "a member"}`;
    excerpt = safeText(content.excerpt) || excerpt;
    metadata = safeText(content.artist);
  } else if (type === "lounge_message") {
    title = `${moderationTargetLabel(type)} by ${author?.name || "a member"}`;
    excerpt = safeText(content.excerpt) || excerpt;
    metadata = safeText(content.loungeId);
  } else if (type === "venue_review") {
    title = `Venue review by ${author?.name || "a member"}`;
    excerpt = safeText(content.excerpt) || excerpt;
    metadata = [content.venueKey, content.rating ? `${content.rating}/5` : "", content.mediaCount ? `${content.mediaCount} photos` : ""].map(safeText).filter(Boolean).join(" / ");
  } else if (type === "artist_post") {
    title = `Artist update by ${author?.name || "a member"}`;
    excerpt = safeText(content.excerpt) || excerpt;
    metadata = safeText(content.artistKey);
  } else if (type === "artist_profile") {
    title = `${safeText(content.artistKey) || "Artist"} profile`;
    excerpt = safeText(content.excerpt) || (content.mediaCount ? `${content.mediaCount} profile image${content.mediaCount === 1 ? "" : "s"}` : excerpt);
    metadata = [author?.handle ? `Owned by @${author.handle}` : "", content.mediaCount ? `${content.mediaCount} images` : ""].filter(Boolean).join(" / ");
  } else if (type === "message") {
    title = `Private message by ${author?.name || "a member"}`;
    excerpt = safeText(content.excerpt) || "The reported message has no text preview.";
    metadata = [
      content.recipient?.handle ? `To @${content.recipient.handle}` : "",
      content.createdAt ? formatModerationTimestamp(content.createdAt, { includeTime: false, fallback: "" }) : "",
    ].filter(Boolean).join(" / ");
  } else if (type === "track") {
    title = safeText(content.title) || report.targetId || "Song report";
    excerpt = [content.artist, content.note].map(safeText).filter(Boolean).join(" / ") || "Open the Songs workflow to review playback evidence.";
    metadata = safeText(content.category).replaceAll("_", " ");
  }

  if (!exists) {
    excerpt = "The server could not find this target. Dismiss the stale report after reviewing its reason.";
    metadata = "Target no longer exists";
  } else if (content.removed) {
    metadata = [metadata, "Already removed"].filter(Boolean).join(" / ");
  }
  return { target: {
    title,
    excerpt,
    metadata,
    reportedMedia: content.reportedMediaTrusted === true ? (safeText(content.reportedMedia) || null) : null,
    reportedMediaTrusted: content.reportedMediaTrusted === true,
    reportedMediaUnavailable: !!content.reportedMediaUnavailable,
    missing: !exists,
    removed: !!content.removed,
  }, author };
}

export function moderationTargetLabel(targetType) {
  const normalized = lower(targetType) || "post";
  return TARGET_LABELS[normalized] || normalized.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function canRemoveReportTarget(targetType) {
  return DIRECTLY_REMOVABLE_TARGETS.has(lower(targetType) || "post");
}

export function trackReportDetails(report) {
  const details = (value, fallbackReason = "") => {
    const provider = lower(value?.provider);
    const rawSourceId = safeText(value?.sourceId);
    const sourceId = provider === "deezer" && /^\d{1,20}$/.test(rawSourceId)
      ? rawSourceId
      : provider === "spotify" && /^[A-Za-z0-9]{1,64}$/.test(rawSourceId)
        ? rawSourceId
        : null;
    return {
      title: safeText(value?.title) || report?.targetId || "Song report",
      artist: safeText(value?.artist),
      category: safeText(value?.category) || "other",
      note: safeText(value?.note) || safeText(fallbackReason),
      suggestedVideoId: safeText(value?.suggestedVideoId),
      provider: sourceId ? provider : null,
      sourceId,
    };
  };
  if (report?.content?.type === "track") return details(report.content, report.reason);
  try {
    const parsed = JSON.parse(report?.reason || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return details(parsed);
  } catch {}
  return details({}, report?.reason);
}

export function moderationMemberStatus(member, now = Date.now()) {
  if (member?.isBanned) return "banned";
  const suspendedUntil = Number(member?.suspendedUntil);
  if (Number.isFinite(suspendedUntil) && suspendedUntil > now) return "suspended";
  return "active";
}

// Apply a member mutation to the authoritative people embedded in a queue
// snapshot. This is the only local overlay allowed on server-projected author
// state: it represents a write that completed after that snapshot was loaded.
export function patchModerationMemberContext(consoleState, memberId, patch) {
  if (!consoleState || !memberId || !patch || typeof patch !== "object") return consoleState;
  const patchPerson = (person) => person?.id === memberId ? { ...person, ...patch } : person;
  const patchReport = (report) => {
    if (!report || typeof report !== "object") return report;
    const content = report.content && typeof report.content === "object" ? report.content : null;
    const nextContent = content ? {
      ...content,
      ...(content.author ? { author: patchPerson(content.author) } : {}),
      ...(content.user ? { user: patchPerson(content.user) } : {}),
    } : content;
    return {
      ...report,
      ...(report.reporter ? { reporter: patchPerson(report.reporter) } : {}),
      ...(nextContent ? { content: nextContent } : {}),
    };
  };
  return {
    ...consoleState,
    reports: Array.isArray(consoleState.reports) ? consoleState.reports.map(patchReport) : consoleState.reports,
    recentActions: Array.isArray(consoleState.recentActions)
      ? consoleState.recentActions.map((action) => ({ ...action, actor: patchPerson(action.actor) }))
      : consoleState.recentActions,
  };
}

export function buildModerationReportRows(
  reports,
  { posts = [], users = [], comments = {}, fanClubMessages = {}, loungeMessages = {} } = {},
) {
  const userById = new Map((Array.isArray(users) ? users : []).map((user) => [user.id, user]));
  const postById = new Map((Array.isArray(posts) ? posts : []).map((post) => [post.id, post]));
  const commentById = new Map(groupsToItems(comments).map((comment) => [comment.id, comment]));
  const fanMessageById = new Map(groupsToItems(fanClubMessages).map((message) => [message.id, message]));
  const loungeMessageById = new Map(groupsToItems(loungeMessages).map((message) => [message.id, message]));

  return (Array.isArray(reports) ? reports : [])
    .filter((report) => report && report.status !== "dismissed" && report.status !== "actioned")
    .map((report) => {
      const type = lower(report.targetType) || "post";
      const reporter = publicMember(report.reporter || userById.get(report.reporterId));
      let target = null;
      let author = null;
      let title = `${moderationTargetLabel(type)} ${report.targetId || "(unknown ID)"}`;
      let excerpt = "A preview is not available in this device cache.";
      let metadata = "";

      const embedded = embeddedTargetContext(report, type);
      if (embedded) {
        target = report.content.exists === false ? null : report.content;
        // This projection came from the same authoritative staff response as the
        // report. A device-wide profile cache may be days old (or belong to a
        // previous staff session), so it must never replace role/restriction state.
        // Store mutations that are newer than this response update the embedded
        // report context directly before rendering.
        author = publicMember(embedded.author);
        title = embedded.target.title;
        excerpt = embedded.target.excerpt;
        metadata = embedded.target.metadata;
      }

      if (!embedded && type === "post") {
        target = postById.get(report.targetId) || null;
        const embeddedAuthor = target?.user ? { ...target.user, id: target.userId } : null;
        author = publicMember(userById.get(target?.userId) || embeddedAuthor);
        if (target) {
          title = target.kind === "status"
            ? `${author?.name || "A member"}'s update`
            : safeText(target.artist) || `${author?.name || "A member"}'s concert post`;
          excerpt = safeText(target.review) || safeText(target.text) || "This post has no text preview.";
          metadata = [target.venue, target.city, target.date].map(safeText).filter(Boolean).join(" / ");
        }
      } else if (!embedded && type === "comment") {
        target = commentById.get(report.targetId) || null;
        author = publicMember(userById.get(target?.userId) || target);
        if (target) {
          title = `Comment by ${author?.name || "a member"}`;
          excerpt = safeText(target.text) || "This comment has no text preview.";
          metadata = target.groupKey ? `On post ${target.groupKey}` : "";
        }
      } else if (!embedded && type === "user") {
        target = userById.get(report.targetId) || null;
        author = publicMember(target);
        if (target) {
          title = target.name || "Member report";
          excerpt = [target.handle ? `@${target.handle}` : "", target.role || "fan"].filter(Boolean).join(" / ");
          metadata = target.home?.city || "";
        }
      } else if (!embedded && (type === "fan_message" || type === "lounge_message")) {
        target = (type === "fan_message" ? fanMessageById : loungeMessageById).get(report.targetId) || null;
        author = publicMember(userById.get(target?.userId) || target);
        if (target) {
          title = `${moderationTargetLabel(type)} by ${author?.name || "a member"}`;
          excerpt = safeText(target.text) || "This message has no text preview.";
          metadata = target.groupKey || "";
        }
      }

      const reason = safeText(report.reason) || "No reason provided";
      const row = {
        id: report.id,
        report,
        type,
        typeLabel: moderationTargetLabel(type),
        targetId: report.targetId || "",
        reason,
        createdAt: report.createdAt || null,
        reporter,
        target: embedded?.target || { title, excerpt, metadata, missing: !target, removed: false },
        author,
      };
      row.searchText = lower([
        row.id,
        row.type,
        row.typeLabel,
        row.targetId,
        row.reason,
        row.target.title,
        row.target.excerpt,
        row.target.metadata,
        row.reporter?.name,
        row.reporter?.handle,
        row.author?.name,
        row.author?.handle,
      ].filter(Boolean).join(" "));
      return row;
    });
}

export function filterModerationReports(rows, { query = "", targetType = "all" } = {}) {
  const needle = lower(query);
  const normalizedType = lower(targetType) || "all";
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (normalizedType !== "all" && row.type !== normalizedType) return false;
    return !needle || row.searchText.includes(needle);
  });
}

export function summarizeModerationReports(rows) {
  return (Array.isArray(rows) ? rows : []).reduce((summary, row) => {
    summary.total += 1;
    summary.byType[row.type] = (summary.byType[row.type] || 0) + 1;
    if (row.target?.missing) summary.missingContext += 1;
    return summary;
  }, { total: 0, missingContext: 0, byType: {} });
}

export function summarizeModerationMembers(users, now = Date.now()) {
  return (Array.isArray(users) ? users : []).reduce((summary, user) => {
    const status = moderationMemberStatus(user, now);
    summary.total += 1;
    summary[status] += 1;
    if (status !== "active") summary.restricted += 1;
    if (user?.verified) summary.verified += 1;
    const role = lower(user?.role) || "fan";
    summary.byRole[role] = (summary.byRole[role] || 0) + 1;
    return summary;
  }, { total: 0, active: 0, suspended: 0, banned: 0, restricted: 0, verified: 0, byRole: {} });
}

export function filterModerationMembers(
  users,
  { query = "", status = "all", role = "all", now = Date.now() } = {},
) {
  const needle = lower(query);
  const normalizedStatus = lower(status) || "all";
  const normalizedRole = lower(role) || "all";
  const statusRank = { banned: 0, suspended: 1, active: 2 };
  const roleRank = { admin: 0, moderator: 1, artist: 2, fan: 3 };

  return (Array.isArray(users) ? users : [])
    .filter((user) => {
      const memberStatus = moderationMemberStatus(user, now);
      if (normalizedStatus === "restricted" && memberStatus === "active") return false;
      if (!["all", "restricted"].includes(normalizedStatus) && memberStatus !== normalizedStatus) return false;
      if (normalizedRole !== "all" && lower(user?.role) !== normalizedRole) return false;
      if (!needle) return true;
      return lower([user?.name, user?.handle, user?.home?.city, user?.id].filter(Boolean).join(" ")).includes(needle);
    })
    .sort((left, right) => {
      const leftStatus = moderationMemberStatus(left, now);
      const rightStatus = moderationMemberStatus(right, now);
      return (statusRank[leftStatus] - statusRank[rightStatus])
        || ((roleRank[lower(left?.role)] ?? 4) - (roleRank[lower(right?.role)] ?? 4))
        || safeText(left?.name).localeCompare(safeText(right?.name));
    });
}
