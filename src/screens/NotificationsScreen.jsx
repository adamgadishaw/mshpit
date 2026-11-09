import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { colors, mono, radius, space } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import { api } from "../lib/api";
import { isCurrentNotificationPostRequest, normalizeFetchedNotificationPost, notificationPostFailureNotice, resolveNotificationPost } from "../domain/notificationDeepLink.mjs";
import { bundleNotifications } from "../domain/notification-bundles.mjs";
import { createIOSLinkedNavigation } from "../domain/iosLinkedNavigation.mjs";
import { postTagNotificationCopy, postTagNotificationPhrase } from "../domain/postTagNotification.mjs";
import VinylRefreshBoundary from "../components/VinylRefreshBoundary";
import useScopedRefresh from "../hooks/useScopedRefresh";
import { refreshScope } from "../domain/scopedRefresh.mjs";
import useIOSActivityNavigation from "../hooks/useIOSActivityNavigation";

const ago = (ts) => {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

const planJoinPhrase = (artist) => (artist ? `joined your plan for ${artist}` : "joined your plan");

const META = {
  follow: { icon: "you", tint: colors.cool, verb: "started following you" },
  like: { icon: "heart", tint: colors.magenta, verb: "liked your review" },
  comment_like: { icon: "heart", tint: colors.magenta, verb: "liked your comment" },
  repost: { icon: "repeat", tint: colors.good, verb: "reposted your post" },
  comment: { icon: "comment", tint: colors.amber, verb: "commented on your review" },
  post_tag: { icon: "you", tint: colors.gold, verb: "tagged you in a post" },
  dm: { icon: "mail", tint: colors.good, verb: "sent you a message" },
  plan_join: { icon: "user-plus", tint: colors.good, verb: "joined your plan" },
  artist_update: { icon: "music", tint: colors.amber, verb: "" },
  welcome: { icon: "star", tint: colors.amber, verb: "" },
};

function notificationCopy(notification, actorName) {
  if (notification.type === "welcome") return "Welcome to Pit! Follow people whose taste matches yours, log the shows you go to, and rate the band versus the room.";
  if (notification.type === "post_tag") return postTagNotificationCopy(actorName, notification.artist);
  if (notification.type === "plan_join") return `${actorName || "Someone"} ${planJoinPhrase(notification.artist)}`;
  if (notification.type === "artist_update") return `${notification.artist || "An artist you follow"}: ${notification.text || "new music"}`;
  const meta = META[notification.type] || META.like;
  const reference = (notification.type === "like" || notification.type === "comment") && notification.artist
    ? ` of ${notification.artist}`
    : "";
  return `${actorName || "Someone"} ${meta.verb}${reference}`;
}

// Share the existing transport operation with the iOS intent owner. The hook
// owns lifetime/cancellation, while this screen keeps its established API call.
const fetchNotificationPost = (destination, controller) => api(`/api/posts/${encodeURIComponent(destination.postId)}`, {
  signal: controller.signal,
  silent: true,
  context: "Opening this activity post",
});

// The activity feed, the social heartbeat that connects follows, likes, comments
// and DMs into one place instead of leaving them scattered across the app.
export default function NotificationsScreen({ onClose, onOpenProfile, onOpenThread, onOpen, onOpenPost, onOpenPlans, onOpenArtist, isCurrentIOSRoute }) {
  const { myNotifications, notificationActivity, refreshNotifications, loadMoreNotifications, markNotificationsRead, feed, session, chatAuthEpoch } = useStore();
  const items = myNotifications();
  const accountId = session?.id || null;
  const accountIdRef = useRef(accountId);
  accountIdRef.current = accountId;
  const postRequestRef = useRef({ sequence: 0, accountId, postId: null, controller: null });
  const [legacyOpeningNotificationId, setOpeningNotificationId] = useState(null);
  const [legacyUnavailableNotice, setUnavailableNotice] = useState(null);
  const departedRef = useRef({ accountId, authEpoch: chatAuthEpoch, departed: false });
  if (departedRef.current.accountId !== accountId || departedRef.current.authEpoch !== chatAuthEpoch) {
    departedRef.current = { accountId, authEpoch: chatAuthEpoch, departed: false };
  }
  const readOwnerRef = useRef(null);
  if (!readOwnerRef.current) readOwnerRef.current = createIOSLinkedNavigation();
  const readOwner = readOwnerRef.current;
  const notificationReadScope = readOwner.account(accountId, chatAuthEpoch);
  const ownsReadScope = () => !departedRef.current.departed && !!accountId && readOwner.ownsScope(notificationReadScope)
    && (!isCurrentIOSRoute || isCurrentIOSRoute());
  const leaveActivity = (callback, ...args) => {
    departedRef.current.departed = true;
    readOwner.invalidate();
    callback?.(...args);
  };
  const iosNavigation = useIOSActivityNavigation({
    accountId, authEpoch: chatAuthEpoch, feed, fetchPost: fetchNotificationPost, isCurrentRoute: isCurrentIOSRoute,
    onClose: () => leaveActivity(onClose),
    onOpenProfile: value => leaveActivity(onOpenProfile, value),
    onOpenThread: value => leaveActivity(onOpenThread, value),
    onOpenPost: value => leaveActivity(onOpenPost, value),
    onOpenPlans: () => leaveActivity(onOpenPlans),
    onOpenArtist: value => leaveActivity(onOpenArtist, value),
  });
  const openingNotificationId = iosNavigation ? iosNavigation.openingNotificationId : legacyOpeningNotificationId;
  const unavailableNotice = iosNavigation ? iosNavigation.unavailableNotice : legacyUnavailableNotice;
  const [viewMode, setViewMode] = useState("recent");
  const [notificationReadState, setNotificationReadState] = useState(null);
  const scopedNotificationReadState = notificationReadState?.scope === notificationReadScope
    ? notificationReadState : {};
  const activityStatus = notificationActivity?.status || "idle";
  const activityError = notificationActivity?.error;
  const nextCursor = notificationActivity?.data?.nextCursor;
  const canMarkRead = notificationActivity?.data?.readContract === "notification-ids-v1";
  const unreadIds = items.filter(item => !item.read).map(item => item.id);
  const bundles = useMemo(() => bundleNotifications(items), [items]);
  const activityRows = viewMode === "digest"
    ? bundles.map((bundle) => ({ key: bundle.id, notification: bundle.primary, bundle }))
    : items.map((notification) => ({ key: notification.id, notification, bundle: null }));

  const readCurrentNotifications = async (notificationIds) => {
    if (!ownsReadScope() || !canMarkRead || !notificationIds?.length) return;
    const operation = readOwner.begin(notificationReadScope);
    if (!operation) return;
    const current = () => readOwner.current(operation) && ownsReadScope();
    setNotificationReadState({ scope: notificationReadScope, status: "pending", notificationIds });
    try {
      const result = await markNotificationsRead({ notificationIds: [...notificationIds], signal: operation.signal });
      if (!current()) return;
      setNotificationReadState({ scope: notificationReadScope, notificationIds,
        status: result.ok ? "ready" : "error", error: result.ok ? null : result.error });
    } catch (error) {
      if (current()) setNotificationReadState({ scope: notificationReadScope, status: "error", error, notificationIds });
    } finally {
      readOwner.release(operation);
    }
  };
  useLayoutEffect(() => {
    readOwner.mount();
    return () => readOwner.unmount();
  }, [readOwner]);
  useEffect(() => () => postRequestRef.current.controller?.abort(), []);
  useEffect(() => {
    const active = postRequestRef.current;
    if (String(active.accountId || "") === String(accountId || "")) return;
    active.controller?.abort();
    postRequestRef.current = { sequence: active.sequence + 1, accountId, postId: null, controller: null };
    setOpeningNotificationId(null);
    setUnavailableNotice(null);
  }, [accountId]);

  const activityRefreshScope = refreshScope(accountId, `activity:${chatAuthEpoch}`);
  const { refresh: refreshActivity, refreshing: activityRefreshing } = useScopedRefresh({
    scope: activityRefreshScope,
    enabled: !!accountId,
    task: async ({ signal }) => {
      if (!ownsReadScope()) return;
      return refreshNotifications({ signal, accountId });
    },
  });
  const { refresh: loadOlder, refreshing: loadingOlder } = useScopedRefresh({
    scope: activityRefreshScope,
    enabled: !!accountId && !!nextCursor,
    task: ({ signal }) => ownsReadScope() ? loadMoreNotifications({ signal }) : undefined,
  });
  useEffect(() => {
    if (!accountId) return;
    void refreshActivity();
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active" && ownsReadScope()) void refreshActivity();
    });
    return () => subscription.remove();
    // Commands are Store facades; account/epoch, not reconciliation, owns entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, chatAuthEpoch]);

  // Tapping the ROW goes to the thing the notification is about; tapping the
  // AVATAR always goes to the person who did it.
  const open = async (n) => {
    if (iosNavigation) return iosNavigation.open(n);
    const destination = resolveNotificationPost(n, feed);
    if (destination.kind !== "fetch-post") {
      const active = postRequestRef.current;
      active.controller?.abort();
      postRequestRef.current = { sequence: active.sequence + 1, accountId: accountIdRef.current, postId: null, controller: null };
      setOpeningNotificationId(null);
    }
    if (destination.kind === "none") return;
    if (destination.kind === "profile") return leaveActivity(onOpenProfile, destination.actorId);
    if (destination.kind === "thread") return leaveActivity(onOpenThread, destination.actorId);
    if (destination.kind === "plans") return leaveActivity(onOpenPlans);
    if (destination.kind === "artist") return leaveActivity(onOpenArtist, { name: destination.artist });
    if (destination.kind === "local-post") return leaveActivity(onOpenPost, destination.post);
    if (destination.kind === "unavailable") {
      setUnavailableNotice("This post is no longer available.");
      return;
    }

    // The post may simply be outside this device's current feed page. Resolve
    // its canonical record before declaring it gone; removed, blocked, or truly
    // missing posts all fail closed to the same safe message.
    postRequestRef.current.controller?.abort();
    const controller = new AbortController();
    const sequence = postRequestRef.current.sequence + 1;
    const requestAccountId = accountIdRef.current;
    const request = { sequence, accountId: requestAccountId, postId: destination.postId, controller };
    postRequestRef.current = request;
    setUnavailableNotice(null);
    setOpeningNotificationId(n.id);
    try {
      const payload = await fetchNotificationPost(destination, controller);
      if (!isCurrentNotificationPostRequest(postRequestRef.current, { sequence, accountId: accountIdRef.current, postId: destination.postId })) return;
      const post = normalizeFetchedNotificationPost(payload, destination.postId);
      if (!post) {
        setUnavailableNotice("This post is no longer available.");
        return;
      }
      setOpeningNotificationId(null);
      leaveActivity(onOpenPost, post);
    } catch (error) {
      if (isCurrentNotificationPostRequest(postRequestRef.current, { sequence, accountId: accountIdRef.current, postId: destination.postId })) {
        setUnavailableNotice(notificationPostFailureNotice(error));
      }
    } finally {
      if (isCurrentNotificationPostRequest(postRequestRef.current, { sequence, accountId: accountIdRef.current, postId: destination.postId })) {
        setOpeningNotificationId(null);
      }
    }
  };

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Activity" onBack={iosNavigation ? iosNavigation.close : () => leaveActivity(onClose)} />
      <VinylRefreshBoundary
        refreshing={activityRefreshing}
        onRefresh={refreshActivity}
        accessibilityLabel="Refresh activity"
        enabled={!!accountId}
      >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {scopedNotificationReadState.status === "error" && (
          <View style={styles.readNotice} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            <Icon name="shield" size={16} color={colors.danger} />
            <Text selectable style={styles.readNoticeText}>
              Some activity could not be marked read. Only confirmed items have been updated. {scopedNotificationReadState.error?.userMessage || scopedNotificationReadState.error?.message || "Try again."}
            </Text>
            {scopedNotificationReadState.error?.retryable ? (
              <Pressable style={styles.readRetry} onPress={() => void readCurrentNotifications(scopedNotificationReadState.notificationIds)} accessibilityRole="button" accessibilityLabel="Retry marking activity read">
                <Text style={styles.readRetryText}>Try again</Text>
              </Pressable>
            ) : null}
          </View>
        )}
        {unavailableNotice && (
          <View style={styles.notice} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Icon name="lock" size={16} color={colors.amber} />
            <Text style={styles.noticeText}>{unavailableNotice}</Text>
            <Pressable onPress={iosNavigation ? iosNavigation.dismissNotice : () => setUnavailableNotice(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Dismiss unavailable post message">
              <Icon name="x" size={14} color={colors.textDim} />
            </Pressable>
          </View>
        )}
        <View style={styles.modePanel}>
          <View style={styles.modeTabs} accessibilityRole="tablist">
            {[
              ["recent", "Recent"],
              ["digest", "Digest"],
            ].map(([value, label]) => {
              const selected = viewMode === value;
              return (
                <Pressable
                  key={value}
                  onPress={() => setViewMode(value)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${label} activity view`}
                  style={[styles.modeTab, selected && styles.modeTabSelected]}
                >
                  <Text style={[styles.modeTabText, selected && styles.modeTabTextSelected]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.modeScope}>
            {viewMode === "digest"
              ? "Digest groups only the activity currently loaded here. It does not schedule or send push or email updates."
              : "Recent shows each loaded activity item separately."}
          </Text>
        </View>
        <View style={styles.modePanel}>
          <Text style={styles.modeScope}>Opening or refreshing Activity does not mark it read.</Text>
          {unreadIds.length > 0 && canMarkRead && (
            <Pressable style={styles.readRetry} accessibilityRole="button" accessibilityLabel="Mark loaded activity as read"
              disabled={scopedNotificationReadState.status === "pending"}
              accessibilityState={{ disabled: scopedNotificationReadState.status === "pending" }}
              onPress={() => void readCurrentNotifications(unreadIds)}>
              <Text style={styles.readRetryText}>{scopedNotificationReadState.status === "pending" ? "Marking read…" : `Mark loaded as read (${unreadIds.length})`}</Text>
            </Pressable>
          )}
          {unreadIds.length > 0 && !canMarkRead && activityStatus === "ready" && (
            <Text style={styles.modeScope}>Marking activity read is temporarily unavailable. Your unread badge is unchanged.</Text>
          )}
        </View>
        {(activityStatus === "loading" || activityStatus === "idle") && items.length === 0 && (
          <View style={styles.empty}><ActivityIndicator color={colors.amber} /><Text style={styles.emptySub}>Loading activity…</Text></View>
        )}
        {activityStatus === "refreshing" && items.length > 0 && <Text style={styles.modeScope}>Updating activity…</Text>}
        {activityError && (
          <View style={styles.readNotice} accessibilityRole="alert">
            <Text style={styles.readNoticeText}>{items.length ? "Couldn't update activity. Showing previously loaded activity. " : "Couldn't load activity. "}{activityError.userMessage || "Check your connection and try again."}</Text>
            <Pressable style={styles.readRetry} accessibilityRole="button" accessibilityLabel="Retry loading activity" onPress={refreshActivity}>
              <Text style={styles.readRetryText}>Try again</Text>
            </Pressable>
          </View>
        )}
        {items.length === 0 && activityStatus === "ready" && (
          <View style={styles.empty}>
            <Icon name="heart" size={28} color={colors.textFaint} />
            <Text style={styles.emptyTitle}>No activity yet</Text>
            <Text style={styles.emptySub}>When people follow you, tag you, like your reviews, comment, or message you, it shows up here.</Text>
          </View>
        )}
        {activityRows.map(({ key, notification: n, bundle }) => {
          const meta = META[n.type] || META.like;
          const actorName = bundle?.actorSummary || n.actorName || "Someone";
          const rowCopy = notificationCopy(n, actorName);
          const groupedCopy = bundle?.count > 1 ? `${rowCopy}. ${bundle.count} related activities.` : rowCopy;
          return (
            <Pressable
              key={key}
              style={[styles.row, !(bundle ? bundle.read : n.read) && styles.rowUnread]}
              onPress={() => { void open(n); }}
              accessibilityRole="button"
              accessibilityLabel={groupedCopy}
              accessibilityHint="Opens the related profile, conversation, or post"
              accessibilityState={{ busy: openingNotificationId === n.id }}
            >
              <View style={styles.avatarWrap}>
                {n.type === "artist_update" ? (
                  <View style={styles.newsMark}><Icon name="music" size={18} color={colors.amber} /></View>
                ) : (
                  <Avatar user={{ name: n.actorName, initials: n.actorInitials, avatarUri: n.actorUri, avatarColor: n.actorColor }} size={40} onPress={n.actorId ? () => iosNavigation ? iosNavigation.openProfile(n.actorId) : leaveActivity(onOpenProfile, n.actorId) : undefined} />
                )}
                <View style={[styles.badge, { backgroundColor: meta.tint }]}>
                  <Icon name={meta.icon} size={11} color="#0B0E16" filled />
                </View>
              </View>
              <View style={{ flex: 1 }}>
                {n.type === "artist_update" ? (
                  <Text style={styles.text}><Text style={styles.who}>{n.artist || "An artist you follow"}</Text> {n.text || "has news"}</Text>
                ) : n.type === "welcome" ? (
                  <Text style={styles.text}>
                    <Text style={styles.who}>Welcome to Pit! </Text>
                    Follow people whose taste matches yours, log the shows you go to, and rate the band vs. the room.
                  </Text>
                ) : (
                  <Text style={styles.text}>
                    <Text style={styles.who}>{actorName}</Text> {n.type === "post_tag" ? postTagNotificationPhrase(n.artist) : n.type === "plan_join" ? planJoinPhrase(n.artist) : meta.verb}
                    {(n.type === "like" || n.type === "comment") && n.artist ? <Text style={styles.ref}> of {n.artist}</Text> : null}
                  </Text>
                )}
                {n.type === "comment" && n.text ? <Text style={styles.preview} numberOfLines={1}>“{n.text}”</Text> : null}
                {n.type === "dm" && n.text ? <Text style={styles.preview} numberOfLines={1}>“{n.text}”</Text> : null}
                {n.type === "plan_join" && n.text ? <Text style={styles.preview} numberOfLines={1}>“{n.text}”</Text> : null}
                {bundle?.count > 1 ? <Text style={styles.bundleCount}>{bundle.count} RELATED ACTIVITIES</Text> : null}
              </View>
              {openingNotificationId === n.id && <ActivityIndicator size="small" color={colors.amber} />}
              <Text style={styles.time}>{ago(bundle?.ts ?? n.ts)}</Text>
              {!(bundle ? bundle.read : n.read) && <View style={styles.dot} />}
            </Pressable>
          );
        })}
        {notificationActivity?.data?.historyLimited && <Text style={styles.modeScope}>Showing the latest 1,000 activities. Refresh to see newer activity.</Text>}
        {!!nextCursor && (
          <Pressable style={styles.readRetry} accessibilityRole="button" accessibilityLabel="Load older activity"
            disabled={loadingOlder || activityRefreshing} accessibilityState={{ disabled: loadingOlder || activityRefreshing }} onPress={loadOlder}>
            <Text style={styles.readRetryText}>{loadingOlder ? "Loading older activity…" : "Load older"}</Text>
          </Pressable>
        )}
      </ScrollView>
      </VinylRefreshBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), paddingBottom: space(10) },
  readNotice: { flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, padding: 11, marginBottom: 10 },
  readNoticeText: { flex: 1, color: colors.text, fontSize: 12.5, lineHeight: 18 },
  readRetry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 11, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber },
  readRetryText: { color: colors.amber, fontSize: 11.5, fontWeight: "800" },
  notice: { flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, padding: 11, marginBottom: 10 },
  noticeText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
  modePanel: { marginBottom: space(3), gap: 8 },
  modeTabs: { flexDirection: "row", padding: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  modeTab: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  modeTabSelected: { backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.amber },
  modeTabText: { color: colors.textDim, fontSize: 12, fontWeight: "800" },
  modeTabTextSelected: { color: colors.amber },
  modeScope: { color: colors.textFaint, fontSize: 11.5, lineHeight: 17, paddingHorizontal: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: radius.md, marginBottom: 4 },
  rowUnread: { backgroundColor: colors.bgElev },
  avatarWrap: { width: 40, height: 40 },
  newsMark: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line },
  badge: { position: "absolute", right: -3, bottom: -3, width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.bg, alignItems: "center", justifyContent: "center" },
  text: { color: colors.text, fontSize: 14, lineHeight: 20 },
  who: { fontWeight: "800" },
  ref: { color: colors.amber, fontWeight: "600" },
  preview: { color: colors.textDim, fontSize: 13, marginTop: 2, fontStyle: "italic" },
  bundleCount: { color: colors.textFaint, fontFamily: mono, fontSize: 9, fontWeight: "800", letterSpacing: 0.7, marginTop: 5 },
  time: { color: colors.textFaint, fontFamily: mono, fontSize: 11 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.amberStrong },
  empty: { alignItems: "center", gap: 8, paddingTop: 60, paddingHorizontal: 30 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "800", marginTop: 6 },
  emptySub: { color: colors.textDim, fontSize: 14, textAlign: "center", lineHeight: 20 },
});
