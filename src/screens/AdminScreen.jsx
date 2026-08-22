import { useState, useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, Alert, Linking, View, Text, StyleSheet, ScrollView, Pressable, TextInput } from "react-native";
import { colors, mono, radius, space } from "../theme";
import { useStore, isStaff, isMod } from "../store";
import { api } from "../lib/api";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import SheetHeader from "../components/SheetHeader";
import EmailConsole from "../components/EmailConsole";
import BadgeConsole from "../components/BadgeConsole";
import ModerationConsole from "../components/moderation/ModerationConsole";
import { normalizeAdminMemberQuery, staffActionStillOwned, trackReportDetails } from "../domain/moderationConsole.mjs";
import { staffScopeFor } from "../domain/staffReadCoordinator.mjs";

// Privacy-bounded first-party product analytics for operator diagnosis. Public
// content trends are kept separate from consented raw interaction counters.
function AdInsights({ adminMembers = [], adminMemberDirectory = {}, loadAdminMembersStrict, session }) {
  const sessionScope = staffScopeFor(session);
  const [analyticsState, setAnalyticsState] = useState({ scope: null, data: null, error: "" });
  const [memberQuery, setMemberQuery] = useState("");
  const [memberSearchState, setMemberSearchState] = useState({ scope: null, query: "", status: "idle", error: "" });
  const [memberDataState, setMemberDataState] = useState({ scope: null, data: null, error: "" });
  const [memberLoading, setMemberLoading] = useState(false);
  const memberSearchController = useRef(null);
  const memberInspectController = useRef(null);
  const memberLoaderRef = useRef(loadAdminMembersStrict);
  memberLoaderRef.current = loadAdminMembersStrict;
  const normalizedMemberQuery = normalizeAdminMemberQuery(memberQuery);

  useEffect(() => {
    if (!sessionScope) return undefined;
    const controller = new AbortController();
    setAnalyticsState({ scope: sessionScope, data: null, error: "" });
    api("/api/admin/analytics", { signal: controller.signal, silent: true, context: "Loading audience analytics" })
      .then((data) => { if (!controller.signal.aborted) setAnalyticsState({ scope: sessionScope, data, error: "" }); })
      .catch((error) => { if (!controller.signal.aborted && error?.name !== "AbortError") setAnalyticsState({ scope: sessionScope, data: null, error: error?.message || "Audience data could not be loaded." }); });
    return () => controller.abort();
  }, [sessionScope]);

  useEffect(() => {
    memberSearchController.current?.abort();
    if (!sessionScope || normalizedMemberQuery.length < 2) {
      setMemberSearchState({ scope: sessionScope, query: normalizedMemberQuery, status: "idle", error: "" });
      return undefined;
    }
    const controller = new AbortController();
    memberSearchController.current = controller;
    setMemberSearchState({ scope: sessionScope, query: normalizedMemberQuery, status: "pending", error: "" });
    const timer = setTimeout(async () => {
      setMemberSearchState({ scope: sessionScope, query: normalizedMemberQuery, status: "loading", error: "" });
      try {
        await memberLoaderRef.current({ signal: controller.signal, query: normalizedMemberQuery });
        if (!controller.signal.aborted && memberSearchController.current === controller) {
          setMemberSearchState({ scope: sessionScope, query: normalizedMemberQuery, status: "ready", error: "" });
        }
      } catch (error) {
        if (!controller.signal.aborted && error?.name !== "AbortError" && memberSearchController.current === controller) {
          setMemberSearchState({ scope: sessionScope, query: normalizedMemberQuery, status: "error", error: error?.message || "Member search could not be completed." });
        }
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
      if (memberSearchController.current === controller) memberSearchController.current = null;
    };
  }, [normalizedMemberQuery, sessionScope]);

  useEffect(() => () => memberInspectController.current?.abort(), [sessionScope]);

  const analyticsCurrent = analyticsState.scope === sessionScope;
  const data = analyticsCurrent ? analyticsState.data : null;
  const err = analyticsCurrent ? analyticsState.error : "";
  const searchCurrent = memberSearchState.scope === sessionScope && memberSearchState.query === normalizedMemberQuery;
  const directoryCurrent = searchCurrent
    && memberSearchState.status === "ready"
    && (adminMemberDirectory.query || "") === normalizedMemberQuery
    && !(adminMemberDirectory.role || adminMemberDirectory.status);
  const memberMatches = directoryCurrent ? adminMembers.slice(0, 6) : [];
  const matchingMemberTotal = directoryCurrent && Number.isFinite(Number(adminMemberDirectory.matchingTotal))
    ? Number(adminMemberDirectory.matchingTotal)
    : memberMatches.length;
  const memberData = memberDataState.scope === sessionScope ? memberDataState.data : null;
  const memberInspectError = memberDataState.scope === sessionScope ? memberDataState.error : "";
  const inspectMember = async (user) => {
    memberInspectController.current?.abort();
    const controller = new AbortController();
    memberInspectController.current = controller;
    setMemberQuery(`@${user.handle}`);
    setMemberLoading(true);
    setMemberDataState({ scope: sessionScope, data: null, error: "" });
    try {
      const memberData = await api(`/api/admin/analytics/users/${user.id}`, { signal: controller.signal, silent: true, context: "Loading member activity" });
      if (!controller.signal.aborted && memberInspectController.current === controller) setMemberDataState({ scope: sessionScope, data: memberData, error: "" });
    } catch (error) {
      if (!controller.signal.aborted && error?.name !== "AbortError" && memberInspectController.current === controller) setMemberDataState({ scope: sessionScope, data: null, error: error?.message || "Member activity could not be loaded." });
    } finally {
      if (memberInspectController.current === controller) {
        memberInspectController.current = null;
        setMemberLoading(false);
      }
    }
  };

  if (err) return <Text selectable style={styles.empty}>{err}</Text>;
  if (!data) return <Text style={styles.empty}>Loading audience data...</Text>;

  const t = data.totals || {};
  const oldestRaw = data.rawWindow?.oldestAt ? new Date(data.rawWindow.oldestAt).toLocaleString() : "none";
  const Stat = ({ n, label }) => (
    <View style={styles.stat}><Text style={styles.statN}>{n ?? 0}</Text><Text style={styles.statL}>{label}</Text></View>
  );
  const List = ({ title, rows, empty = null }) =>
    rows && rows.length ? (
      <View style={styles.insightCol}>
        <Text style={styles.insightH}>{title}</Text>
        {rows.slice(0, 8).map((r, i) => (
          <View key={i} style={styles.insightRow}>
            <Text style={styles.insightLabel} numberOfLines={1}>{r.label}</Text>
            <Text style={styles.insightCount}>{r.count}</Text>
          </View>
        ))}
      </View>
    ) : empty ? (
      <View style={styles.insightCol}>
        <Text style={styles.insightH}>{title}</Text>
        <Text style={styles.analyticsPrivacy}>{empty}</Text>
      </View>
    ) : null;

  return (
    <View>
      <View style={styles.statRow}>
        <Stat n={t.events} label="events" />
        <Stat n={t.events24h} label="events in last 24h*" />
        <Stat n={t.activeUsers7d} label="active in 7d window*" />
        <Stat n={t.newUsers7d} label="new 7d" />
        <Stat n={t.posts30d} label="posts 30d" />
      </View>
      <Text style={styles.analyticsPrivacy}>Account-consented product events only. Raw IP addresses, typed searches, messages, reviews, and media URLs are never retained in analytics. Artist, venue, and genre panels below are aggregate public-post trends.</Text>
      <Text style={styles.analyticsPrivacy}>* Raw-event metrics are bounded to {data.retentionDays || 30} days, {Number(data.rawEventLimit || 0).toLocaleString()} rows globally, and {Number(data.rawEventLimitPerAccount || 0).toLocaleString()} per account; under heavy traffic the actual window is shorter. Current oldest retained event: {oldestRaw}. Signups and posts remain authoritative domain totals.</Text>
      <Text style={styles.insightH}>30-DAY GROWTH</Text>
      <View style={styles.growthCard}>
        {(data.growth || []).slice(-14).map((day) => {
          const max = Math.max(1, ...(data.growth || []).slice(-14).map((row) => Math.max(row.activeUsers, row.signups, row.posts)));
          return (
            <View key={day.day} style={styles.growthRow}>
              <Text style={styles.growthDay}>{day.day.slice(5)}</Text>
              <View style={styles.growthTracks}>
                <View style={[styles.growthBar, styles.growthActive, { width: `${Math.max(2, day.activeUsers / max * 100)}%` }]} />
                <View style={[styles.growthBar, styles.growthSignup, { width: `${Math.max(2, day.signups / max * 100)}%` }]} />
                <View style={[styles.growthBar, styles.growthPosts, { width: `${Math.max(2, day.posts / max * 100)}%` }]} />
              </View>
              <Text style={styles.growthNumbers}>{day.activeUsers}/{day.signups}/{day.posts}</Text>
            </View>
          );
        })}
        <Text style={styles.growthLegend}>active events in retained raw window / signups / posts</Text>
      </View>
      <View style={styles.insightGrid}>
        <List title="TOP ARTISTS" rows={data.topArtists} />
        <List title="TOP VENUES" rows={data.topVenues} />
        <List title="TOP GENRES" rows={data.topGenres} />
        <List title="SEARCH TEXT" rows={data.topSearches} empty="Not collected by product analytics" />
        <List title="POST KEYWORDS" rows={data.postKeywords} />
        <List title="EVENTS BY TYPE" rows={data.byName} />
      </View>
      <Text style={styles.insightH}>MEMBER ACTIVITY INSPECTION</Text>
      <Text style={styles.analyticsPrivacy}>Use for support, abuse investigations, and product diagnosis. This view is restricted to administrators.</Text>
      <View style={styles.search}>
        <Icon name="search" size={16} color={colors.textDim} />
        <TextInput accessibilityRole="search" accessibilityLabel="Find a member for activity inspection" accessibilityHint="Searches the private staff directory by name, handle, or member ID" style={styles.searchInput} value={memberQuery} onChangeText={(value) => { memberInspectController.current?.abort(); setMemberLoading(false); setMemberQuery(value); setMemberDataState({ scope: sessionScope, data: null, error: "" }); }} placeholder="Find by name, @handle, or member ID" placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false} returnKeyType="search" />
      </View>
      {normalizedMemberQuery.length < 2 ? <Text style={styles.analyticsPrivacy}>Enter at least two characters. Results come from the ephemeral staff directory and are not saved to the public profile cache.</Text> : null}
      {searchCurrent && (memberSearchState.status === "pending" || memberSearchState.status === "loading") ? <View accessibilityLiveRegion="polite" style={styles.trackQueueStatus}><ActivityIndicator color={colors.amber} /><Text style={styles.catHint}>Searching the staff directory...</Text></View> : null}
      {searchCurrent && memberSearchState.error ? <Text accessibilityLiveRegion="assertive" selectable style={styles.growErr}>{memberSearchState.error}</Text> : null}
      {memberMatches.map((user) => (
        <Pressable key={user.id} accessibilityRole="button" accessibilityLabel={`Inspect activity for ${user.name}, @${user.handle}`} style={({ pressed }) => [styles.analyticsMemberRow, pressed && styles.pressed]} onPress={() => inspectMember(user)}>
          <Avatar user={user} size={34} />
          <View style={{ flex: 1 }}><Text style={styles.memberName}>{user.name}</Text><Text style={styles.memberSub}>@{user.handle}</Text></View>
          <Icon name="chevron-right" size={16} color={colors.textFaint} />
        </Pressable>
      ))}
      {directoryCurrent && matchingMemberTotal > memberMatches.length ? <Text style={styles.analyticsPrivacy}>Showing the first {memberMatches.length} of {matchingMemberTotal.toLocaleString()} matches. Refine the search to reach a specific account.</Text> : null}
      {directoryCurrent && !memberMatches.length ? <Text style={styles.empty}>No members matched this server search.</Text> : null}
      {memberLoading && <Text style={styles.empty}>Loading member activity...</Text>}
      {memberInspectError ? <Text accessibilityLiveRegion="assertive" selectable style={styles.growErr}>{memberInspectError}</Text> : null}
      {memberData && (
        <View style={styles.memberAnalyticsCard}>
          <Text style={styles.artist}>{memberData.user?.name} <Text style={styles.sub}>@{memberData.user?.handle}</Text></Text>
          <View style={styles.statRow}>
            <Stat n={memberData.totals?.events} label="events" />
            <Stat n={memberData.totals?.posts} label="posts" />
            <Stat n={memberData.totals?.comments} label="comments" />
            <Stat n={memberData.totals?.plays} label="plays" />
            <Stat n={memberData.totals?.messagesSent} label="DMs sent" />
          </View>
          <List title="ACTIVITY BY TYPE" rows={memberData.byName} />
        </View>
      )}
    </View>
  );
}

const roleColor = (r) => (r === "admin" ? colors.magenta : r === "moderator" ? colors.good : r === "artist" ? colors.amber : colors.textDim);

const confirmStaffAction = (title, detail) => new Promise((resolve) => {
  if (typeof window !== "undefined" && typeof window.confirm === "function") {
    resolve(window.confirm(`${title}\n\n${detail}`));
    return;
  }
  Alert.alert(title, detail, [
    { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
    { text: "Confirm", style: "destructive", onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) });
});

export default function AdminScreen({ onClose }) {
  const {
    requests, users, adminMembers, adminMemberDirectory, feed, removedIds, reports, moderationConsole, session,
    comments, fanClubMsgs, lounge,
    approveArtist, rejectArtist, removeContent, restoreContent, dismissReport,
    suspendUser, liftSuspension, banUser, unbanUser, setUserRole, setVerified, markEmailVerified, setSponsor,
    removeComment, removeFanClubMessage, removeLoungeMessage,
    loadAdminMembersStrict, loadMoreAdminMembersStrict, adminStats, adminArtistQueue, enrichArtists, purgeArtist, startCatalogSeed, catalogSeedStatus, stopCatalogSeed, catalogSeedRuns,
    adminSetTrackVideo, trackOverridesList, removeTrackOverride, loadModerationConsole, loadMoreModerationConsole, moderateReport,
  } = useStore();

  const iAmAdmin = isStaff(session?.role); // full access; mods get a subset
  const [tab, setTab] = useState(iAmAdmin ? "overview" : "reports");
  // Admin-created badges available to grant. Retired ones are excluded here but
  // still render on anyone holding them, so they stay revocable.
  const [grantableBadges, setGrantableBadges] = useState([]);
  // Per-user badge overrides after a grant/revoke. The member list comes from the
  // store, so this holds the fresher server answer without refetching all 500.
  const [memberBadges, setMemberBadges] = useState({});
  const [errorLog, setErrorLog] = useState(null);
  // Draft "correct link" per wrong-version track report.
  const [trackFix, setTrackFix] = useState({});
  const [trackQueueState, setTrackQueueState] = useState({ loading: false, error: "" });
  const [trackActionState, setTrackActionState] = useState({ key: null, tone: "", message: "" });
  const trackActionInFlight = useRef(null);
  const activeStaffSession = useRef(session);
  activeStaffSession.current = session;
  const artistRequestScope = staffScopeFor(session);
  const artistRequestActionRef = useRef({ sequence: 0, scope: artistRequestScope, requestId: null, action: null, controller: null });
  const [artistRequestAction, setArtistRequestAction] = useState({ scope: artistRequestScope, requestId: null, action: null, status: "idle", error: null });
  const scopedArtistRequestAction = artistRequestAction.scope === artistRequestScope
    ? artistRequestAction
    : { scope: artistRequestScope, requestId: null, action: null, status: "idle", error: null };
  useEffect(() => {
    trackActionInFlight.current = null;
    setTrackActionState({ key: null, tone: "", message: "" });
  }, [session?.id, session?.role]);
  useEffect(() => {
    const active = artistRequestActionRef.current;
    active.controller?.abort();
    artistRequestActionRef.current = { sequence: active.sequence + 1, scope: artistRequestScope, requestId: null, action: null, controller: null };
    setArtistRequestAction({ scope: artistRequestScope, requestId: null, action: null, status: "idle", error: null });
    return () => artistRequestActionRef.current.controller?.abort();
  }, [artistRequestScope]);
  const reviewArtistRequest = async (request, action) => {
    const scope = staffScopeFor(activeStaffSession.current);
    if (!scope || artistRequestActionRef.current.controller) return;
    const controller = new AbortController();
    const operation = {
      sequence: artistRequestActionRef.current.sequence + 1,
      scope,
      requestId: request.id,
      action,
      controller,
    };
    artistRequestActionRef.current = operation;
    setArtistRequestAction({ scope, requestId: request.id, action, status: "pending", error: null });
    try {
      const result = await (action === "approve"
        ? approveArtist(request.id, { signal: controller.signal })
        : rejectArtist(request.id, { signal: controller.signal }));
      if (artistRequestActionRef.current !== operation
        || staffScopeFor(activeStaffSession.current) !== scope) return;
      if (result.ok) {
        setArtistRequestAction({ scope, requestId: null, action: null, status: "idle", error: null });
      } else {
        setArtistRequestAction({ scope, requestId: request.id, action, status: "error", error: result.error });
      }
    } catch (error) {
      if (!controller.signal.aborted && artistRequestActionRef.current === operation
        && staffScopeFor(activeStaffSession.current) === scope) {
        setArtistRequestAction({ scope, requestId: request.id, action, status: "error", error });
      }
    } finally {
      if (artistRequestActionRef.current === operation) {
        artistRequestActionRef.current = { ...operation, controller: null };
      }
    }
  };
  // Current song pins, live from the server (never trusts a login-time cache).
  const [pins, setPins] = useState([]);
  const refreshPins = () => trackOverridesList().then(setPins);
  // The moderation queue is server-authoritative: re-pull it whenever a
  // moderation tab opens so reports survive refreshes and other devices' work.
  useEffect(() => {
    if (tab !== "songs") return undefined;
    let live = true;
    setTrackQueueState({ loading: true, error: "" });
    loadModerationConsole()
      .then(() => { if (live) setTrackQueueState({ loading: false, error: "" }); })
      .catch((error) => { if (live) setTrackQueueState({ loading: false, error: error?.message || "Song reports could not be refreshed." }); });
    refreshPins();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const loadOlderTrackReports = async () => {
    if (trackQueueState.loading || !moderationConsole.nextCursor) return;
    setTrackQueueState({ loading: true, error: "" });
    try {
      await loadMoreModerationConsole();
      setTrackQueueState({ loading: false, error: "" });
    } catch (error) {
      setTrackQueueState({ loading: false, error: error?.message || "Older song reports could not be loaded." });
    }
  };
  const runTrackAction = async ({ key, title, detail, success, run }) => {
    if (trackActionInFlight.current) return false;
    const initiatingScope = staffScopeFor(activeStaffSession.current);
    if (!initiatingScope) {
      setTrackActionState({ key: null, tone: "error", message: "Your staff session is no longer active. Sign in again before changing song moderation state." });
      return false;
    }
    const operation = { key, initiatingScope };
    trackActionInFlight.current = operation;
    setTrackActionState({ key, tone: "", message: "" });
    const approved = await confirmStaffAction(title, detail);
    if (trackActionInFlight.current !== operation) return false;
    if (!approved) {
      trackActionInFlight.current = null;
      setTrackActionState({ key: null, tone: "", message: "" });
      return false;
    }
    if (!staffActionStillOwned(initiatingScope, activeStaffSession.current)) {
      trackActionInFlight.current = null;
      setTrackActionState({ key: null, tone: "error", message: "Your staff session changed before this action started. No song moderation write was attempted." });
      return false;
    }
    try {
      const result = await run({ initiatingScope });
      if (trackActionInFlight.current !== operation) return false;
      if (result === false || result?.ok === false) throw result?.error || new Error("The server did not apply this song moderation change.");
      setTrackActionState({ key: null, tone: result?.partial ? "warning" : "success", message: result?.message || success });
      return true;
    } catch (error) {
      if (trackActionInFlight.current !== operation) return false;
      setTrackActionState({ key: null, tone: "error", message: error?.message || "That song moderation change was not applied." });
      return false;
    } finally {
      if (trackActionInFlight.current === operation) trackActionInFlight.current = null;
    }
  };
  // Catalog queue: thin artists + searched-but-not-found names, seed on demand.
  const [catalog, setCatalog] = useState({ thin: [], missing: [], thinTotal: 0 });
  const [seeding, setSeeding] = useState(false);
  const refreshCatalog = () => adminArtistQueue().then(setCatalog);
  // Background "grow catalog to N" job: kick it off + poll live progress.
  const [seedJob, setSeedJob] = useState(null);
  const [seedAdd, setSeedAdd] = useState(10000);
  const [seedRuns, setSeedRuns] = useState([]);
  const refreshSeed = () => catalogSeedStatus().then((s) => s && setSeedJob(s));
  const refreshRuns = () => catalogSeedRuns().then(setSeedRuns);
  useEffect(() => { if (tab === "catalog") { refreshCatalog(); refreshSeed(); refreshRuns(); } }, [tab]);
  useEffect(() => {
    if (tab !== "members" || !iAmAdmin) return;
    let cancelled = false;
    api("/api/admin/badges")
      .then((r) => { if (!cancelled) setGrantableBadges((r.badges || []).filter((b) => !b.archived)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tab, iAmAdmin]);

  useEffect(() => {
    if (tab !== "overview" || !iAmAdmin) return;
    let cancelled = false;
    api("/api/admin/errors")
      .then((r) => { if (!cancelled) setErrorLog(r); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tab, iAmAdmin]);

  // Proves the alert path without waiting for an incident. It cannot invent
  // errors, so a clean window correctly sends nothing and says so.
  const sendTestAlert = async () => {
    try {
      const r = await api("/api/admin/errors/test-alert", { method: "POST", body: {}, context: "Sending a test alert" });
      setErrorLog((prev) => ({ ...prev, testResult: r.sent ? "Sent." : `Not sent: ${r.reason}` }));
    } catch { setErrorLog((prev) => ({ ...prev, testResult: "That didn't work." })); }
  };

  const toggleMemberBadge = async (userId, slug, held) => {
    try {
      const r = await api(`/api/admin/users/${userId}/badges`, {
        method: "POST", body: { slug, revoke: held }, context: held ? "Removing a badge" : "Granting a badge",
      });
      setMemberBadges((prev) => ({ ...prev, [userId]: r.badges || [] }));
      return true;
    } catch { return false; }
  };
  useEffect(() => {
    if (tab !== "catalog" || !seedJob?.running) return;
    const id = setInterval(refreshSeed, 3000);
    return () => clearInterval(id);
  }, [tab, seedJob?.running]);
  // When a job stops running, pull the durable record of what it actually did.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !seedJob?.running) refreshRuns();
    wasRunning.current = !!seedJob?.running;
  }, [seedJob?.running]);
  const startSeed = async () => { const r = await startCatalogSeed(seedAdd); if (r?.status) setSeedJob(r.status); refreshSeed(); };
  const refreshSongs = async () => { const r = await startCatalogSeed({ mode: "refresh" }); if (r?.status) setSeedJob(r.status); refreshSeed(); };
  const stopSeed = async () => { const s = await stopCatalogSeed(); if (s) setSeedJob(s); };
  const seedNames = async (names) => {
    if (!names.length) return;
    setSeeding(true);
    await enrichArtists(names.slice(0, 40));
    setSeeding(false);
    refreshCatalog();
  };
  const purge = async (norm) => { await purgeArtist(norm); refreshCatalog(); };

  const pending = requests.filter((r) => r.status === "pending");
  const openReports = reports.filter((r) => r.status === "open");
  // Song reports get their own tab; content reports keep the classic queue.
  const trackReports = openReports.filter((r) => r.targetType === "track");
  const contentReports = openReports.filter((r) => r.targetType !== "track");
  const serverOpenReportCount = Number(moderationConsole.summary?.open);
  const openReportCount = Number.isFinite(serverOpenReportCount) ? Math.max(openReports.length, serverOpenReportCount) : openReports.length;
  const serverTrackReportCount = Number(moderationConsole.summary?.byType?.track);
  const trackReportCount = Number.isFinite(serverTrackReportCount) ? Math.max(trackReports.length, serverTrackReportCount) : trackReports.length;
  const contentReportCount = Math.max(contentReports.length, openReportCount - trackReportCount);
  const trackActionBusy = !!trackActionState.key;
  const userFor = (id) => users.find((u) => u.id === id);
  const adminMemberTotal = Number.isFinite(adminStats?.total) ? adminStats.total : adminMembers.length;
  const bannedCount = Number.isFinite(adminStats?.banned)
    ? adminStats.banned
    : adminMembers.filter((u) => u.isBanned).length;

  const allComments = useMemo(() => Object.entries(comments).flatMap(([logId, arr]) => arr.map((c) => ({ logId, ...c }))), [comments]);
  const allFanMsgs = useMemo(() => Object.entries(fanClubMsgs).flatMap(([artist, arr]) => arr.map((m) => ({ artist, ...m }))), [fanClubMsgs]);
  const allLounge = useMemo(() => Object.entries(lounge).flatMap(([key, arr]) => arr.map((m) => ({ key, ...m }))), [lounge]);

  // Playback health. When YOUTUBE_API_KEY is missing or its quota is spent,
  // every lookup returns "unconfigured"/paused and playback silently falls back
  // to a 30-second preview. From the outside that is indistinguishable from "we
  // could not find the video", which is why obvious songs looked unmatched. The
  // server already reports this on /api/health; nothing displayed it.
  const [health, setHealth] = useState(null);
  useEffect(() => {
    if (tab !== "overview") return;
    let live = true;
    api("/api/health").then((h) => { if (live) setHealth(h); }).catch(() => {});
    return () => { live = false; };
  }, [tab]);

  const TABS = [
    { key: "overview", label: "Overview", icon: "discover", admin: true },
    { key: "analytics", label: "Analytics", icon: "trophy", admin: true },
    { key: "reports", label: "Reports", icon: "flag", badge: contentReportCount || undefined },
    { key: "songs", label: "Songs", icon: "music", badge: trackReportCount || undefined },
    { key: "members", label: "Members", icon: "you", badge: bannedCount || undefined },
    { key: "content", label: "Content", icon: "feed" },
    { key: "catalog", label: "Catalog", icon: "music", admin: true },
    { key: "email", label: "Email", icon: "feed", admin: true },
    { key: "badges", label: "Badges", icon: "star", admin: true },
    { key: "requests", label: "Requests", icon: "shield", badge: pending.length, admin: true },
  ].filter((t) => iAmAdmin || !t.admin);

  if (!isMod(session?.role)) {
    return (
      <View style={styles.wrap}>
        <SheetHeader title="Moderation" onBack={onClose} />
        <Text style={[styles.empty, { padding: 20 }]}>You don't have access to moderation.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <SheetHeader title="Moderation" onBack={onClose} />

      <View style={[styles.column, styles.h1Row]}>
        <Icon name="shield" size={20} color={colors.amber} />
        <Text style={styles.h1}>Moderation console</Text>
        <View style={[styles.roleTag, { borderColor: roleColor(session?.role) }]}>
          <Text style={[styles.roleTagTxt, { color: roleColor(session?.role) }]}>{session?.role}</Text>
        </View>
      </View>

      {/* tab bar, a clean segmented control (no more stretched ovals) */}
      <View accessibilityRole="tablist" accessibilityLabel="Moderation sections" style={[styles.column, styles.tabbar]}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityLabel={`${t.label}${t.badge ? `, ${t.badge} open` : ""}`}
            accessibilityState={{ selected: tab === t.key }}
            style={[styles.tab, tab === t.key && styles.tabOn]}
            onPress={() => setTab(t.key)}
          >
            <Icon name={t.icon} size={15} color={tab === t.key ? "#1A1206" : colors.textDim} />
            <Text style={[styles.tabTxt, tab === t.key && styles.tabTxtOn]}>{t.label}</Text>
            {t.badge ? <View style={styles.tabBadge}><Text style={styles.tabBadgeTxt}>{t.badge}</Text></View> : null}
          </Pressable>
        ))}
      </View>

      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[styles.column, styles.content]}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ---- OVERVIEW ---- */}
        {tab === "overview" && (
          <>
            <ModerationConsole
              mode="overview"
              session={session}
              isAdmin={iAmAdmin}
              reports={reports}
              moderationConsole={moderationConsole}
              users={users}
              adminMembers={adminMembers}
              adminMemberDirectory={adminMemberDirectory}
              feed={feed}
              comments={comments}
              fanClubMessages={fanClubMsgs}
              loungeMessages={lounge}
              adminStats={adminStats}
              loadModerationConsole={loadModerationConsole}
              loadMoreModerationConsole={loadMoreModerationConsole}
              loadAdminMembersStrict={loadAdminMembersStrict}
              loadMoreAdminMembersStrict={loadMoreAdminMembersStrict}
              moderateReport={moderateReport}
              suspendUser={suspendUser}
              liftSuspension={liftSuspension}
              banUser={banUser}
              unbanUser={unbanUser}
              setUserRole={setUserRole}
              setVerified={setVerified}
              markEmailVerified={markEmailVerified}
              setSponsor={setSponsor}
              toggleMemberBadge={toggleMemberBadge}
              onOpenReports={() => setTab("reports")}
              onOpenMembers={() => setTab("members")}
              onOpenSongs={() => setTab("songs")}
            />
            <View style={styles.statRow}>
              <View style={styles.stat}><Text style={styles.statN}>{adminMemberTotal}</Text><Text style={styles.statL}>members</Text></View>
              <View style={styles.stat}><Text style={styles.statN}>{feed.length}</Text><Text style={styles.statL}>posts</Text></View>
              <View style={styles.stat}><Text style={[styles.statN, openReportCount ? { color: colors.danger } : null]}>{openReportCount}</Text><Text style={styles.statL}>reports</Text></View>
              <View style={styles.stat}><Text style={[styles.statN, bannedCount ? { color: colors.danger } : null]}>{bannedCount}</Text><Text style={styles.statL}>banned</Text></View>
            </View>

            {health && (() => {
              const yt = health.services?.youtubeLookup || {};
              const configured = !!health.services?.youtubeConfigured;
              const paused = !!yt.circuitOpen;
              const used = yt.search?.used ?? null;
              const limit = yt.search?.limit ?? null;
              const remaining = yt.search?.remaining ?? null;
              // A spent daily budget degrades playback exactly like a missing
              // key, so it has to read as a problem, not as a healthy number.
              const spent = configured && remaining != null && remaining <= 0;
              const bad = !configured || paused || spent;
              return (
                <View style={[styles.healthCard, bad && styles.healthCardBad]}>
                  <Text style={styles.healthTitle}>PLAYBACK LOOKUP</Text>
                  <Text style={[styles.healthState, { color: bad ? colors.danger : colors.good }]}>
                    {!configured
                      ? "No YouTube API key. Every song falls back to a 30-second preview."
                      : paused
                        ? `Lookup paused (${yt.circuitCode || "provider error"}). Songs fall back to previews until it resumes.`
                        : spent
                          ? "Today's search budget is spent. New songs fall back to previews until it resets."
                          : "Configured and running."}
                  </Text>
                  {configured && used != null && (
                    <Text style={styles.healthSub}>
                      {used}{limit != null ? ` of ${limit}` : ""} searches used today{remaining != null ? ` / ${remaining} left` : ""}{yt.inFlight ? ` / ${yt.inFlight} in flight` : ""}
                    </Text>
                  )}
                  {!configured && (
                    <Text style={styles.healthSub}>Set YOUTUBE_API_KEY in the server environment, then redeploy.</Text>
                  )}
                </View>
              );
            })()}

            {/* Aggregated server errors. One row per distinct problem, so the
                count is the volume and the list is the work. */}
            {errorLog && (
              <View style={[styles.healthCard, errorLog.last24h?.occurrences > 0 && styles.healthCardBad]}>
                <Text style={styles.healthTitle}>ERRORS</Text>
                <Text style={[styles.healthState, { color: errorLog.last24h?.occurrences > 0 ? colors.danger : colors.good }]}>
                  {errorLog.last24h?.occurrences
                    ? `${errorLog.last24h.occurrences} in the last 24h across ${errorLog.last24h.kinds} kind${errorLog.last24h.kinds === 1 ? "" : "s"}.`
                    : "Nothing in the last 24 hours."}
                </Text>
                <Text style={styles.healthSub}>
                  {errorLog.last7Days?.occurrences || 0} in 7 days /{" "}
                  {errorLog.alerts?.enabled
                    ? `alerts to ${errorLog.alerts.to || "(no ADMIN_EMAIL)"}, at most one digest every ${errorLog.alerts.cooldownMinutes}m`
                    : "alerts are switched off (ERROR_ALERTS_ENABLED)"}
                </Text>
                {(errorLog.errors || []).slice(0, 8).map((e) => (
                  <Text key={e.fingerprint} style={styles.errRow} numberOfLines={1}>
                    {e.count}x {e.level === "fatal" ? "FATAL" : e.status} {e.method} {e.route || "(no route)"} / {e.code}
                    {e.cause && e.cause !== "unclassified" ? ` (${e.cause})` : ""}
                  </Text>
                ))}
                <View style={styles.errActions}>
                  <Pressable style={styles.errTestBtn} onPress={sendTestAlert}>
                    <Text style={styles.errTestTxt}>Send a test alert</Text>
                  </Pressable>
                  {errorLog.testResult ? <Text style={styles.healthSub}>{errorLog.testResult}</Text> : null}
                </View>
              </View>
            )}
          </>
        )}

        {/* ---- PRIVACY-BOUNDED PRODUCT ANALYTICS ---- */}
        {tab === "analytics" && <AdInsights adminMembers={adminMembers} adminMemberDirectory={adminMemberDirectory} loadAdminMembersStrict={loadAdminMembersStrict} session={session} />}

        {/* ---- REPORTS ---- */}
        {tab === "reports" && (
          <ModerationConsole
            mode="reports"
            session={session}
            isAdmin={iAmAdmin}
            reports={reports}
            moderationConsole={moderationConsole}
            users={users}
            adminMembers={adminMembers}
            adminMemberDirectory={adminMemberDirectory}
            feed={feed}
            comments={comments}
            fanClubMessages={fanClubMsgs}
            loungeMessages={lounge}
            adminStats={adminStats}
            loadModerationConsole={loadModerationConsole}
            loadMoreModerationConsole={loadMoreModerationConsole}
            loadAdminMembersStrict={loadAdminMembersStrict}
            loadMoreAdminMembersStrict={loadMoreAdminMembersStrict}
            moderateReport={moderateReport}
            suspendUser={suspendUser}
            liftSuspension={liftSuspension}
            banUser={banUser}
            unbanUser={unbanUser}
            setUserRole={setUserRole}
            setVerified={setVerified}
            markEmailVerified={markEmailVerified}
            setSponsor={setSponsor}
            toggleMemberBadge={toggleMemberBadge}
          />
        )}

        {/* ---- SONGS: wrong-version reports + every pinned video ---- */}
        {tab === "songs" && (
          <>
            <Text style={styles.policy}>Listeners can flag wrong videos, playback failures, preview-only fallbacks, and missing songs. Verify a candidate on YouTube, then pin its link to the exact provider recording when the report includes one.</Text>
            {trackActionState.message ? <Text accessibilityLiveRegion={trackActionState.tone === "error" ? "assertive" : "polite"} selectable style={[styles.trackActionFeedback, trackActionState.tone === "error" ? styles.trackActionError : trackActionState.tone === "warning" ? styles.trackActionWarning : styles.trackActionSuccess]}>{trackActionState.message}</Text> : null}

            <Text style={styles.catTitle}>WRONG-VERSION REPORTS / {trackReports.length} LOADED / {trackReportCount} OPEN</Text>
            {trackQueueState.loading && !trackReports.length ? <View accessibilityLiveRegion="polite" style={styles.trackQueueStatus}><ActivityIndicator color={colors.amber} /><Text style={styles.catHint}>Loading song reports...</Text></View> : null}
            {trackQueueState.error ? <Text accessibilityLiveRegion="assertive" selectable style={styles.growErr}>{trackQueueState.error}</Text> : null}
            {trackReports.length === 0 && !trackQueueState.loading && <Text style={styles.empty}>{trackReportCount ? "No song reports are in the loaded page yet. Load older reports to continue." : "No open song reports."}</Text>}
            {trackReports.map((r) => {
              const t = trackReportDetails(r);
              const reporter = r.reporter || userFor(r.reporterId);
              const issueLabel = ({ wrong_video: "wrong video", wont_play: "won't play", preview_only: "preview only", missing: "missing song", other: "other playback issue" })[t.category] || "wrong video";
              const draft = trackFix[r.id] ?? (t.suggestedVideoId ? `https://www.youtube.com/watch?v=${t.suggestedVideoId}` : "");
              const sourceLabel = t.provider && t.sourceId ? `${t.provider} recording ${t.sourceId}` : "legacy title/artist recording";
              return (
                <View key={r.id} style={styles.card}>
                  <View style={styles.reasonRow}>
                    <Icon name="music" size={14} color={colors.gold} />
                    <Text style={styles.reason}>{issueLabel}</Text>
                  </View>
                  <Text style={styles.artist}>{t.title || r.targetId}{t.artist ? ` / ${t.artist}` : ""}</Text>
                  <Text style={styles.sub}>reported by {reporter ? `@${reporter.handle}` : "a user"} / {sourceLabel}{t.note ? ` / "${t.note}"` : ""}{t.suggestedVideoId ? " / suggested a link" : ""}</Text>
                  <TextInput
                    style={styles.trackFixInput}
                    placeholder="Correct YouTube link"
                    placeholderTextColor={colors.textFaint}
                    value={draft}
                    onChangeText={(v) => setTrackFix((m) => ({ ...m, [r.id]: v }))}
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel={`Correct YouTube link for ${t.title || r.targetId}`}
                    returnKeyType="done"
                  />
                  <View style={styles.actions}>
                    <Pressable accessibilityRole="link" accessibilityLabel={`Search YouTube candidates for ${t.title || r.targetId}`} disabled={trackActionBusy} style={[styles.btn, trackActionBusy && styles.pillDisabled]} onPress={() => Linking.openURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(`${t.artist || ""} ${t.title || r.targetId} official audio`)}`).catch(() => setTrackActionState({ key: null, tone: "error", message: "YouTube search could not be opened on this device." }))}>
                      <Icon name="search" size={14} color={colors.cool} /><Text style={[styles.dismissTxt, { color: colors.cool }]}>Search candidates</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Pin video for ${t.title || r.targetId}`} accessibilityState={{ busy: trackActionState.key === `${r.id}:pin`, disabled: trackActionBusy || !draft.trim() }} disabled={trackActionBusy || !draft.trim()} style={[styles.btn, styles.trackPin, (trackActionBusy || !draft.trim()) && styles.pillDisabled]} onPress={() => runTrackAction({
                      key: `${r.id}:pin`, title: `Pin this video for ${t.title || r.targetId}?`, detail: t.sourceId ? `The pin applies only to ${sourceLabel} and closes this report.` : "The pinned video replaces title/artist playback resolution and closes this report.", success: "Video pinned and song report closed.", run: async ({ initiatingScope }) => {
                        const result = await adminSetTrackVideo({ title: t.title || r.targetId, artist: t.artist || "", url: draft.trim(), provider: t.provider, sourceId: t.sourceId });
                        if (!result?.ok) return result;
                        if (!staffActionStillOwned(initiatingScope, activeStaffSession.current)) return { ok: true, partial: true, message: "Video pin saved, but the report was not closed because your staff session changed." };
                        refreshPins();
                        setTrackFix((current) => { const next = { ...current }; delete next[r.id]; return next; });
                        return true;
                      },
                    })}>
                      {trackActionState.key === `${r.id}:pin` ? <ActivityIndicator color={colors.good} size="small" /> : <Icon name="check" size={15} color={colors.good} />}<Text style={[styles.dismissTxt, { color: colors.good }]}>Pin this video</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Mark no correct video for ${t.title || r.targetId}`} accessibilityState={{ busy: trackActionState.key === `${r.id}:none`, disabled: trackActionBusy }} disabled={trackActionBusy} style={[styles.btn, styles.suspend, trackActionBusy && styles.pillDisabled]} onPress={() => runTrackAction({
                      key: `${r.id}:none`, title: `Confirm no correct video for ${t.title || r.targetId}?`, detail: t.sourceId ? `Only ${sourceLabel} will use the fallback preview, and this report will close.` : "Listeners will receive the fallback preview and this report will close. Staff can remove the override later.", success: "No-video fallback saved and song report closed.", run: async ({ initiatingScope }) => {
                        const result = await adminSetTrackVideo({ title: t.title || r.targetId, artist: t.artist || "", none: true, provider: t.provider, sourceId: t.sourceId });
                        if (!result?.ok) return result;
                        if (!staffActionStillOwned(initiatingScope, activeStaffSession.current)) return { ok: true, partial: true, message: "The no-video fallback was saved, but the report was not closed because your staff session changed." };
                        refreshPins();
                        return true;
                      },
                    })}>
                      {trackActionState.key === `${r.id}:none` ? <ActivityIndicator color={colors.gold} size="small" /> : <Icon name="x" size={14} color={colors.gold} />}<Text style={[styles.dismissTxt, { color: colors.gold }]}>No correct video</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Dismiss report for ${t.title || r.targetId}`} accessibilityState={{ busy: trackActionState.key === `${r.id}:dismiss`, disabled: trackActionBusy }} disabled={trackActionBusy} style={[styles.btn, styles.reject, trackActionBusy && styles.pillDisabled]} onPress={() => runTrackAction({ key: `${r.id}:dismiss`, title: `Dismiss this report for ${t.title || r.targetId}?`, detail: "Playback behavior will not change and the report will leave the open queue.", success: "Song report dismissed.", run: () => dismissReport(r.id) })}>
                      {trackActionState.key === `${r.id}:dismiss` ? <ActivityIndicator color={colors.textDim} size="small" /> : null}<Text style={styles.dismissTxt}>Dismiss</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
            {moderationConsole.nextCursor ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Load older report page"
                accessibilityHint="Loads older reports from the server, including any older song reports"
                accessibilityState={{ busy: trackQueueState.loading, disabled: trackQueueState.loading }}
                disabled={trackQueueState.loading}
                style={({ pressed }) => [styles.refreshBtn, pressed && !trackQueueState.loading && styles.pressed, trackQueueState.loading && styles.pillDisabled]}
                onPress={loadOlderTrackReports}
              >
                {trackQueueState.loading ? <ActivityIndicator color={colors.amber} size="small" /> : <Icon name="chevron-down" size={14} color={colors.amber} />}
                <Text style={styles.refreshTxt}>{trackQueueState.loading ? "Loading older reports..." : "Load older report page"}</Text>
              </Pressable>
            ) : null}

            <Text style={styles.catTitle}>PINNED LINKS / {pins.length}</Text>
            <Text style={styles.catHint}>Every song with a human-verified video (or a confirmed "no correct video"). Unpinning hands the song back to the search resolver.</Text>
            {pins.length === 0 && <Text style={styles.empty}>Nothing pinned yet.</Text>}
            {pins.map((p) => (
              <View key={p.key} style={styles.pinRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pinTitle} numberOfLines={1}>{p.title}{p.artist ? ` / ${p.artist}` : ""}</Text>
                  <Text style={styles.pinSub} numberOfLines={1}>{p.provider && p.sourceId ? `${p.provider} ${p.sourceId} / ` : ""}{p.videoId ? `youtube.com/watch?v=${p.videoId}` : "confirmed: no correct video (plays preview)"}</Text>
                </View>
                <Pressable style={[styles.pinRemove, trackActionBusy && styles.pillDisabled]} disabled={trackActionBusy} onPress={() => runTrackAction({ key: `${p.key}:unpin`, title: `Remove the playback override for ${p.title}?`, detail: "The automatic resolver will choose playback again for future listeners.", success: "Playback override removed.", run: async () => { const result = await removeTrackOverride({ title: p.title, artist: p.artist, provider: p.provider, sourceId: p.sourceId }); if (result?.ok) refreshPins(); return result; } })} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Unpin ${p.title}`} accessibilityState={{ busy: trackActionState.key === `${p.key}:unpin`, disabled: trackActionBusy }}>
                  {trackActionState.key === `${p.key}:unpin` ? <ActivityIndicator color={colors.textDim} size="small" /> : <Icon name="x" size={13} color={colors.textDim} />}
                </Pressable>
              </View>
            ))}
          </>
        )}

        {/* ---- MEMBERS ---- */}
        {tab === "members" && (
          <ModerationConsole
            mode="members"
            session={session}
            isAdmin={iAmAdmin}
            reports={reports}
            moderationConsole={moderationConsole}
            users={users}
            adminMembers={adminMembers}
            adminMemberDirectory={adminMemberDirectory}
            feed={feed}
            comments={comments}
            fanClubMessages={fanClubMsgs}
            loungeMessages={lounge}
            adminStats={adminStats}
            grantableBadges={grantableBadges}
            memberBadges={memberBadges}
            loadModerationConsole={loadModerationConsole}
            loadMoreModerationConsole={loadMoreModerationConsole}
            loadAdminMembersStrict={loadAdminMembersStrict}
            loadMoreAdminMembersStrict={loadMoreAdminMembersStrict}
            moderateReport={moderateReport}
            suspendUser={suspendUser}
            liftSuspension={liftSuspension}
            banUser={banUser}
            unbanUser={unbanUser}
            setUserRole={setUserRole}
            setVerified={setVerified}
            markEmailVerified={markEmailVerified}
            setSponsor={setSponsor}
            toggleMemberBadge={toggleMemberBadge}
          />
        )}

        {/* ---- CONTENT ---- */}
        {tab === "content" && (
          <>
            <Text style={styles.sectionLabel}>POSTS / {feed.length}</Text>
            {feed.map((l) => {
              const removed = removedIds.includes(l.id);
              return (
                <View key={l.id} style={[styles.card, removed && styles.removedCard]}>
                  <View style={styles.contentRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.artist}>{l.artist}</Text>
                      <Text style={styles.sub}>by {l.user?.name || "a fan"} / {l.venue}</Text>
                      {removed && <Text style={styles.removedTag}>REMOVED, hidden from public</Text>}
                    </View>
                    {removed ? (
                      <Pressable style={[styles.btn, styles.reject]} onPress={() => restoreContent(l.id)}><Text style={styles.dismissTxt}>Restore</Text></Pressable>
                    ) : (
                      <Pressable style={[styles.btn, styles.remove]} onPress={() => removeContent(l.id)}><Icon name="trash" size={14} color={colors.danger} /><Text style={styles.rejectTxt}>Remove</Text></Pressable>
                    )}
                  </View>
                </View>
              );
            })}

            <Text style={styles.sectionLabel}>AFTERPARTY COMMENTS / {allComments.length}</Text>
            {allComments.length === 0 && <Text style={styles.empty}>No comments.</Text>}
            {allComments.map((c) => (
              <View key={c.id} style={styles.msgRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.msgWho}>{c.name}</Text>
                  <Text style={styles.msgTxt}>{c.text}</Text>
                </View>
                <Pressable style={styles.msgDel} onPress={() => removeComment(c.logId, c.id)} hitSlop={8}><Icon name="trash" size={14} color={colors.danger} /></Pressable>
              </View>
            ))}

            <Text style={styles.sectionLabel}>FAN CLUB MESSAGES / {allFanMsgs.length}</Text>
            {allFanMsgs.length === 0 && <Text style={styles.empty}>No messages.</Text>}
            {allFanMsgs.map((m) => (
              <View key={m.id} style={styles.msgRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.msgWho}>{m.name} <Text style={styles.msgWhere}>/ {m.artist}</Text></Text>
                  <Text style={styles.msgTxt}>{m.text}</Text>
                </View>
                <Pressable style={styles.msgDel} onPress={() => removeFanClubMessage(m.artist, m.id)} hitSlop={8}><Icon name="trash" size={14} color={colors.danger} /></Pressable>
              </View>
            ))}

            <Text style={styles.sectionLabel}>CONCERT LOUNGE / {allLounge.length}</Text>
            {allLounge.length === 0 && <Text style={styles.empty}>No messages.</Text>}
            {allLounge.map((m) => (
              <View key={m.id} style={styles.msgRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.msgWho}>{m.name}</Text>
                  <Text style={styles.msgTxt}>{m.text}</Text>
                </View>
                <Pressable style={styles.msgDel} onPress={() => removeLoungeMessage(m.key, m.id)} hitSlop={8}><Icon name="trash" size={14} color={colors.danger} /></Pressable>
              </View>
            ))}
          </>
        )}

        {/* ---- CATALOG ---- */}
        {tab === "catalog" && (
          <>
            <Text style={styles.policy}>Artists people looked up. Seed them from Deezer (photo, popularity, top songs) on demand, the targeted alternative to a blind bulk dump. Purge dead or typo entries.</Text>

            {/* Grow the whole catalog across all genres, in the background */}
            <View style={styles.growBox}>
              <View style={styles.catHead}>
                <Text style={styles.catTitle}>GROW CATALOG</Text>
                <Text style={styles.growCount}>{seedJob?.total != null ? `${seedJob.total.toLocaleString()} artists` : ""}</Text>
              </View>
              <Text style={styles.catHint}>Crawl MusicBrainz across all genres into the database, then rank NEW artists with Deezer (popularity + photos). Runs in the background (~30-45 min for 10k). Once every genre is crawled to the end, a run adds nothing and says so instead of reporting success. It never re-enriches profiles that are already complete. Songs load on demand, nothing to deploy.</Text>

              {seedJob?.running ? (
                <View style={styles.seedRun}>
                  <View style={styles.seedRunHead}>
                    <View style={styles.liveDot} />
                    <Text style={styles.seedRunTxt}>
                      {seedJob.note === "stopping"
                        ? "Stopping..."
                        : seedJob.phase === "songs"
                        ? `Filling songs & genres... ${seedJob.ranked.toLocaleString()} done`
                        : seedJob.phase === "enrich"
                        ? `Ranking with Deezer... ${seedJob.ranked.toLocaleString()} enriched`
                        : `Crawling ${seedJob.note || ""}... +${seedJob.added.toLocaleString()} added`}
                    </Text>
                    <Pressable style={styles.stopBtn} onPress={stopSeed} disabled={seedJob.note === "stopping"}>
                      <Icon name="x" size={12} color={colors.danger} />
                      <Text style={styles.stopTxt}>Stop</Text>
                    </Pressable>
                  </View>
                  <View style={styles.seedBar}>
                    <View style={[styles.seedBarFill, { width: `${Math.max(3, Math.min(100, Math.round((seedJob.added / (seedJob.add || 1)) * 100)))}%` }]} />
                  </View>
                  <Text style={styles.catHint}>+{(seedJob.added || 0).toLocaleString()} of {(seedJob.add || 0).toLocaleString()} new. Safe to leave or close this tab, it keeps going. Stopping keeps everything already added.</Text>
                </View>
              ) : (
                <>
                  <View style={styles.targetRow}>
                    {[2000, 5000, 10000].map((n) => (
                      <Pressable key={n} style={[styles.targetPill, seedAdd === n && styles.targetPillOn]} onPress={() => setSeedAdd(n)}>
                        <Text style={[styles.targetTxt, seedAdd === n && styles.targetTxtOn]}>+{(n / 1000) + "k"}</Text>
                      </Pressable>
                    ))}
                    <Pressable style={styles.growBtn} onPress={startSeed}>
                      <Icon name="music" size={14} color="#1A1206" />
                      <Text style={styles.seedTxt}>Grow by {(seedAdd / 1000) + "k"}</Text>
                    </Pressable>
                  </View>
                  <Pressable style={styles.refreshBtn} onPress={refreshSongs}>
                    <Icon name="play" size={13} color={colors.amber} />
                    <Text style={styles.refreshTxt}>Refresh songs & genres</Text>
                  </Pressable>
                  <Text style={styles.catHint}>Fills in the top song + genre for ranked artists that don't have one yet (fixes blank "top song"s on Discover). Background job, most-popular first.</Text>
                  {(seedJob?.phase === "done" || seedJob?.phase === "stopped") && <Text style={styles.growDone}>{seedJob.phase === "stopped" ? "Stopped" : "Last run"}: {seedJob.mode === "refresh" ? `${seedJob.ranked.toLocaleString()} songs filled.` : `+${seedJob.added.toLocaleString()} added, ${seedJob.ranked.toLocaleString()} ranked.`} Run again to resume.</Text>}
                  {/* A grow that adds nothing used to render NOTHING here, so the
                      button looked like it worked. Say so plainly instead. */}
                  {seedJob?.phase === "exhausted" && (
                    <View style={styles.growNotice}>
                      <Text style={styles.growNoticeTitle}>Nothing left to add ({seedJob.errorCode})</Text>
                      <Text style={styles.growNoticeTxt}>{seedJob.note || "Every genre has been crawled to the end at this depth."} Growing again will not add artists until a new source or a deeper crawl is available. Existing profiles were left untouched.</Text>
                    </View>
                  )}
                  {seedJob?.phase === "error" && <Text style={styles.growErr}>Last run failed{seedJob.errorCode ? ` (${seedJob.errorCode})` : ""}: {seedJob.error}</Text>}

                  {/* Durable record: survives restarts and never claims success for
                      a run that added nothing. */}
                  {seedRuns.length > 0 && (
                    <View style={styles.runsBox}>
                      <Text style={styles.runsTitle}>RECENT JOBS</Text>
                      {seedRuns.slice(0, 5).map((r) => (
                        <View key={r.id} style={styles.runRow}>
                          <View style={[styles.runDot, { backgroundColor: r.status === "done" ? colors.good : r.status === "exhausted" ? colors.gold : r.status === "error" || r.status === "interrupted" ? colors.danger : colors.textFaint }]} />
                          <Text style={styles.runTxt} numberOfLines={1}>
                            {r.mode === "refresh" ? "Songs & genres" : "Grow"} / {r.status}
                            {r.mode === "refresh" ? ` / ${(r.enriched || 0).toLocaleString()} filled` : ` / +${(r.added || 0).toLocaleString()} added`}
                            {r.errorCode ? ` / ${r.errorCode}` : ""}
                          </Text>
                          <Text style={styles.runWhen}>{r.startedAt ? new Date(r.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </>
              )}
            </View>

            <View style={styles.catHead}>
              <Text style={styles.catTitle}>NOT FOUND / {catalog.missing.length}</Text>
              {catalog.missing.length > 0 && (
                <Pressable style={[styles.seedBtn, seeding && styles.pillDisabled]} disabled={seeding} onPress={() => seedNames(catalog.missing.map((m) => m.name))}>
                  <Icon name="music" size={13} color="#1A1206" /><Text style={styles.seedTxt}>{seeding ? "Seeding..." : "Seed all"}</Text>
                </Pressable>
              )}
            </View>
            <Text style={styles.catHint}>Searched, but MusicBrainz had nothing. Seeding checks Deezer.</Text>
            {catalog.missing.length === 0 && <Text style={styles.empty}>Nothing missing right now.</Text>}
            {catalog.missing.map((m) => (
              <View key={m.norm} style={styles.catRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.catName} numberOfLines={1}>{m.name}</Text>
                  <Text style={styles.catSub}>{m.searches} search{m.searches === 1 ? "" : "es"}</Text>
                </View>
                <Pressable style={styles.catAction} onPress={() => seedNames([m.name])}><Icon name="music" size={13} color={colors.good} /><Text style={[styles.catActionTxt, { color: colors.good }]}>Seed</Text></Pressable>
                <Pressable style={styles.catAction} onPress={() => purge(m.norm)}><Icon name="trash" size={13} color={colors.danger} /></Pressable>
              </View>
            ))}

            <View style={styles.catHead}>
              <Text style={styles.catTitle}>THIN PROFILES / {catalog.thinTotal}</Text>
              {catalog.thin.length > 0 && (
                <Pressable style={[styles.seedBtn, seeding && styles.pillDisabled]} disabled={seeding} onPress={() => seedNames(catalog.thin.map((t) => t.name))}>
                  <Icon name="music" size={13} color="#1A1206" /><Text style={styles.seedTxt}>{seeding ? "Seeding..." : "Seed top"}</Text>
                </Pressable>
              )}
            </View>
            <Text style={styles.catHint}>In the catalog but no photo yet, most-searched first. Seeding fills them in.</Text>
            {catalog.thin.length === 0 && <Text style={styles.empty}>Every profile has a photo.</Text>}
            {catalog.thin.map((t) => (
              <View key={t.norm} style={styles.catRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.catName} numberOfLines={1}>{t.name}</Text>
                  <Text style={styles.catSub}>{t.genre ? t.genre + " / " : ""}{t.searches} search{t.searches === 1 ? "" : "es"}</Text>
                </View>
                <Pressable style={styles.catAction} onPress={() => seedNames([t.name])}><Icon name="music" size={13} color={colors.good} /><Text style={[styles.catActionTxt, { color: colors.good }]}>Seed</Text></Pressable>
                <Pressable style={styles.catAction} onPress={() => purge(t.norm)}><Icon name="trash" size={13} color={colors.danger} /></Pressable>
              </View>
            ))}
          </>
        )}

        {/* ---- EMAIL ---- */}
        {tab === "email" && <EmailConsole />}

        {tab === "badges" && <BadgeConsole />}

        {/* ---- REQUESTS ---- */}
        {tab === "requests" && (
          <>
            <Text style={styles.policy}>Fans requesting an official artist account. Approve to let them post tour dates for their artist.</Text>
            {scopedArtistRequestAction.status === "error" && (
              <View style={styles.requestError} accessibilityRole="alert" accessibilityLiveRegion="assertive">
                <Text selectable style={styles.requestErrorText}>
                  That request was not {scopedArtistRequestAction.action === "approve" ? "approved" : "rejected"}. Nothing changed. {scopedArtistRequestAction.error?.userMessage || scopedArtistRequestAction.error?.message || "Try again."}
                </Text>
                <View style={styles.requestErrorActions}>
                  {scopedArtistRequestAction.error?.retryable && pending.some((request) => request.id === scopedArtistRequestAction.requestId) ? (
                    <Pressable
                      style={styles.requestRetry}
                      onPress={() => {
                        const request = pending.find((entry) => entry.id === scopedArtistRequestAction.requestId);
                        if (request) void reviewArtistRequest(request, scopedArtistRequestAction.action);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Retry artist request review"
                    >
                      <Text style={styles.requestRetryText}>Try again</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={styles.requestDismiss}
                    onPress={() => setArtistRequestAction({ scope: artistRequestScope, requestId: null, action: null, status: "idle", error: null })}
                    accessibilityRole="button"
                    accessibilityLabel="Dismiss artist request error"
                  >
                    <Text style={styles.requestDismissText}>Dismiss</Text>
                  </Pressable>
                </View>
              </View>
            )}
            {pending.length === 0 && <Text style={styles.empty}>No pending requests.</Text>}
            {pending.map((r) => {
              const u = userFor(r.userId);
              const approveBusy = scopedArtistRequestAction.status === "pending" && scopedArtistRequestAction.requestId === r.id && scopedArtistRequestAction.action === "approve";
              const rejectBusy = scopedArtistRequestAction.status === "pending" && scopedArtistRequestAction.requestId === r.id && scopedArtistRequestAction.action === "reject";
              const reviewBusy = scopedArtistRequestAction.status === "pending";
              return (
                <View key={r.id} style={styles.card}>
                  <Text style={styles.artist}>{r.artistName}</Text>
                  <Text style={styles.sub}>requested by {u ? `${u.name} (@${u.handle})` : "unknown"}</Text>
                  {!!r.note && <Text style={styles.note}>"{r.note}"</Text>}
                  <View style={styles.actions}>
                    <Pressable style={[styles.btn, styles.approve, reviewBusy && styles.pillDisabled]} onPress={() => void reviewArtistRequest(r, "approve")} disabled={reviewBusy} accessibilityRole="button" accessibilityState={{ disabled: reviewBusy, busy: approveBusy }}>
                      {approveBusy ? <ActivityIndicator size="small" color="#0C1A0F" /> : <Icon name="check" size={15} color="#0C1A0F" />}<Text style={styles.approveTxt}>{approveBusy ? "Approving..." : "Approve"}</Text>
                    </Pressable>
                    <Pressable style={[styles.btn, styles.reject, reviewBusy && styles.pillDisabled]} onPress={() => void reviewArtistRequest(r, "reject")} disabled={reviewBusy} accessibilityRole="button" accessibilityState={{ disabled: reviewBusy, busy: rejectBusy }}>
                      {rejectBusy ? <ActivityIndicator size="small" color={colors.danger} /> : <Icon name="x" size={15} color={colors.danger} />}<Text style={styles.rejectTxt}>{rejectBusy ? "Rejecting..." : "Reject"}</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  healthCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, gap: 4, marginTop: 12 },
  healthCardBad: { borderColor: colors.danger },
  healthTitle: { color: colors.textDim, fontSize: 11, fontWeight: "800", letterSpacing: 1, fontFamily: mono },
  healthState: { fontSize: 13.5, fontWeight: "700" },
  healthSub: { color: colors.textDim, fontSize: 12 },
  errRow: { color: colors.textFaint, fontSize: 11, fontFamily: mono, marginTop: 3 },
  errActions: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  errTestBtn: { alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  errTestTxt: { color: colors.text, fontSize: 11, fontWeight: "700" },
  wrap: { flex: 1, backgroundColor: colors.bg },
  // One readable column for the whole console. Applied to the title row, the tab
  // bar and the scroll content together: capping only the content would leave the
  // tabs stretched across the window and the two would visibly disagree. The
  // SheetHeader above stays full width because it is page chrome, not content.
  // 900 matches DiscoverScreen, the widest existing cap in the app.
  column: { width: "100%", maxWidth: 900, alignSelf: "center" },
  h1Row: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 6 },
  h1: { color: colors.text, fontSize: 20, fontWeight: "800" },
  tabbar: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  tab: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 44, paddingHorizontal: 15, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  tabOn: { backgroundColor: colors.amberStrong, borderColor: colors.amberStrong },
  tabTxt: { color: colors.textDim, fontSize: 13, fontWeight: "700" },
  tabTxtOn: { color: "#1A1206" },
  tabBadge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" },
  tabBadgeTxt: { color: "#fff", fontSize: 10, fontWeight: "800" },
  content: { paddingHorizontal: 16, paddingBottom: 60 },
  sectionLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: space(6), marginBottom: space(2) },
  policy: { color: colors.textDim, fontSize: 12, lineHeight: 18, marginBottom: 12, marginTop: 4, fontStyle: "italic" },
  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic", marginTop: 4 },

  // stats
  statRow: { flexDirection: "row", gap: 8, marginTop: 4, marginBottom: 4 },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, paddingVertical: 12, alignItems: "center" },
  statN: { color: colors.amber, fontFamily: mono, fontSize: 20, fontWeight: "800" },
  statL: { color: colors.textDim, fontSize: 10, letterSpacing: 0.5, marginTop: 2 },

  // ad insights
  insightGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  insightCol: { flexGrow: 1, flexBasis: "46%", minWidth: 150, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12 },
  insightH: { color: colors.textFaint, fontSize: 10, letterSpacing: 1, fontWeight: "800", marginTop: 14, marginBottom: 8 },
  insightRow: { flexDirection: "row", justifyContent: "space-between", gap: 8, paddingVertical: 3 },
  insightLabel: { color: colors.text, fontSize: 13, flex: 1 },
  insightCount: { color: colors.amber, fontFamily: mono, fontSize: 13, fontWeight: "700" },
  activityLine: { color: colors.textDim, fontSize: 12, fontFamily: mono, paddingVertical: 2 },
  activityWho: { color: colors.cool },
  analyticsPrivacy: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 8, marginBottom: 8 },
  growthCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 12 },
  growthRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 20 },
  growthDay: { width: 36, color: colors.textFaint, fontFamily: mono, fontSize: 9.5 },
  growthTracks: { flex: 1, gap: 2 },
  growthBar: { minHeight: 3, borderRadius: 2 },
  growthActive: { backgroundColor: colors.cool },
  growthSignup: { backgroundColor: colors.good },
  growthPosts: { backgroundColor: colors.amber },
  growthNumbers: { width: 56, color: colors.textDim, fontFamily: mono, fontSize: 9.5, textAlign: "right" },
  growthLegend: { color: colors.textFaint, fontSize: 10.5, textAlign: "right", marginTop: 7 },
  analyticsMemberRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.sm, padding: 10, marginTop: 7 },
  memberAnalyticsCard: { backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 14, marginTop: 12 },

  // cards + report/request actions
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 10 },
  removedCard: { opacity: 0.6, borderColor: colors.danger },
  reasonRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  reason: { color: colors.danger, fontSize: 11, letterSpacing: 1, fontWeight: "700", textTransform: "uppercase" },
  artist: { color: colors.text, fontSize: 15, fontWeight: "800" },
  sub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  note: { color: colors.textDim, fontSize: 13, fontStyle: "italic", marginTop: 6 },
  removedTag: { color: colors.danger, fontSize: 10, letterSpacing: 1, fontWeight: "700", marginTop: 4 },
  contentRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  requestError: { gap: 9, marginTop: 10, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.surface },
  requestErrorText: { color: colors.danger, fontSize: 12.5, lineHeight: 18 },
  requestErrorActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  requestRetry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber },
  requestRetryText: { color: colors.amber, fontSize: 12, fontWeight: "800" },
  requestDismiss: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12 },
  requestDismissText: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  btn: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.sm, borderWidth: 1 },
  remove: { borderColor: colors.danger, backgroundColor: "rgba(224,69,123,0.08)" },
  reject: { borderColor: colors.line },
  suspend: { borderColor: colors.gold, backgroundColor: "rgba(232,182,90,0.08)" },
  trackPin: { borderColor: colors.good, backgroundColor: "rgba(111,207,151,0.08)" },
  trackFixInput: { backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, color: colors.text, fontSize: 12.5, paddingHorizontal: 10, paddingVertical: 8, marginTop: 10 },
  pinRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineSoft, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 7 },
  pinTitle: { color: colors.text, fontSize: 13, fontWeight: "700" },
  pinSub: { color: colors.textDim, fontFamily: mono, fontSize: 11, marginTop: 2 },
  pinRemove: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  approve: { borderColor: colors.good, backgroundColor: colors.good },
  approveTxt: { color: "#0C1A0F", fontSize: 13, fontWeight: "800" },
  rejectTxt: { color: colors.danger, fontSize: 13, fontWeight: "700" },
  dismissTxt: { color: colors.textDim, fontSize: 13, fontWeight: "700" },

  // catalog
  catHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18, marginBottom: 2 },
  catTitle: { color: colors.text, fontSize: 12.5, letterSpacing: 1.2, fontWeight: "900" },
  catHint: { color: colors.textDim, fontSize: 11.5, marginBottom: 8 },
  seedBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.amberStrong, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7 },
  seedTxt: { color: "#1A1206", fontSize: 12, fontWeight: "800" },
  growBox: { backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 14, marginTop: 6, marginBottom: 4 },
  growCount: { color: colors.amber, fontSize: 12, fontWeight: "800", fontFamily: mono },
  targetRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  targetPill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  targetPillOn: { borderColor: colors.amber, backgroundColor: "rgba(242,166,90,0.10)" },
  targetTxt: { color: colors.textDim, fontSize: 12.5, fontWeight: "800" },
  targetTxtOn: { color: colors.amber },
  growBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.amberStrong, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, marginLeft: "auto" },
  growDone: { color: colors.good, fontSize: 11.5, marginTop: 8, fontFamily: mono },
  growErr: { color: colors.danger, fontSize: 11.5, marginTop: 8 },
  refreshBtn: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: 12, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber, backgroundColor: "rgba(242,166,90,0.08)" },
  refreshTxt: { color: colors.amber, fontSize: 12.5, fontWeight: "800" },
  trackQueueStatus: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 },
  trackActionFeedback: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10, fontSize: 12, lineHeight: 18, fontWeight: "700", marginBottom: 12 },
  trackActionError: { color: colors.danger, borderColor: colors.danger },
  trackActionWarning: { color: colors.gold, borderColor: colors.gold },
  trackActionSuccess: { color: colors.good, borderColor: colors.good },
  pressed: { opacity: 0.72 },
  growNotice: { marginTop: 10, padding: 11, borderRadius: radius.md, borderWidth: 1, borderColor: colors.gold, backgroundColor: "rgba(232,182,90,0.08)" },
  growNoticeTitle: { color: colors.gold, fontSize: 12, fontWeight: "900", letterSpacing: 0.3, marginBottom: 4, fontFamily: mono },
  growNoticeTxt: { color: colors.textDim, fontSize: 11.5, lineHeight: 16 },
  runsBox: { marginTop: 14, borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: 10 },
  runsTitle: { color: colors.textFaint, fontSize: 10, letterSpacing: 1.2, fontWeight: "800", marginBottom: 6 },
  runRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  runDot: { width: 6, height: 6, borderRadius: 3 },
  runTxt: { flex: 1, color: colors.textDim, fontSize: 11, fontFamily: mono },
  runWhen: { color: colors.textFaint, fontSize: 10, fontFamily: mono },
  seedRun: { marginTop: 6 },
  seedRunHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.good },
  seedRunTxt: { color: colors.text, fontSize: 13, fontWeight: "700", flex: 1 },
  stopBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.danger, backgroundColor: "rgba(224,69,123,0.08)" },
  stopTxt: { color: colors.danger, fontSize: 12, fontWeight: "800" },
  seedBar: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: "hidden", marginBottom: 6 },
  seedBarFill: { height: 6, borderRadius: 3, backgroundColor: colors.amber },
  catRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineSoft, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 6 },
  catName: { color: colors.text, fontSize: 14, fontWeight: "700" },
  catSub: { color: colors.textDim, fontSize: 11, fontFamily: mono, marginTop: 1 },
  catAction: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line },
  catActionTxt: { fontSize: 12, fontWeight: "800" },

  search: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6, marginBottom: 12 },
  searchInput: { flex: 1, color: colors.text, fontSize: 14 },
  memberName: { color: colors.text, fontSize: 15, fontWeight: "800", flexShrink: 1 },
  roleTag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 },
  roleTagTxt: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  memberSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  pillDisabled: { opacity: 0.4 },

  // content messages
  msgRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineSoft, padding: 11, marginBottom: 7 },
  msgWho: { color: colors.text, fontSize: 13, fontWeight: "700" },
  msgWhere: { color: colors.textFaint, fontWeight: "400" },
  msgTxt: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: 2 },
  msgDel: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
});
