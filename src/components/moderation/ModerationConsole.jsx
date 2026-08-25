import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";

import Avatar from "../Avatar";
import Badge from "../Badge";
import Icon from "../Icon";
import SmartImage from "../SmartImage";
import { isVideoUrl } from "../../lib/img";
import { colors, mono, radius, space } from "../../theme";
import {
  buildModerationReportRows,
  canRemoveReportTarget,
  filterModerationMembers,
  filterModerationReports,
  formatModerationTimestamp,
  moderationMemberIsLockedOwner,
  moderationMemberStatus,
  nextVisibleLimit,
  reconcileSelectedMemberId,
  roleChangeRequiresOwnerApproval,
  summarizeModerationMembers,
  summarizeModerationReports,
} from "../../domain/moderationConsole.mjs";

const ROLES = ["fan", "artist", "moderator", "admin"];
const MEMBER_PAGE_SIZE = 40;
const REPORT_PAGE_SIZE = 30;
const IRREVERSIBLE_MEDIA_TARGETS = new Set(["post", "venue_review", "artist_profile"]);

const roleColor = (role) => (
  role === "admin" ? colors.magenta
    : role === "moderator" ? colors.good
      : role === "artist" ? colors.amber
        : colors.textDim
);

const statusColor = (status) => (
  status === "banned" ? colors.danger
    : status === "suspended" ? colors.gold
      : colors.good
);

const errorText = (error, fallback) => {
  if (typeof error === "string" && error.trim()) return error;
  if (typeof error?.message === "string" && error.message.trim()) return error.message;
  return fallback;
};

function ActionButton({ label, icon, tone = "neutral", disabled, busy = false, hint, onPress, compact = false }) {
  const ink = tone === "danger" ? colors.danger : tone === "warning" ? colors.gold : tone === "success" ? colors.good : colors.textDim;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ busy: !!busy, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        compact && styles.actionButtonCompact,
        tone === "danger" && styles.actionDanger,
        tone === "warning" && styles.actionWarning,
        tone === "success" && styles.actionSuccess,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {icon ? <Icon name={icon} size={14} color={ink} /> : null}
      <Text style={[styles.actionButtonText, { color: ink }]}>{label}</Text>
    </Pressable>
  );
}

function FilterPill({ label, count, selected, disabled = false, onPress }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${label}${Number.isFinite(count) ? `, ${count}` : ""}`}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.filterPill, selected && styles.filterPillSelected, pressed && !disabled && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={[styles.filterPillText, selected && styles.filterPillTextSelected]}>{label}</Text>
      {Number.isFinite(count) ? <Text style={[styles.filterCount, selected && styles.filterCountSelected]}>{count}</Text> : null}
    </Pressable>
  );
}

function Feedback({ feedback, onClear }) {
  if (!feedback) return null;
  const bad = feedback.tone === "error";
  const pending = feedback.tone === "pending";
  const color = bad ? colors.danger : pending ? colors.gold : colors.good;
  return (
    <View
      accessibilityLiveRegion={bad ? "assertive" : "polite"}
      style={[styles.feedback, bad ? styles.feedbackError : pending ? styles.feedbackPending : styles.feedbackSuccess]}
    >
      <Icon name={bad ? "x" : pending ? "clock" : "check"} size={15} color={color} />
      <Text selectable style={[styles.feedbackText, { color }]}>{feedback.message}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss message" hitSlop={8} onPress={onClear} style={styles.iconButton}>
        <Icon name="x" size={14} color={colors.textDim} />
      </Pressable>
    </View>
  );
}

function Confirmation({ request, busy, onCancel, onConfirm }) {
  if (!request) return null;
  return (
    <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.confirmBox}>
      <View style={styles.confirmIcon}><Icon name={request.icon || "shield"} size={17} color={request.tone === "danger" ? colors.danger : colors.gold} /></View>
      <View style={styles.confirmCopy}>
        <Text style={styles.confirmTitle}>{request.title}</Text>
        <Text style={styles.confirmDetail}>{request.detail}</Text>
        <View style={styles.actionRow}>
          <ActionButton label="Cancel" compact disabled={busy} onPress={onCancel} />
          <ActionButton
            label={busy ? "Working..." : request.confirmLabel}
            icon={busy ? null : request.icon}
            compact
            tone={request.tone || "warning"}
            disabled={busy}
            busy={busy}
            onPress={onConfirm}
          />
          {busy ? <ActivityIndicator accessibilityLabel="Action in progress" color={colors.amber} size="small" /> : null}
        </View>
      </View>
    </View>
  );
}

function SearchField({ value, onChangeText, placeholder, label, resultCount }) {
  return (
    <View style={styles.searchField}>
      <Icon name="search" size={16} color={colors.textDim} />
      <TextInput
        accessibilityRole="search"
        accessibilityLabel={label}
        accessibilityHint="Results update while you type"
        accessibilityValue={Number.isFinite(resultCount) ? { text: `${resultCount} result${resultCount === 1 ? "" : "s"}` } : undefined}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        enterKeyHint="search"
        onChangeText={onChangeText}
        onSubmitEditing={Keyboard.dismiss}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        returnKeyType="search"
        submitBehavior="blurAndSubmit"
        style={styles.searchInput}
        value={value}
      />
    </View>
  );
}

function SummaryCard({ label, value, tone = "neutral", detail, onPress }) {
  const valueColor = tone === "danger" ? colors.danger : tone === "warning" ? colors.gold : tone === "success" ? colors.good : colors.text;
  const content = (
    <>
      <Text style={[styles.summaryValue, { color: valueColor }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
      {detail ? <Text style={styles.summaryDetail}>{detail}</Text> : null}
    </>
  );
  if (!onPress) return <View style={styles.summaryCard}>{content}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${value}`} accessibilityHint="Opens this moderation workspace" onPress={onPress} style={({ pressed }) => [styles.summaryCard, styles.summaryCardLink, pressed && styles.pressed]}>
      {content}
      <Icon name="chevron-right" size={15} color={colors.textFaint} />
    </Pressable>
  );
}

