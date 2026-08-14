import { staffScopeFor } from "./staffReadCoordinator.mjs";

const TARGET_LABELS = {
  post: "Post",
  comment: "Comment",
  user: "Member",
  message: "Direct message",
  fan_message: "Fan club message",
  lounge_message: "Lounge message",
  venue_review: "Venue review",
};

const DIRECTLY_REMOVABLE_TARGETS = new Set([
  "post",
  "comment",
  "fan_message",
  "lounge_message",
  "venue_review",
]);

const safeText = (value) => (typeof value === "string" ? value.trim() : "");
const lower = (value) => safeText(value).toLowerCase();

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
  } else if (type === "message") {
    title = `Private message by ${author?.name || "a member"}`;
    excerpt = "Message text stays private in this queue. Review the report reason and author context.";
    metadata = content.createdAt ? formatModerationTimestamp(content.createdAt, { includeTime: false, fallback: "" }) : "";
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
  return { target: { title, excerpt, metadata, missing: !exists, removed: !!content.removed }, author };
}

export function moderationTargetLabel(targetType) {
  const normalized = lower(targetType) || "post";
  return TARGET_LABELS[normalized] || normalized.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function canRemoveReportTarget(targetType) {
  return DIRECTLY_REMOVABLE_TARGETS.has(lower(targetType) || "post");
}

export function trackReportDetails(report) {
  if (report?.content?.type === "track") return {
    title: safeText(report.content.title) || report.targetId || "Song report",
    artist: safeText(report.content.artist),
    category: safeText(report.content.category) || "other",
    note: safeText(report.content.note) || safeText(report.reason),
    suggestedVideoId: safeText(report.content.suggestedVideoId),
  };
  try {
    const parsed = JSON.parse(report?.reason || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {}
  return { title: report?.targetId || "Song report", artist: "", category: "other", note: safeText(report?.reason), suggestedVideoId: "" };
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