function QueueLanding({ reportSummary, contentReportCount, memberSummary, memberStats, recentActions, trackCount, onOpenReports, onOpenMembers, onOpenSongs, loading }) {
  const memberDirectoryTruncated = memberSummary.total > 0 && Number(memberStats?.total) > memberSummary.total;
  return (
    <View style={styles.sectionStack}>
      <View style={styles.sectionHeadingRow}>
        <View style={styles.sectionHeadingCopy}>
          <Text style={styles.eyebrow}>STAFF WORKSPACE</Text>
          <Text style={styles.sectionTitle}>What needs attention</Text>
          <Text style={styles.sectionIntro}>Start with open community reports, then review restricted accounts. Queue counts refresh from the server.</Text>
        </View>
        {loading ? <ActivityIndicator accessibilityLabel="Refreshing moderation counts" color={colors.amber} /> : null}
      </View>
      <View style={styles.summaryGrid}>
        <SummaryCard label="open content reports" value={contentReportCount} tone={contentReportCount ? "danger" : "success"} detail={contentReportCount > reportSummary.total ? `${reportSummary.total} loaded for triage` : reportSummary.missingContext ? `${reportSummary.missingContext} missing target` : "Ready to triage"} onPress={onOpenReports} />
        <SummaryCard label="open song reports" value={trackCount} tone={trackCount ? "warning" : "success"} detail="Playback workflow" onPress={onOpenSongs} />
        <SummaryCard label="restricted in loaded members" value={memberSummary.restricted} tone={memberSummary.restricted ? "warning" : "success"} detail={memberDirectoryTruncated ? `Newest ${memberSummary.total}; ${memberStats.banned || 0} banned globally` : `${memberSummary.suspended} timed out / ${memberSummary.banned} banned`} onPress={onOpenMembers} />
      </View>
      {memberDirectoryTruncated ? <Text style={styles.guidance}>Member restrictions here cover the newest {memberSummary.total.toLocaleString()} of {Number(memberStats.total).toLocaleString()} accounts. Open Members for the scoped filters and global totals.</Text> : null}
      <View style={styles.auditCard}>
        <View style={styles.auditHeading}>
          <Icon name="shield" size={15} color={colors.cool} />
          <Text accessibilityRole="header" style={styles.auditTitle}>RECENT MODERATION</Text>
        </View>
        {!recentActions?.length ? <Text style={styles.emptyText}>No recent actions returned by the server.</Text> : recentActions.slice(0, 5).map((action) => (
          <View key={action.id} style={styles.auditRow}>
            <Text style={styles.auditAction}>{String(action.action || "action").replaceAll("_", " ")}</Text>
            <Text selectable style={styles.auditMeta} numberOfLines={1}>{[action.targetType || "target", action.targetId || "", action.actor?.handle ? `@${action.actor.handle}` : "staff"].filter(Boolean).join(" / ")}</Text>
            <Text selectable style={styles.auditWhen}>{formatModerationTimestamp(action.createdAt)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ReportCard({ row, selfId, canBan, busy, confirmation, onRequest, onConfirm, onCancel }) {
  const authorStatus = moderationMemberStatus(row.author);
  const authorIsSelf = row.author?.id && row.author.id === selfId;
  const authorIsAdmin = row.author?.role === "admin";
  const removable = canRemoveReportTarget(row.type) && !row.target.missing;
  const alreadyRemoved = removable && row.target.removed;
  const irreversibleMediaRemoval = IRREVERSIBLE_MEDIA_TARGETS.has(row.type);
  const privateMessageRemoval = row.type === "message";
  const reportedMedia = row.target.reportedMediaTrusted === true && /^https?:\/\//i.test(row.target.reportedMedia || "")
    ? row.target.reportedMedia
    : null;
  const reportedVideo = isVideoUrl(reportedMedia);
  return (
    <View style={[styles.reportCard, row.target.missing && styles.cardWarning]}>
      <View style={styles.reportHeader}>
        <View style={styles.typeTag}><Text style={styles.typeTagText}>{row.typeLabel}</Text></View>
        <Text selectable style={styles.reportId}>#{row.id}</Text>
      </View>
      <Text selectable style={styles.reportWhen}>Reported {formatModerationTimestamp(row.createdAt)}</Text>
      <View style={styles.reasonBox}>
        <Icon name="flag" size={14} color={colors.danger} />
        <View style={styles.reasonCopy}>
          <Text style={styles.reasonLabel}>REPORT REASON</Text>
          <Text selectable style={styles.reasonText}>{row.reason}</Text>
        </View>
      </View>
      <View style={styles.targetBox}>
        <Text style={styles.targetLabel}>REPORTED TARGET</Text>
        <Text selectable style={styles.targetTitle}>{row.target.title}</Text>
        {row.target.metadata ? <Text selectable style={styles.targetMeta}>{row.target.metadata}</Text> : null}
        <Text selectable style={styles.targetExcerpt}>{row.target.excerpt}</Text>
        {reportedMedia ? (
          <View style={styles.reportedMediaCard}>
            {reportedVideo ? (
              <View style={styles.reportedVideoPreview}><Icon name="play" size={24} color={colors.amber} /></View>
            ) : (
              <SmartImage uri={reportedMedia} style={styles.reportedMediaPreview} contain={false} accessibilityLabel="Reported attachment preview" />
            )}
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Open exact reported attachment"
              style={styles.reportedMediaLink}
              onPress={() => Linking.openURL(reportedMedia).catch(() => {})}
            >
              <Icon name="external" size={14} color={colors.amber} />
              <Text style={styles.reportedMediaLinkText}>Open exact reported attachment</Text>
            </Pressable>
          </View>
        ) : null}
        {row.target.reportedMediaUnavailable ? (
          <Text style={styles.reportedMediaUnavailable}>The exact reported attachment is no longer attached or cannot be safely previewed. No replacement media was substituted.</Text>
        ) : null}
        <Text selectable style={styles.targetId}>Target ID: {row.targetId || "unavailable"}</Text>
      </View>
      <View style={styles.peopleRow}>
        <View style={styles.personBlock}>
          <Text style={styles.personLabel}>Reported by</Text>
          <Text style={styles.personValue}>{row.reporter?.handle ? `@${row.reporter.handle}` : "Deleted or unavailable member"}</Text>
        </View>
        <View style={styles.personBlock}>
          <Text style={styles.personLabel}>Target author</Text>
          <Text style={styles.personValue}>{row.author?.handle ? `@${row.author.handle}` : "Unavailable"}</Text>
        </View>
      </View>
      {row.type === "track" ? (
        <Text style={styles.guidance}>Review this report in Songs so a verified video can be pinned without removing content.</Text>
      ) : !removable && !row.target.missing && !row.target.removed ? (
        <Text style={styles.guidance}>This target type cannot be removed from the report action. Use member controls when an account restriction is appropriate, or dismiss after review.</Text>
      ) : null}
      <View style={styles.actionRow}>
        {removable ? (
          <ActionButton label={alreadyRemoved ? "Resolve as removed" : "Remove target"} icon={alreadyRemoved ? "check" : "trash"} tone={alreadyRemoved ? "success" : "danger"} disabled={busy} onPress={() => onRequest({
            key: `report:${row.id}:remove`, scope: `report:${row.id}`, title: alreadyRemoved ? "Resolve this report as already removed?" : `Remove this ${row.typeLabel.toLowerCase()}?`,
            detail: alreadyRemoved
              ? (irreversibleMediaRemoval
                ? "The target is already hidden. Resolving also detaches and permanently queues any legacy attached PIT media for deletion. A later restore can return text only."
                : privateMessageRemoval
                  ? "The exact message is already hidden from both participants. This resolves the report without exposing any other message in the conversation."
                  : "The target is already hidden. This marks the open report actioned without changing visibility.")
              : (irreversibleMediaRemoval
                ? "It will be hidden and all attached PIT media will be detached and permanently queued for deletion. A later restore can return text only, never the deleted media."
                : privateMessageRemoval
                  ? "Only this exact message will be hidden from both participants and its notification preview removed. The body stays restricted as adjudication evidence; a staff restore can re-open it but will not send another notification."
                  : "It will be hidden from the community and this report will be marked actioned. The moderation audit records the change."),
            confirmLabel: alreadyRemoved ? "Resolve report" : "Remove target", icon: alreadyRemoved ? "check" : "trash", tone: alreadyRemoved ? "success" : "danger", success: alreadyRemoved ? "Report resolved; target remains removed." : "Target removed and report actioned.",
            run: () => row.actions.moderateReport({ action: "remove", reportId: row.id }),
          })} />
        ) : null}
        <ActionButton label="Dismiss report" icon="check" disabled={busy} onPress={() => onRequest({
          key: `report:${row.id}:dismiss`, scope: `report:${row.id}`, title: "Dismiss this report?",
          detail: "The target will stay visible and the report will leave the open queue. The decision remains in the audit history.",
          confirmLabel: "Dismiss report", icon: "check", success: "Report dismissed.",
          run: () => row.actions.moderateReport({ action: "dismiss", reportId: row.id }),
        })} />
        {!authorIsSelf && !authorIsAdmin && row.author?.id && authorStatus === "active" ? (
          <ActionButton label="Timeout author 7d" icon="clock" tone="warning" disabled={busy} onPress={() => onRequest({
            key: `report:${row.id}:timeout`, scope: `report:${row.id}`, title: `Timeout @${row.author.handle || row.author.name} for 7 days?`,
            detail: "This restricts the account but does not resolve the report. Return to the report afterward to remove or dismiss it.",
            confirmLabel: "Timeout 7 days", icon: "clock", tone: "warning", success: "Member timed out for 7 days. The report is still open.",
            run: () => row.actions.suspendUser(row.author.id, 7),
          })} />
        ) : null}
        {!authorIsSelf && !authorIsAdmin && row.author?.id && canBan && authorStatus !== "banned" ? (
          <ActionButton label="Ban author" icon="x" tone="danger" disabled={busy} onPress={() => onRequest({
            key: `report:${row.id}:ban`, scope: `report:${row.id}`, title: `Ban @${row.author.handle || row.author.name}?`,
            detail: "This blocks the account but does not resolve the report. Return to the report afterward to remove or dismiss it.",
            confirmLabel: "Ban member", icon: "x", tone: "danger", success: "Member banned. The report is still open.",
            run: () => row.actions.banUser(row.author.id),
          })} />
        ) : null}
      </View>
      {authorIsAdmin ? <Text style={styles.guidance}>Administrator accounts require owner review and cannot be restricted from this console.</Text> : null}
      {confirmation?.scope === `report:${row.id}` ? <Confirmation request={confirmation} busy={busy} onCancel={onCancel} onConfirm={onConfirm} /> : null}
    </View>
  );
}

function ReportsWorkspace({ rows, queueSummary, nextCursor, loadingState, loadError, loadingMore, loadMoreError, busy, confirmation, actions, selfId, canBan, onRetry, onLoadMore, onRequest, onConfirm, onCancel }) {
  const [query, setQuery] = useState("");
  const [targetType, setTargetType] = useState("all");
  const [limit, setLimit] = useState(REPORT_PAGE_SIZE);
  const contentRows = useMemo(() => rows.filter((row) => row.type !== "track"), [rows]);
  const loadedTrackCount = rows.length - contentRows.length;
  const summary = useMemo(() => summarizeModerationReports(contentRows), [contentRows]);
  const filtered = useMemo(() => filterModerationReports(contentRows, { query, targetType }), [contentRows, query, targetType]);
  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit]);
  const types = useMemo(() => [...new Set([
    ...Object.keys(summary.byType),
    ...Object.entries(queueSummary?.byType || {}).filter(([type, count]) => type !== "track" && Number(count) > 0).map(([type]) => type),
  ])].sort(), [summary, queueSummary?.byType]);

  useEffect(() => { setLimit(REPORT_PAGE_SIZE); }, [query, targetType]);
  useEffect(() => {
    if (!confirmation?.scope?.startsWith("report:")) return;
    if (!filtered.some((row) => confirmation.scope === `report:${row.id}`)) onCancel();
  }, [confirmation?.scope, filtered, onCancel]);
  const serverOpen = Number(queueSummary?.open);
  const globalOpen = Number.isFinite(serverOpen) ? Math.max(rows.length, serverOpen) : rows.length;
  const serverTrackCount = Number(queueSummary?.byType?.track);
  const trackCount = Math.min(globalOpen, Number.isFinite(serverTrackCount) ? Math.max(loadedTrackCount, serverTrackCount) : loadedTrackCount);
  const globalContentCount = Math.max(0, globalOpen - trackCount);
  const undisplayedOpen = Math.max(0, globalOpen - rows.length);
  const hasOlderPage = !!nextCursor;

  return (
    <View style={styles.sectionStack}>
      <View style={styles.sectionHeadingRow}>
        <View style={styles.sectionHeadingCopy}>
          <Text style={styles.eyebrow}>REPORT QUEUE</Text>
          <Text accessibilityRole="header" style={styles.sectionTitle}>{globalContentCount.toLocaleString()} open content report{globalContentCount === 1 ? "" : "s"}</Text>
          <Text style={styles.loadedCount}>{summary.total.toLocaleString()} loaded on this device</Text>
          <Text style={styles.sectionIntro}>Review the reason, server-projected target, reporter, and author before acting. Removing a direct message hides only that exact message from both participants; attached media on posts, venue reviews, and artist profiles is permanently detached and cannot return on restore.</Text>
        </View>
        <ActionButton label="Refresh queue" icon="discover" compact busy={loadingState === "loading"} disabled={loadingState === "loading" || busy} onPress={onRetry} />
      </View>
      {loadingState === "loading" ? <View style={styles.loadingRow}><ActivityIndicator color={colors.amber} /><Text style={styles.loadingText}>Refreshing the server queue...</Text></View> : null}
      {loadError ? (
        <View accessibilityLiveRegion="assertive" style={[styles.feedback, styles.feedbackError]}>
          <Icon name="x" size={15} color={colors.danger} />
          <Text selectable style={[styles.feedbackText, { color: colors.danger }]}>{loadError} {rows.length ? "The queue shown below may be stale." : ""}</Text>
        </View>
      ) : null}
      {undisplayedOpen ? <Text style={styles.guidance}>{undisplayedOpen.toLocaleString()} older open report{undisplayedOpen === 1 ? " is" : "s are"} outside this loaded window. Search covers loaded reports; {hasOlderPage ? "use Load older reports to reach the rest." : "the count changed while paging, so refresh before continuing."}</Text> : null}
      {trackCount ? <Text style={styles.guidance}>{trackCount} song report{trackCount === 1 ? " is" : "s are"} intentionally routed to Songs for playback-specific review.</Text> : null}
      <SearchField label="Search loaded reports" placeholder="Search loaded reason, author, reporter, or target ID" value={query} onChangeText={setQuery} resultCount={filtered.length} />
      <ScrollView horizontal accessibilityRole="radiogroup" accessibilityLabel="Report type filter" keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        <FilterPill label="All" count={globalContentCount} selected={targetType === "all"} onPress={() => setTargetType("all")} />
        {types.map((type) => <FilterPill key={type} label={rows.find((row) => row.type === type)?.typeLabel || type} count={Number.isFinite(Number(queueSummary?.byType?.[type])) ? Number(queueSummary.byType[type]) : summary.byType[type]} selected={targetType === type} onPress={() => setTargetType(type)} />)}
      </ScrollView>
      {summary.missingContext ? <Text style={styles.guidance}>{summary.missingContext} report{summary.missingContext === 1 ? " has" : "s have"} a target the server can no longer find. Review the reason, then dismiss stale work.</Text> : null}
      <Text accessibilityLiveRegion="polite" style={styles.resultCount}>{filtered.length} matching / {visible.length} rendered</Text>
      {!filtered.length && loadingState !== "loading" ? <Text style={styles.emptyText}>{undisplayedOpen ? "No loaded reports match these filters yet. Load older reports to continue searching." : summary.total ? "No loaded reports match these filters." : "No open content reports."}</Text> : null}
      {visible.map((row) => <ReportCard key={row.id} row={{ ...row, actions }} selfId={selfId} canBan={canBan} busy={busy} confirmation={confirmation} onRequest={onRequest} onConfirm={onConfirm} onCancel={onCancel} />)}
      {visible.length < filtered.length ? <ActionButton label={`Show ${Math.min(REPORT_PAGE_SIZE, filtered.length - visible.length)} more loaded reports`} icon="chevron-down" disabled={busy} onPress={() => setLimit((current) => nextVisibleLimit(current, filtered.length, REPORT_PAGE_SIZE))} /> : null}
      {hasOlderPage ? <ActionButton label={loadingMore ? "Loading older reports..." : "Load older reports from server"} icon={loadingMore ? null : "chevron-down"} busy={loadingMore} disabled={busy || loadingMore} onPress={async () => { const loaded = await onLoadMore(); if (loaded !== false) setLimit((current) => current + REPORT_PAGE_SIZE); }} /> : null}
      {loadMoreError ? <Text accessibilityLiveRegion="assertive" selectable style={styles.inlineError}>{loadMoreError}</Text> : null}
    </View>
  );
}

function MemberListRow({ member, selected, wide, onPress, expandedDetail }) {
  const status = moderationMemberStatus(member);
  const owner = moderationMemberIsLockedOwner(member);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${owner ? "Review locked Owner" : "Manage"} ${member.name}, @${member.handle}, ${owner ? "Owner, locked" : status}`}
        accessibilityHint={wide ? "Shows member controls beside the directory" : selected ? "Hides member controls" : "Shows member controls below this row"}
        accessibilityState={{ expanded: wide ? undefined : selected, selected }}
        onPress={onPress}
        style={({ pressed }) => [styles.memberListRow, selected && styles.memberListRowSelected, pressed && styles.pressed]}
      >
        <Avatar user={member} size={38} />
        <View style={styles.memberListCopy}>
          <View style={styles.memberNameLine}>
            <Text style={styles.memberName} numberOfLines={1}>{member.name}</Text>
            {member.verified ? <Badge type="verified" size={14} /> : null}
            {owner ? <Badge type="founder" size={14} /> : null}
          </View>
          <Text style={styles.memberHandle} numberOfLines={1}>@{member.handle}{member.home?.city ? ` / ${member.home.city}` : ""}</Text>
        </View>
        {owner ? <View style={styles.ownerLockTag}><Icon name="lock" size={10} color={colors.amber} /><Text style={styles.ownerLockText}>OWNER</Text></View> : <View style={[styles.memberStatus, { borderColor: statusColor(status) }]}><Text style={[styles.memberStatusText, { color: statusColor(status) }]}>{status}</Text></View>}
        <Icon name={!wide && selected ? "chevron-down" : "chevron-right"} size={15} color={colors.textFaint} />
      </Pressable>
      {expandedDetail || null}
    </View>
  );
}

function ControlGroup({ label, children }) {
  return (
    <View style={styles.controlGroup}>
      <Text style={styles.controlLabel}>{label}</Text>
      <View style={styles.controlContent}>{children}</View>
    </View>
  );
}

function MemberDetail({ member, selfId, canAdmin, grantableBadges, busy, confirmation, actions, onRequest, onConfirm, onCancel }) {
  if (!member) return <View style={styles.memberDetailEmpty}><Icon name="you" size={26} color={colors.textFaint} /><Text style={styles.emptyText}>Choose a member to review their account and moderation controls.</Text></View>;
  const self = member.id === selfId;
  const owner = moderationMemberIsLockedOwner(member);
  const status = moderationMemberStatus(member);
  const timed = status === "suspended";
  const banned = status === "banned";
  const scope = `member:${member.id}`;
  const ask = (request) => onRequest({ ...request, scope });
  const confirmChange = ({ key, title, detail, label, icon, tone, success, run }) => ask({ key: `${scope}:${key}`, title, detail, confirmLabel: label, icon, tone, success, run });
  return (
    <View style={[styles.memberDetail, banned && styles.cardDanger, owner && styles.cardOwner]}>
      <View style={styles.memberDetailHeader}>
        <Avatar user={member} size={50} />
        <View style={styles.memberDetailIdentity}>
          <View style={styles.memberNameLine}>
            <Text style={styles.memberDetailName}>{member.name}</Text>
            {member.verified ? <Badge type="verified" size={17} /> : null}
            {owner ? <Badge type="founder" size={17} /> : null}
            {self ? <Text style={styles.youTag}>YOU</Text> : null}
          </View>
          <Text selectable style={styles.memberHandle}>@{member.handle} / {member.id}</Text>
          <View style={styles.identityTags}>
            <View style={[styles.memberStatus, { borderColor: statusColor(status) }]}><Text style={[styles.memberStatusText, { color: statusColor(status) }]}>{status}</Text></View>
            <View style={[styles.memberStatus, { borderColor: roleColor(member.role) }]}><Text style={[styles.memberStatusText, { color: roleColor(member.role) }]}>{member.role}</Text></View>
            {owner ? <View style={styles.ownerLockTag}><Icon name="lock" size={10} color={colors.amber} /><Text style={styles.ownerLockText}>NON-TRANSFERABLE OWNER</Text></View> : null}
          </View>
        </View>
      </View>
      {timed && member.suspendedUntil ? <Text selectable style={styles.guidance}>Timeout ends {formatModerationTimestamp(member.suspendedUntil)}.</Text> : null}
      {owner ? <Text style={styles.guidance}>This is the non-transferable Founder Owner. Role, trust, badges, and account restrictions are locked here and enforced again by the server.</Text> : self ? <Text style={styles.guidance}>Your own role and account restrictions are locked to prevent accidental lockout.</Text> : null}

      {canAdmin && !owner ? (
        <>
          <ControlGroup label="Role">
            {ROLES.map((role) => {
              const needsOwner = roleChangeRequiresOwnerApproval(member.role, role);
              return <FilterPill key={role} label={role} selected={member.role === role} disabled={self || role === member.role || busy} onPress={() => {
                if (self || role === member.role || busy) return;
                confirmChange({
                  key: `role:${role}`,
                  title: needsOwner ? `Request ${role} for @${member.handle}?` : `Change @${member.handle} to ${role}?`,
                  detail: needsOwner
                    ? "This does not change authority now. It creates a 45-minute review request and emails founder@mshpit.com; only the locked Owner can approve or reject it with their password."
                    : "This fan/artist role change applies immediately and is recorded by the server.",
                  label: needsOwner ? `Request ${role}` : `Set ${role}`,
                  icon: "shield",
                  tone: "warning",
                  success: (result) => result?.pending ? result.message || "Awaiting Owner approval. No authority changed." : `Role changed to ${role}.`,
                  run: () => actions.setUserRole(member.id, role),
                });
              }} />;
            })}
          </ControlGroup>
          <ControlGroup label="Trust">
            <ActionButton label={member.verified ? "Remove verification" : "Grant verification"} icon={member.verified ? "x" : "check"} tone={member.verified ? "warning" : "success"} disabled={busy} onPress={() => confirmChange({ key: "verified", title: `${member.verified ? "Remove" : "Grant"} public verification?`, detail: "This controls the public blue check and is separate from email confirmation.", label: member.verified ? "Remove check" : "Grant check", icon: member.verified ? "x" : "check", tone: member.verified ? "warning" : "success", success: member.verified ? "Verification removed." : "Verification granted.", run: () => actions.setVerified(member.id, !member.verified) })} />
            {!member.emailVerified ? <ActionButton label="Mark email confirmed" icon="mail" tone="success" disabled={busy} onPress={() => confirmChange({ key: "email", title: "Mark this email address confirmed?", detail: "This private account flag cannot be undone here and does not grant a public badge.", label: "Confirm email", icon: "mail", tone: "warning", success: "Email marked confirmed.", run: () => actions.markEmailVerified(member.id) })} /> : <Text style={styles.confirmedText}>Email confirmed</Text>}
            <ActionButton label={member.sponsor ? "Remove sponsor mark" : "Grant sponsor mark"} icon={member.sponsor ? "x" : "star"} tone={member.sponsor ? "warning" : "success"} disabled={busy} onPress={() => confirmChange({ key: "sponsor", title: `${member.sponsor ? "Remove" : "Grant"} sponsor mark?`, detail: "This changes the public sponsor badge for this account.", label: member.sponsor ? "Remove mark" : "Grant mark", icon: member.sponsor ? "x" : "star", tone: member.sponsor ? "warning" : "success", success: member.sponsor ? "Sponsor mark removed." : "Sponsor mark granted.", run: () => actions.setSponsor(member.id, !member.sponsor) })} />
          </ControlGroup>
          {(grantableBadges.length || member.badges?.length) ? (
            <ControlGroup label="Badges">
              {grantableBadges.map((badge) => {
                const held = (member.badges || []).some((item) => item.slug === badge.slug);
                const disabled = busy;
                return <Pressable key={badge.slug} accessibilityRole="button" accessibilityLabel={`${held ? "Remove" : "Grant"} ${badge.label} badge`} accessibilityState={{ selected: held, disabled }} disabled={disabled} style={({ pressed }) => [styles.badgeControl, held && styles.badgeControlSelected, pressed && !disabled && styles.pressed, disabled && styles.disabled]} onPress={() => confirmChange({ key: `badge:${badge.slug}`, title: `${held ? "Remove" : "Grant"} ${badge.label}?`, detail: "This changes the member's public badge collection.", label: held ? "Remove badge" : "Grant badge", icon: held ? "x" : "star", tone: held ? "warning" : "success", success: held ? "Badge removed." : "Badge granted.", run: () => actions.toggleMemberBadge(member.id, badge.slug, held) })}><Badge badge={badge} size={14} tooltip={false} /><Text style={[styles.badgeControlText, held && styles.badgeControlTextSelected]}>{badge.label}</Text></Pressable>;
              })}
            </ControlGroup>
          ) : null}
        </>
      ) : null}

      {!owner && !self && member.role !== "admin" ? (
        <ControlGroup label="Moderation">
          {!banned && !timed ? <>
            <ActionButton label="Timeout 1 day" icon="clock" tone="warning" disabled={busy} onPress={() => confirmChange({ key: "timeout:1", title: `Timeout @${member.handle} for 1 day?`, detail: "The member cannot use the account until the timeout expires or staff lift it.", label: "Timeout 1 day", icon: "clock", tone: "warning", success: "Member timed out for 1 day.", run: () => actions.suspendUser(member.id, 1) })} />
            <ActionButton label="Timeout 7 days" icon="clock" tone="warning" disabled={busy} onPress={() => confirmChange({ key: "timeout:7", title: `Timeout @${member.handle} for 7 days?`, detail: "The member cannot use the account until the timeout expires or staff lift it.", label: "Timeout 7 days", icon: "clock", tone: "warning", success: "Member timed out for 7 days.", run: () => actions.suspendUser(member.id, 7) })} />
          </> : null}
          {timed ? <ActionButton label="Lift timeout" icon="check" tone="success" disabled={busy} onPress={() => confirmChange({ key: "lift", title: `Lift @${member.handle}'s timeout?`, detail: "The account will regain access immediately.", label: "Lift timeout", icon: "check", tone: "success", success: "Timeout lifted.", run: () => actions.liftSuspension(member.id) })} /> : null}
          {canAdmin ? (banned
            ? <ActionButton label="Unban member" icon="check" tone="success" disabled={busy} onPress={() => confirmChange({ key: "unban", title: `Unban @${member.handle}?`, detail: "The account will regain access and any timeout will be cleared.", label: "Unban member", icon: "check", tone: "success", success: "Member unbanned.", run: () => actions.unbanUser(member.id) })} />
            : <ActionButton label="Ban member" icon="x" tone="danger" disabled={busy} onPress={() => confirmChange({ key: "ban", title: `Ban @${member.handle}?`, detail: "This blocks account access until an administrator reverses it.", label: "Ban member", icon: "x", tone: "danger", success: "Member banned.", run: () => actions.banUser(member.id) })} />) : null}
        </ControlGroup>
      ) : null}
      {!owner && member.role === "admin" && !self ? <Text style={styles.guidance}>Administrator restrictions stay locked here. Changing this account out of the admin role creates a Founder approval request; it does not change authority immediately.</Text> : null}
      {confirmation?.scope === scope ? <Confirmation request={confirmation} busy={busy} onCancel={onCancel} onConfirm={onConfirm} /> : null}
    </View>
  );
}

function MembersWorkspace({ users, adminStats, directory, loadingState, loadError, loadingMore, loadMoreError, onSearch, onLoadMore, selfId, canAdmin, grantableBadges, memberBadges, busy, confirmation, actions, onRequest, onConfirm, onCancel, wide }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [role, setRole] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [limit, setLimit] = useState(MEMBER_PAGE_SIZE);
  const searchRef = useRef(onSearch);
  searchRef.current = onSearch;
  const hydratedUsers = useMemo(() => users.map((user) => memberBadges[user.id] ? { ...user, badges: memberBadges[user.id] } : user), [users, memberBadges]);
  const summary = useMemo(() => summarizeModerationMembers(hydratedUsers), [hydratedUsers]);
  const total = Number.isFinite(adminStats?.total) ? adminStats.total : summary.total;
  const bannedTotal = Number.isFinite(adminStats?.banned) ? adminStats.banned : summary.banned;
  const verifiedTotal = Number.isFinite(adminStats?.verified) ? adminStats.verified : summary.verified;
  const matchingTotal = Number.isFinite(directory?.matchingTotal) ? Math.max(users.length, directory.matchingTotal) : users.length;
  const directoryTruncated = matchingTotal > users.length;
  const filtered = useMemo(() => filterModerationMembers(hydratedUsers, { query, status, role }), [hydratedUsers, query, status, role]);
  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit]);
  const selected = visible.find((user) => user.id === selectedId) || null;
  const serverScope = useMemo(() => ({
    query: query.trim().slice(0, 80),
    role: ROLES.includes(role) ? role : "",
    status: ["active", "banned", "suspended"].includes(status) ? status : "",
  }), [query, role, status]);
  const scopePending = serverScope.query !== (directory?.query || "") || serverScope.role !== (directory?.role || "") || serverScope.status !== (directory?.status || "");
  const memberActionsBusy = busy || scopePending;

  useEffect(() => { setLimit(MEMBER_PAGE_SIZE); }, [query, status, role]);
  useEffect(() => {
    if (!scopePending) return undefined;
    const timer = setTimeout(() => searchRef.current(serverScope), 350);
    return () => clearTimeout(timer);
  }, [scopePending, serverScope, directory?.query, directory?.role, directory?.status]);
  useEffect(() => {
    if (scopePending && confirmation?.scope?.startsWith("member:")) onCancel();
  }, [scopePending, confirmation?.scope, onCancel]);
  useEffect(() => {
    const reconciled = reconcileSelectedMemberId(selectedId, visible, { wide });
    if (reconciled !== selectedId) {
      setSelectedId(reconciled);
      if (confirmation?.scope?.startsWith("member:")) onCancel();
    }
  }, [wide, selectedId, visible, confirmation?.scope, onCancel]);

  const selectMember = (memberId) => {
    const nextId = selectedId === memberId && !wide ? null : memberId;
    if (nextId !== selectedId && confirmation?.scope?.startsWith("member:")) onCancel();
    setSelectedId(nextId);
  };

  const detailProps = { member: selected, selfId, canAdmin, grantableBadges, busy: memberActionsBusy, confirmation, actions, onRequest, onConfirm, onCancel };
  return (
    <View style={styles.sectionStack}>
      <View style={styles.sectionHeadingRow}>
        <View style={styles.sectionHeadingCopy}>
          <Text style={styles.eyebrow}>MEMBER TRIAGE</Text>
          <Text accessibilityRole="header" style={styles.sectionTitle}>{scopePending || loadingState === "loading" ? "Searching members" : status === "restricted" ? `${filtered.length.toLocaleString()} restricted in loaded results` : `${matchingTotal.toLocaleString()} matching member${matchingTotal === 1 ? "" : "s"}`}</Text>
          <Text style={styles.loadedCount}>{users.length.toLocaleString()} loaded / {total.toLocaleString()} total accounts</Text>
          <Text style={styles.sectionIntro}>Restricted accounts appear first. The Founder Owner is visibly locked. Any change to or from moderator/admin stays pending until the Owner approves it from founder@mshpit.com.</Text>
        </View>
        <ActionButton label="Refresh matching members" icon="discover" compact busy={loadingState === "loading"} disabled={loadingState === "loading" || busy} onPress={() => searchRef.current(serverScope)} />
      </View>
      {loadingState === "loading" ? <View style={styles.loadingRow}><ActivityIndicator color={colors.amber} /><Text style={styles.loadingText}>Refreshing the member directory...</Text></View> : null}
      {loadError ? <View accessibilityLiveRegion="assertive" style={[styles.feedback, styles.feedbackError]}><Icon name="x" size={15} color={colors.danger} /><Text selectable style={[styles.feedbackText, { color: colors.danger }]}>{loadError} {users.length ? "The directory below may be stale or incomplete." : "No member directory is available."}</Text></View> : null}
      {directoryTruncated && status !== "restricted" ? <Text style={styles.guidance}>Showing the newest {users.length.toLocaleString()} of {matchingTotal.toLocaleString()} matches. Search plus supported role/status filters run on the server; visible filter counts apply to loaded rows. Banned and verified summary totals remain global.</Text> : null}
      {status === "restricted" ? <Text style={styles.guidance}>Restricted combines bans and active timeouts across the {users.length.toLocaleString()} loaded rows in the current {matchingTotal.toLocaleString()}-member server scope. Use Banned or Timed out for a complete server-side search across older accounts.</Text> : null}
      <View style={styles.summaryGrid}>
        <SummaryCard label="active" value={summary.active} tone="success" />
        <SummaryCard label="timed out" value={summary.suspended} tone="warning" />
        <SummaryCard label="banned" value={bannedTotal} tone="danger" />
        <SummaryCard label="verified" value={verifiedTotal} />
      </View>
      {adminStats.regions?.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>{adminStats.regions.slice(0, 12).map((region) => <View key={region.city} style={styles.regionTag}><Icon name="pin" size={11} color={colors.cool} /><Text style={styles.regionText}>{region.city}</Text><Text style={styles.filterCount}>{region.count}</Text></View>)}</ScrollView> : null}
      <SearchField label="Search members" placeholder="Search name, @handle, or member ID" value={query} onChangeText={setQuery} resultCount={filtered.length} />
      <ScrollView horizontal accessibilityRole="radiogroup" accessibilityLabel="Member status filter" keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        <FilterPill label="All statuses" count={summary.total} selected={status === "all"} onPress={() => setStatus("all")} />
        <FilterPill label="Restricted" count={summary.restricted} selected={status === "restricted"} onPress={() => setStatus("restricted")} />
        <FilterPill label="Timed out" count={summary.suspended} selected={status === "suspended"} onPress={() => setStatus("suspended")} />
        <FilterPill label="Banned" count={summary.banned} selected={status === "banned"} onPress={() => setStatus("banned")} />
        <FilterPill label="Active" count={summary.active} selected={status === "active"} onPress={() => setStatus("active")} />
      </ScrollView>
      <ScrollView horizontal accessibilityRole="radiogroup" accessibilityLabel="Member role filter" keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        <FilterPill label="Every role" selected={role === "all"} onPress={() => setRole("all")} />
        {ROLES.map((item) => <FilterPill key={item} label={item} count={summary.byRole[item] || 0} selected={role === item} onPress={() => setRole(item)} />)}
      </ScrollView>
      <View style={[styles.memberWorkspace, wide && styles.memberWorkspaceWide]}>
        <View style={[styles.memberList, wide && styles.memberListWide]}>
          <Text accessibilityLiveRegion="polite" style={styles.resultCount}>{filtered.length} result{filtered.length === 1 ? "" : "s"} / {visible.length} rendered</Text>
          {!visible.length && loadingState !== "loading" && !scopePending ? <Text style={styles.emptyText}>No members match these filters.</Text> : visible.map((member) => (
            <MemberListRow
              key={member.id}
              member={member}
              selected={selectedId === member.id}
              wide={wide}
              onPress={() => selectMember(member.id)}
              expandedDetail={!wide && selectedId === member.id ? <MemberDetail {...detailProps} member={member} /> : null}
            />
          ))}
          {visible.length < filtered.length ? <ActionButton label={`Show ${Math.min(MEMBER_PAGE_SIZE, filtered.length - visible.length)} more`} icon="chevron-down" disabled={busy} onPress={() => setLimit((current) => nextVisibleLimit(current, filtered.length, MEMBER_PAGE_SIZE))} /> : null}
          {directory?.nextCursor && !scopePending ? <ActionButton label={loadingMore ? "Loading more members..." : "Load more matching members from server"} icon={loadingMore ? null : "chevron-down"} busy={loadingMore} disabled={busy || loadingMore} onPress={async () => { const loaded = await onLoadMore(); if (loaded !== false) setLimit((current) => current + MEMBER_PAGE_SIZE); }} /> : null}
          {loadMoreError ? <Text accessibilityLiveRegion="assertive" selectable style={styles.inlineError}>{loadMoreError}</Text> : null}
        </View>
        {wide ? <View style={styles.memberDetailColumn}><MemberDetail {...detailProps} /></View> : null}
      </View>
    </View>
  );
}

export default function ModerationConsole({
  mode,
  session,
  isAdmin,
  reports = [],
  moderationConsole = {},
  users = [],
  adminMembers = [],
  adminMemberDirectory = {},
  feed = [],
  comments = {},
  fanClubMessages = {},
  loungeMessages = {},
  adminStats = {},
  grantableBadges = [],
  memberBadges = {},
  loadModerationConsole,
  loadMoreModerationConsole,
  loadAdminMembersStrict,
  loadMoreAdminMembersStrict,
  moderateReport,
  suspendUser,
  liftSuspension,
  banUser,
  unbanUser,
  setUserRole,
  setVerified,
  markEmailVerified,
  setSponsor,
  toggleMemberBadge,
  onOpenReports,
  onOpenMembers,
  onOpenSongs,
}) {
  const { width } = useWindowDimensions();
  const wide = width >= 780;
  const [loadingState, setLoadingState] = useState("idle");
  const [loadError, setLoadError] = useState("");
  const [loadingMoreReports, setLoadingMoreReports] = useState(false);
  const [loadMoreReportError, setLoadMoreReportError] = useState("");
  const [memberLoadingState, setMemberLoadingState] = useState("idle");
  const [memberLoadError, setMemberLoadError] = useState("");
  const [loadingMoreMembers, setLoadingMoreMembers] = useState(false);
  const [loadMoreMemberError, setLoadMoreMemberError] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const queueRequestController = useRef(null);
  const memberRequestController = useRef(null);
  const actionInFlight = useRef(null);
  const activeSessionId = useRef(session?.id);
  activeSessionId.current = session?.id;
  const actionLocked = !!busyKey || loadingState === "loading" || memberLoadingState === "loading" || loadingMoreReports || loadingMoreMembers;

  const requestReports = async ({ append = false } = {}) => {
    queueRequestController.current?.abort();
    const controller = new AbortController();
    queueRequestController.current = controller;
    setConfirmation(null);
    if (append) {
      setLoadingMoreReports(true);
      setLoadMoreReportError("");
    } else {
      setLoadingState("loading");
      setLoadError("");
      setLoadingMoreReports(false);
      setLoadMoreReportError("");
    }
    try {
      await (append ? loadMoreModerationConsole : loadModerationConsole)({ signal: controller.signal });
      if (controller.signal.aborted || queueRequestController.current !== controller) return false;
      if (!append) setLoadingState("ready");
      return true;
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError" || queueRequestController.current !== controller) return false;
      if (append) setLoadMoreReportError(errorText(error, "Older reports could not be loaded."));
      else {
        setLoadError(errorText(error, "The moderation queue could not be refreshed."));
        setLoadingState("error");
      }
      return false;
    } finally {
      if (queueRequestController.current === controller) {
        queueRequestController.current = null;
        if (append) setLoadingMoreReports(false);
      }
    }
  };

  const requestMembers = async ({ append = false, query = "", role = "", status = "" } = {}) => {
    memberRequestController.current?.abort();
    const controller = new AbortController();
    memberRequestController.current = controller;
    setConfirmation(null);
    if (append) {
      setLoadingMoreMembers(true);
      setLoadMoreMemberError("");
    } else {
      setMemberLoadingState("loading");
      setMemberLoadError("");
      setLoadingMoreMembers(false);
      setLoadMoreMemberError("");
    }
    try {
      await (append ? loadMoreAdminMembersStrict : loadAdminMembersStrict)({ signal: controller.signal, query, role, status });
      if (controller.signal.aborted || memberRequestController.current !== controller) return false;
      if (!append) setMemberLoadingState("ready");
      return true;
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError" || memberRequestController.current !== controller) return false;
      if (append) setLoadMoreMemberError(errorText(error, "More matching members could not be loaded."));
      else {
        setMemberLoadError(errorText(error, "The member directory could not be refreshed."));
        setMemberLoadingState("error");
      }
      return false;
    } finally {
      if (memberRequestController.current === controller) {
        memberRequestController.current = null;
        if (append) setLoadingMoreMembers(false);
      }
    }
  };

  useEffect(() => {
    if (mode !== "overview" && mode !== "reports") return undefined;
    requestReports();
    return () => {
      queueRequestController.current?.abort();
      queueRequestController.current = null;
    };
  // The loader is a Store closure and may be recreated as Store state changes;
  // mode is the lifecycle boundary for this read, not every provider render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, session?.id]);

  useEffect(() => {
    actionInFlight.current = null;
    setBusyKey(null);
    setConfirmation(null);
    setFeedback(null);
    setLoadingMoreReports(false);
    setLoadMoreReportError("");
    setLoadingMoreMembers(false);
    setLoadMoreMemberError("");
    if (mode === "members") {
      setLoadingState("idle");
      setLoadError("");
    } else if (mode === "reports") {
      setMemberLoadingState("idle");
      setMemberLoadError("");
    }
  }, [mode, session?.id]);

  useEffect(() => {
    if (mode !== "overview" && mode !== "members") return undefined;
    requestMembers();
    return () => {
      memberRequestController.current?.abort();
      memberRequestController.current = null;
    };
  // The Store loader is intentionally keyed to the workspace lifecycle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, session?.id]);

  const sourceReports = moderationConsole.reports?.length || loadingState === "ready"
    ? (moderationConsole.reports || [])
    : reports;
  const rows = useMemo(() => buildModerationReportRows(sourceReports, {
    posts: feed,
    users,
    comments,
    fanClubMessages,
    loungeMessages,
  }), [sourceReports, feed, users, comments, fanClubMessages, loungeMessages]);
  const contentRows = useMemo(() => rows.filter((row) => row.type !== "track"), [rows]);
  const reportSummary = useMemo(() => summarizeModerationReports(contentRows), [contentRows]);
  const memberSummary = useMemo(() => summarizeModerationMembers(adminMembers), [adminMembers]);
  const loadedTrackCount = rows.length - contentRows.length;
  const serverOpen = Number(moderationConsole.summary?.open);
  const globalOpen = Number.isFinite(serverOpen) ? Math.max(rows.length, serverOpen) : rows.length;
  const serverTrackCount = Number(moderationConsole.summary?.byType?.track);
  const trackCount = Math.min(globalOpen, Number.isFinite(serverTrackCount) ? Math.max(loadedTrackCount, serverTrackCount) : loadedTrackCount);
  const contentReportCount = Math.max(0, globalOpen - trackCount);

  const actions = { moderateReport, suspendUser, liftSuspension, banUser, unbanUser, setUserRole, setVerified, markEmailVerified, setSponsor, toggleMemberBadge };
  const requestAction = (request) => {
    if (actionLocked || actionInFlight.current) return;
    if (!request?.key || !request?.scope || typeof request.run !== "function") {
      setFeedback({ tone: "error", message: "That action is unavailable. Refresh this workspace and try again." });
      return;
    }
    setFeedback(null);
    setConfirmation(request);
  };
  const confirmAction = async () => {
    const request = confirmation;
    if (!request || actionLocked || actionInFlight.current) return;
    const operation = { key: request.key, sessionId: session?.id };
    actionInFlight.current = operation;
    setBusyKey(request.key);
    setFeedback(null);
    try {
      const result = await request.run();
      if (actionInFlight.current !== operation || activeSessionId.current !== operation.sessionId) return;
      if (result === false || result?.ok === false) throw result?.error || new Error("The server did not apply this change.");
      setConfirmation(null);
      const successMessage = typeof request.success === "function" ? request.success(result) : request.success;
      setFeedback({ tone: result?.pending ? "pending" : "success", message: successMessage || result?.message || "Change saved." });
    } catch (error) {
      if (actionInFlight.current !== operation || activeSessionId.current !== operation.sessionId) return;
      setFeedback({ tone: "error", message: errorText(error, "That change was not applied. Review the current state and try again.") });
    } finally {
      if (actionInFlight.current === operation) {
        actionInFlight.current = null;
        setBusyKey(null);
      }
    }
  };
  const cancelAction = useCallback(() => {
    if (!actionInFlight.current) setConfirmation(null);
  }, []);

  return (
    <View style={styles.console}>
      <Feedback feedback={feedback} onClear={() => setFeedback(null)} />
      {mode === "overview" && (loadError || memberLoadError) ? <View accessibilityLiveRegion="assertive" style={[styles.feedback, styles.feedbackError]}><Icon name="x" size={15} color={colors.danger} /><Text selectable style={[styles.feedbackText, { color: colors.danger }]}>{[loadError, memberLoadError].filter(Boolean).join(" ")} Counts shown may be stale.</Text></View> : null}
      {mode === "overview" ? <QueueLanding reportSummary={reportSummary} contentReportCount={contentReportCount} memberSummary={memberSummary} memberStats={adminStats} recentActions={moderationConsole.recentActions || []} trackCount={trackCount} onOpenReports={onOpenReports} onOpenMembers={onOpenMembers} onOpenSongs={onOpenSongs} loading={loadingState === "loading" || memberLoadingState === "loading"} /> : null}
      {mode === "reports" ? <ReportsWorkspace rows={rows} queueSummary={moderationConsole.summary} nextCursor={moderationConsole.nextCursor} loadingState={loadingState} loadError={loadError} loadingMore={loadingMoreReports} loadMoreError={loadMoreReportError} busy={actionLocked} confirmation={confirmation} actions={actions} selfId={session?.id} canBan={isAdmin} onRetry={() => requestReports()} onLoadMore={() => requestReports({ append: true })} onRequest={requestAction} onConfirm={confirmAction} onCancel={cancelAction} /> : null}
      {mode === "members" ? <MembersWorkspace users={adminMembers} adminStats={adminStats} directory={adminMemberDirectory} loadingState={memberLoadingState} loadError={memberLoadError} loadingMore={loadingMoreMembers} loadMoreError={loadMoreMemberError} onSearch={(scope) => requestMembers(scope)} onLoadMore={() => requestMembers({ append: true })} selfId={session?.id} canAdmin={isAdmin} grantableBadges={grantableBadges} memberBadges={memberBadges} busy={actionLocked} confirmation={confirmation} actions={actions} onRequest={requestAction} onConfirm={confirmAction} onCancel={cancelAction} wide={wide} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  console: { gap: space(4) },
  sectionStack: { gap: space(4) },
  sectionHeadingRow: { flexDirection: "row", alignItems: "flex-start", gap: space(3) },
  sectionHeadingCopy: { flex: 1, gap: space(1) },
  eyebrow: { color: colors.amber, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 1.3 },
  sectionTitle: { color: colors.text, fontSize: 23, lineHeight: 29, fontWeight: "900", letterSpacing: -0.5 },
  loadedCount: { color: colors.cool, fontFamily: mono, fontSize: 10, lineHeight: 15, fontWeight: "800", fontVariant: ["tabular-nums"] },
  sectionIntro: { color: colors.textDim, fontSize: 13, lineHeight: 20, maxWidth: 680 },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  summaryCard: { flexGrow: 1, flexBasis: 150, minHeight: 102, padding: space(3), borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.md, backgroundColor: colors.surface, justifyContent: "center", gap: 3 },
  summaryCardLink: { paddingRight: space(8) },
  summaryValue: { fontFamily: mono, fontSize: 25, lineHeight: 30, fontWeight: "900", fontVariant: ["tabular-nums"] },
  summaryLabel: { color: colors.text, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  summaryDetail: { color: colors.textFaint, fontSize: 11, lineHeight: 16 },
  auditCard: { borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.md, backgroundColor: colors.bgElev, padding: space(3), gap: space(2) },
  auditHeading: { flexDirection: "row", alignItems: "center", gap: space(2) },
  auditTitle: { color: colors.cool, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  auditRow: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: space(2), borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: space(2) },
  auditAction: { color: colors.text, fontSize: 12, fontWeight: "800", textTransform: "capitalize" },
  auditMeta: { color: colors.textDim, flex: 1, fontSize: 11 },
  auditWhen: { color: colors.textFaint, fontFamily: mono, fontSize: 10 },
  feedback: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: space(2), borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: space(3), paddingVertical: space(2) },
  feedbackError: { borderColor: colors.danger + "66", backgroundColor: colors.danger + "12" },
  feedbackPending: { borderColor: colors.gold + "66", backgroundColor: colors.gold + "12" },
  feedbackSuccess: { borderColor: colors.good + "66", backgroundColor: colors.good + "12" },
  feedbackText: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: "700" },
  inlineError: { color: colors.danger, fontSize: 12, lineHeight: 18, fontWeight: "700" },
  confirmBox: { marginTop: space(3), flexDirection: "row", gap: space(3), borderWidth: 1, borderColor: colors.gold + "77", borderRadius: radius.md, backgroundColor: colors.gold + "0D", padding: space(3) },
  confirmIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  confirmCopy: { flex: 1, gap: space(1) },
  confirmTitle: { color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: "900" },
  confirmDetail: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  searchField: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: space(2), borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: space(3) },
  searchInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14, paddingVertical: space(3) },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  filterRow: { gap: space(2), paddingRight: space(3) },
  filterPill: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: space(2), paddingHorizontal: space(3), borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, backgroundColor: colors.bgElev },
  filterPillSelected: { borderColor: colors.amber, backgroundColor: colors.amber + "18" },
  filterPillText: { color: colors.textDim, fontSize: 12, fontWeight: "800", textTransform: "capitalize" },
  filterPillTextSelected: { color: colors.amber },
  filterCount: { color: colors.textFaint, fontFamily: mono, fontSize: 10, fontWeight: "800", fontVariant: ["tabular-nums"] },
  filterCountSelected: { color: colors.amber },
  loadingRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: space(2) },
  loadingText: { color: colors.textDim, fontSize: 12 },
  guidance: { color: colors.gold, fontSize: 11, lineHeight: 17, borderLeftWidth: 2, borderLeftColor: colors.gold, paddingLeft: space(2) },
  emptyText: { color: colors.textDim, textAlign: "center", fontSize: 13, lineHeight: 20, paddingVertical: space(5) },
  reportCard: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.surface, padding: space(4), gap: space(3) },
  cardWarning: { borderColor: colors.gold + "88" },
  cardDanger: { borderColor: colors.danger + "88" },
  cardOwner: { borderColor: colors.amber + "99", backgroundColor: colors.amber + "08" },
  reportHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2) },
  typeTag: { borderWidth: 1, borderColor: colors.cool + "77", borderRadius: radius.pill, paddingHorizontal: space(2), paddingVertical: 4, backgroundColor: colors.cool + "10" },
  typeTagText: { color: colors.cool, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 0.7, textTransform: "uppercase" },
  reportId: { color: colors.textFaint, fontFamily: mono, fontSize: 9 },
  reportWhen: { color: colors.textFaint, fontFamily: mono, fontSize: 9, marginTop: -space(2) },
  reasonBox: { flexDirection: "row", alignItems: "flex-start", gap: space(2), borderRadius: radius.sm, backgroundColor: colors.danger + "0D", padding: space(3) },
  reasonCopy: { flex: 1, gap: 3 },
  reasonLabel: { color: colors.danger, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  reasonText: { color: colors.text, fontSize: 13, lineHeight: 19, fontWeight: "700" },
  targetBox: { borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.sm, backgroundColor: colors.bgElev, padding: space(3), gap: 4 },
  targetLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  targetTitle: { color: colors.text, fontSize: 16, lineHeight: 21, fontWeight: "900" },
  targetMeta: { color: colors.amber, fontSize: 11, lineHeight: 16 },
  targetExcerpt: { color: colors.textDim, fontSize: 13, lineHeight: 20, marginTop: space(1) },
  reportedMediaCard: { marginTop: space(2), gap: space(2), overflow: "hidden", borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.surface },
  reportedMediaPreview: { width: "100%", height: 180, backgroundColor: colors.bg },
  reportedVideoPreview: { width: "100%", height: 120, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  reportedMediaLink: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space(2), paddingHorizontal: space(3), paddingBottom: space(2) },
  reportedMediaLinkText: { color: colors.amber, fontSize: 11, fontWeight: "900" },
  reportedMediaUnavailable: { color: colors.gold, fontSize: 11, lineHeight: 17, marginTop: space(2) },
  targetId: { color: colors.textFaint, fontFamily: mono, fontSize: 9, marginTop: space(1) },
  peopleRow: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  personBlock: { flexGrow: 1, flexBasis: 180, gap: 3 },
  personLabel: { color: colors.textFaint, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  personValue: { color: colors.text, fontSize: 12, fontWeight: "700" },
  actionRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2), marginTop: space(1) },
  actionButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space(2), borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.bgElev, paddingHorizontal: space(3), paddingVertical: space(2) },
  actionButtonCompact: { minHeight: 44, paddingHorizontal: space(2) },
  actionDanger: { borderColor: colors.danger + "77", backgroundColor: colors.danger + "0D" },
  actionWarning: { borderColor: colors.gold + "77", backgroundColor: colors.gold + "0D" },
  actionSuccess: { borderColor: colors.good + "77", backgroundColor: colors.good + "0D" },
  actionButtonText: { fontSize: 11, fontWeight: "900" },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
  memberWorkspace: { gap: space(3) },
  memberWorkspaceWide: { flexDirection: "row", alignItems: "flex-start" },
  memberList: { gap: space(2) },
  memberListWide: { flex: 0.9, minWidth: 300 },
  memberDetailColumn: { flex: 1.1, minWidth: 360 },
  resultCount: { color: colors.textFaint, fontFamily: mono, fontSize: 10, fontVariant: ["tabular-nums"] },
  memberListRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: space(2), borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.sm, backgroundColor: colors.surface, padding: space(2) },
  memberListRowSelected: { borderColor: colors.amber, backgroundColor: colors.amber + "0D" },
  memberListCopy: { flex: 1, minWidth: 0 },
  memberNameLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 5 },
  memberName: { color: colors.text, flexShrink: 1, fontSize: 13, fontWeight: "900" },
  memberHandle: { color: colors.textDim, fontSize: 10, lineHeight: 15 },
  memberStatus: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space(2), paddingVertical: 3 },
  memberStatusText: { fontFamily: mono, fontSize: 8, fontWeight: "900", letterSpacing: 0.3, textTransform: "uppercase" },
  ownerLockTag: { minHeight: 24, flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: colors.amber + "88", borderRadius: radius.pill, paddingHorizontal: space(2), backgroundColor: colors.amber + "0D" },
  ownerLockText: { color: colors.amber, fontFamily: mono, fontSize: 8, fontWeight: "900", letterSpacing: 0.4 },
  memberDetail: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.bgElev, padding: space(4), gap: space(4) },
  memberDetailEmpty: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: space(2), borderWidth: 1, borderColor: colors.lineSoft, borderStyle: "dashed", borderRadius: radius.md },
  memberDetailHeader: { flexDirection: "row", alignItems: "center", gap: space(3) },
  memberDetailIdentity: { flex: 1, minWidth: 0, gap: space(1) },
  memberDetailName: { color: colors.text, flexShrink: 1, fontSize: 18, fontWeight: "900" },
  identityTags: { flexDirection: "row", flexWrap: "wrap", gap: space(1) },
  youTag: { color: colors.amber, fontFamily: mono, fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  controlGroup: { borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: space(3), gap: space(2) },
  controlLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 0.9, textTransform: "uppercase" },
  controlContent: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  confirmedText: { color: colors.good, fontSize: 11, fontWeight: "800", paddingVertical: space(3) },
  badgeControl: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: space(2), borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: space(3), backgroundColor: colors.surface },
  badgeControlSelected: { borderColor: colors.amber, backgroundColor: colors.amber + "12" },
  badgeControlText: { color: colors.textDim, fontSize: 11, fontWeight: "800" },
  badgeControlTextSelected: { color: colors.amber },
  regionTag: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: space(1), borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.pill, paddingHorizontal: space(2), backgroundColor: colors.bgElev },
  regionText: { color: colors.textDim, fontSize: 10, fontWeight: "700" },
});
