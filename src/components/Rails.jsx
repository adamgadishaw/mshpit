import { useEffect, useState } from "react";
import { Platform, View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { colors, displayFont, focusRing, font, mono, radius, roleColor, shadow } from "../theme";
import Avatar from "./Avatar";
import Icon from "./Icon";
import { UpcomingEventCard } from "./VenueDiscoveryCards";
import { PopularLoungeCard } from "./LiveDiscoveryCards";
import { PublicPressableLink } from "./PublicWebLinks";
import {
  RIGHT_RAIL_EVENT_SCOPE,
  reconcileRightRailScopeChoice,
  rightRailDefaultScope,
  rightRailEventsForScope,
  rightRailScopeIdentity,
} from "../domain/rightRailEvents.mjs";
import { liveEventTitle, localDiscoveryEvents } from "../domain/liveDiscovery.mjs";
import { artistPath, eventPath } from "../domain/urls.mjs";

const NAV = [
  { key: "feed", label: "Feed", icon: "feed" },
  { key: "search", label: "Search", icon: "search" },
  { key: "discover", label: "Discover", icon: "discover" },
  { key: "you", label: "You", icon: "you" },
];

function TopCountBadge({ count = 0 }) {
  if (count <= 0) return null;
  return (
    <View style={styles.topCountBadge}>
      <Text style={styles.topCountText}>{count > 99 ? "99+" : count}</Text>
    </View>
  );
}

function TopIconButton({ icon, label, count = 0, onPress }) {
  return (
    <Pressable
      style={({ pressed, hovered, focused }) => [
        styles.topIconButton,
        hovered && styles.topControlHover,
        pressed && styles.topControlPressed,
        focused && focusRing,
      ]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `${label}, ${count} new` : label}
      accessibilityState={{ disabled: !onPress }}
      hitSlop={5}
    >
      <Icon name={icon} size={19} color={colors.textDim} />
      <TopCountBadge count={count} />
    </Pressable>
  );
}

// Desktop's single global navigation surface. The app shell owns navigation
// state; this component only presents it, so swapping pages never remounts the
// persistent player column that sits beside the routed content.
export function DesktopTopNav({
  tab,
  setTab,
  session,
  unread = 0,
  notifUnread = 0,
  compact = false,
  onHome,
  onLog,
  onActivity,
  onInbox,
  onClips,
  onMenu,
  onAccount,
  onIntro,
  onLogin,
  onSignup,
}) {
  const selectTab = (key) => setTab?.(key);
  const goHome = () => {
    if (onHome) onHome();
    else selectTab("feed");
  };

  return (
    <View style={styles.desktopTopNav} accessibilityLabel="Primary navigation">
      <PublicPressableLink
        href="/"
        onNavigate={goHome}
        style={({ pressed, focused }) => [styles.topBrandButton, pressed && styles.topControlPressed, focused && focusRing]}
        accessibilityLabel="Pit home"
      >
        <Text style={styles.topBrand}>MSHPIT</Text>
      </PublicPressableLink>

      <View style={styles.topTabs} accessibilityRole="tablist">
        {NAV.map((item) => {
          const active = tab === item.key;
          return (
            <Pressable
              key={item.key}
              style={({ pressed, hovered, focused }) => [
                styles.topTab,
                active && styles.topTabActive,
                hovered && !active && styles.topControlHover,
                pressed && styles.topControlPressed,
                focused && focusRing,
              ]}
              onPress={() => selectTab(item.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
            >
              <Icon name={item.icon} size={18} color={active ? colors.amber : colors.textDim} />
              {!compact && <Text style={[styles.topTabText, active && styles.topTabTextActive]}>{item.label}</Text>}
            </Pressable>
          );
        })}
      </View>

      <Pressable
        style={({ pressed, hovered, focused }) => [
          styles.topPostButton,
          hovered && !pressed && styles.topPostHover,
          pressed && styles.topPostPressed,
          focused && focusRing,
        ]}
        onPress={onLog}
        disabled={!onLog}
        accessibilityRole="button"
        accessibilityLabel="Make a post"
        accessibilityState={{ disabled: !onLog }}
      >
        <Icon name="plus" size={17} color="#1A1206" strokeWidth={2.6} />
        {!compact && <Text style={styles.topPostText}>Make a post</Text>}
      </Pressable>

      <View style={styles.topActions}>
        {!!onClips && <TopIconButton icon="play" label="Clips" onPress={onClips} />}
        <TopIconButton icon="bell" label="Activity" count={notifUnread} onPress={onActivity} />
        <TopIconButton icon="mail" label="Inbox" count={unread} onPress={onInbox} />
        <TopIconButton icon="menu" label="Menu" onPress={onMenu} />

        {session ? (
          <Pressable
            style={({ pressed, hovered, focused }) => [
              styles.topAccount,
              hovered && styles.topControlHover,
              pressed && styles.topControlPressed,
              focused && focusRing,
            ]}
            onPress={onAccount}
            disabled={!onAccount}
            accessibilityRole="button"
            accessibilityLabel={`Account menu for ${session.name || session.handle || "your account"}`}
            accessibilityState={{ disabled: !onAccount }}
          >
            <Avatar user={session} size={30} />
            {!compact && (
              <View style={styles.topAccountCopy}>
                <Text style={styles.topAccountName} numberOfLines={1}>{session.name}</Text>
                <Text
                  style={[styles.topAccountHandle, roleColor(session.role) && { color: roleColor(session.role), fontWeight: "800" }]}
                  numberOfLines={1}
                >
                  @{session.handle}
                </Text>
              </View>
            )}
            <Icon name="chevron-down" size={14} color={colors.textDim} />
          </Pressable>
        ) : (
          <View style={styles.topAuthActions}>
            {!!onIntro && (
              <Pressable
                style={({ pressed, hovered, focused }) => [styles.topIntroButton, hovered && styles.topControlHover, pressed && styles.topControlPressed, focused && focusRing]}
                onPress={onIntro}
                accessibilityRole="button"
                accessibilityLabel="Back to intro"
              >
                <Icon name="chevron-left" size={15} color={colors.textDim} />
                {!compact && <Text style={styles.topIntroText}>Intro</Text>}
              </Pressable>
            )}
            <Pressable
              style={({ pressed, hovered, focused }) => [styles.topLoginButton, hovered && styles.topControlHover, pressed && styles.topControlPressed, focused && focusRing]}
              onPress={onLogin}
              disabled={!onLogin}
              accessibilityRole="button"
              accessibilityLabel="Log in"
              accessibilityState={{ disabled: !onLogin }}
            >
              <Text style={styles.topLoginText}>Log in</Text>
            </Pressable>
            <Pressable
              style={({ pressed, hovered, focused }) => [styles.topSignupButton, hovered && !pressed && styles.topPostHover, pressed && styles.topPostPressed, focused && focusRing]}
              onPress={onSignup || onLogin}
              disabled={!onSignup && !onLogin}
              accessibilityRole="button"
              accessibilityLabel="Sign up"
              accessibilityState={{ disabled: !onSignup && !onLogin }}
            >
              <Text style={styles.topSignupText}>Sign up</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

// Right rail: contextual widgets, Top / A-Z artists, active lounges, upcoming
// events. Read-only discovery surfaces that stay out of the feed's way.
export function RightRail({
  railWidth = 340,
  topArtists,
  artistsAlphabetical,
  upcomingEvents,
  discoverySidebar = {},
  discoverySidebarStatus = "idle",
  accountId,
  homeCity,
  onOpenArtist,
  onOpenLounge,
  onOpenDiscover,
  onOpenEvent,
}) {
  const [artistMode, setArtistMode] = useState("top"); // 'top' | 'az'
  const eventScopeIdentity = rightRailScopeIdentity({ accountId, homeCity });
  const defaultEventScope = rightRailDefaultScope({ homeCity });
  const [eventScopeChoice, setEventScopeChoice] = useState(
    () => reconcileRightRailScopeChoice(null, { accountId, homeCity }),
  );
  const eventScope = eventScopeChoice.identity === eventScopeIdentity
    ? eventScopeChoice.value
    : defaultEventScope;

  useEffect(() => {
    setEventScopeChoice((current) => reconcileRightRailScopeChoice(current, { accountId, homeCity }));
  }, [accountId, defaultEventScope, eventScopeIdentity, homeCity]);

  const chooseEventScope = (value) => {
    setEventScopeChoice({ identity: eventScopeIdentity, value, touched: true });
  };
  const artists = artistMode === "top"
    ? (discoverySidebar.topArtists?.length ? discoverySidebar.topArtists.slice(0, 8) : topArtists(8))
    : artistsAlphabetical(10);
  const lounges = Array.isArray(discoverySidebar.popularLounges) ? discoverySidebar.popularLounges.slice(0, 5) : [];
  const events = rightRailEventsForScope({
    scope: eventScope,
    nearEvents: localDiscoveryEvents(discoverySidebar.upcomingEvents, { limit: 6 }),
    worldEvents: eventScope === RIGHT_RAIL_EVENT_SCOPE.WORLD ? upcomingEvents?.(6) : [],
    limit: 6,
  });
  const localLabel = discoverySidebar.location?.city ? ` near ${discoverySidebar.location.city}` : "";
  const listingEmpty = discoverySidebarStatus === "loading"
    ? "Finding shows near you..."
    : discoverySidebarStatus === "error"
      ? "The local lineup missed a beat. Try refreshing."
      : discoverySidebar.source?.providerConfigured === false
        ? "Live listings are waiting for a ticket provider."
        : `No upcoming shows${localLabel} yet.`;
  const eventListingEmpty = eventScope === RIGHT_RAIL_EVENT_SCOPE.WORLD
    ? (discoverySidebar.source?.providerConfigured === false
      ? "Live listings are waiting for a ticket provider."
      : "No upcoming shows worldwide yet.")
    : listingEmpty;
  const eventScopeSubtitle = eventScope === RIGHT_RAIL_EVENT_SCOPE.WORLD
    ? "Soonest worldwide dates"
    : (discoverySidebar.location?.city ? `Near ${discoverySidebar.location.city}` : "Near you");

  return (
    <ScrollView style={[styles.right, { width: railWidth, flexBasis: railWidth }]} contentContainerStyle={styles.rightContent} showsVerticalScrollIndicator={false}>
      {/* Artists, Top / A-Z toggle */}
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>ARTISTS</Text>
          <View style={styles.toggle}>
            <Pressable onPress={() => setArtistMode("top")} style={({ pressed }) => [styles.tgBtn, artistMode === "top" && styles.tgOn, pressed && styles.itemPressed]} accessibilityRole="tab" accessibilityState={{ selected: artistMode === "top" }}>
              <Text style={[styles.tgTxt, artistMode === "top" && styles.tgTxtOn]}>Top</Text>
            </Pressable>
            <Pressable onPress={() => setArtistMode("az")} style={({ pressed }) => [styles.tgBtn, artistMode === "az" && styles.tgOn, pressed && styles.itemPressed]} accessibilityRole="tab" accessibilityState={{ selected: artistMode === "az" }}>
              <Text style={[styles.tgTxt, artistMode === "az" && styles.tgTxtOn]}>A-Z</Text>
            </Pressable>
          </View>
        </View>
        {artists.map((a, i) => (
          <PublicPressableLink
            key={a.name}
            href={artistPath(a)}
            onNavigate={() => onOpenArtist?.(a)}
            style={({ pressed, hovered, focused }) => [styles.aRow, hovered && styles.rowHover, pressed && styles.rowPressed, focused && focusRing]}
            accessibilityLabel={`Open ${a.name}`}
          >
            {artistMode === "top" ? (
              <Text style={styles.rank}>{i + 1}</Text>
            ) : (
              <View style={styles.aDot}><Icon name="music" size={13} color={colors.amber} /></View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.aName} numberOfLines={1}>{a.name}</Text>
              {!!a.genre && <Text style={styles.aSub} numberOfLines={1}>{a.genre}</Text>}
            </View>
            {artistMode === "top" && a.avg > 0 && (
              <View style={styles.scorePill}><Icon name="star" size={10} color={colors.gold} /><Text style={styles.scoreTxt}>{a.avg.toFixed(1)}</Text></View>
            )}
          </PublicPressableLink>
        ))}
      </View>

      {/* Popular active concert lounges; aggregate activity only. */}
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>POPULAR LOUNGES</Text>
          <Pressable onPress={onOpenDiscover} disabled={!onOpenDiscover} accessibilityRole="button" accessibilityLabel="See all popular concert lounges" accessibilityState={{ disabled: !onOpenDiscover }}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>
        {lounges.length === 0 && <Text style={styles.empty}>Active rooms appear here when fans are talking about a show.</Text>}
        <View style={styles.loungeList}>
          {lounges.map((lounge) => <PopularLoungeCard key={lounge.key} lounge={lounge} compact onPress={() => onOpenLounge?.(lounge)} />)}
        </View>
      </View>

      {/* Upcoming events */}
      <View style={styles.card}>
        <View style={styles.eventCardHead}>
          <View>
            <Text style={styles.cardTitle}>UPCOMING EVENTS</Text>
            <Text style={styles.eventCardSub}>{eventScopeSubtitle}</Text>
          </View>
          <View style={styles.eventCalendarMark}><Icon name="calendar" size={15} color={colors.amber} /></View>
        </View>
        <View style={[styles.toggle, styles.eventScopeToggle]} accessibilityRole="tablist" accessibilityLabel="Upcoming event area">
          <Pressable
            onPress={() => chooseEventScope(RIGHT_RAIL_EVENT_SCOPE.NEAR)}
            style={({ pressed, focused }) => [
              styles.eventScopeButton,
              eventScope === RIGHT_RAIL_EVENT_SCOPE.NEAR && styles.tgOn,
              pressed && styles.itemPressed,
              focused && focusRing,
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: eventScope === RIGHT_RAIL_EVENT_SCOPE.NEAR }}
          >
            <Text style={[styles.tgTxt, eventScope === RIGHT_RAIL_EVENT_SCOPE.NEAR && styles.tgTxtOn]}>Near</Text>
          </Pressable>
          <Pressable
            onPress={() => chooseEventScope(RIGHT_RAIL_EVENT_SCOPE.WORLD)}
            style={({ pressed, focused }) => [
              styles.eventScopeButton,
              eventScope === RIGHT_RAIL_EVENT_SCOPE.WORLD && styles.tgOn,
              pressed && styles.itemPressed,
              focused && focusRing,
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: eventScope === RIGHT_RAIL_EVENT_SCOPE.WORLD }}
          >
            <Text style={[styles.tgTxt, eventScope === RIGHT_RAIL_EVENT_SCOPE.WORLD && styles.tgTxtOn]}>World</Text>
          </Pressable>
        </View>
        {events.length === 0 && <Text style={styles.empty}>{eventListingEmpty}</Text>}
        <View style={styles.eventList}>
          {events.map((event) => (
            <PublicPressableLink
              key={event.id}
              href={eventPath(event)}
              onNavigate={() => (onOpenEvent ? onOpenEvent(event) : onOpenArtist?.(event.artist))}
              style={({ pressed, hovered, focused }) => [styles.eventPressable, hovered && styles.eventHover, pressed && styles.rowPressed, focused && focusRing]}
              accessibilityLabel={`Open ${liveEventTitle(event)} at ${event.venue}${event.place ? `, ${event.place}` : ""}${event.date ? `, ${event.date}` : ""}`}
            >
              <UpcomingEventCard event={event} compact />
            </PublicPressableLink>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // desktop global navigation
  desktopTopNav: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.bgElev,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  topBrandButton: { minWidth: 64, minHeight: 42, alignItems: "flex-start", justifyContent: "center", borderRadius: radius.sm, paddingHorizontal: 8 },
  topBrand: { color: colors.amber, fontFamily: mono, fontSize: 22, fontWeight: "900", letterSpacing: 3 },
  topTabs: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  topTab: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "transparent",
    ...Platform.select({ web: { cursor: "pointer", transitionDuration: "110ms", transitionProperty: "background-color, border-color, transform" } }),
  },
  topTabActive: { backgroundColor: colors.surfaceAlt, borderColor: colors.line },
  topTabText: { color: colors.textDim, fontFamily: font, fontSize: 13, fontWeight: "700" },
  topTabTextActive: { color: colors.amber, fontFamily: displayFont, fontWeight: "800" },
  topPostButton: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.amberStrong,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderBottomWidth: 3,
    borderColor: colors.amber,
    borderBottomColor: colors.accentEdge,
    ...shadow.control,
    ...Platform.select({ web: { cursor: "pointer", transitionDuration: "110ms", transitionProperty: "filter, transform, box-shadow" } }),
  },
  topPostHover: { transform: [{ translateY: -1 }], ...Platform.select({ web: { filter: "brightness(1.06)" } }) },
  topPostPressed: { transform: [{ translateY: 2 }], boxShadow: "inset 0 1px 3px rgba(0,0,0,0.18)" },
  topPostText: { color: "#1A1206", fontFamily: displayFont, fontSize: 13, fontWeight: "800" },
  topActions: { flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 0 },
  topIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    ...Platform.select({ web: { cursor: "pointer", transitionDuration: "110ms", transitionProperty: "background-color, transform" } }),
  },
  topCountBadge: { position: "absolute", top: -4, right: -4, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: colors.magenta, borderWidth: 2, borderColor: colors.bgElev },
  topCountText: { color: "#FFFFFF", fontFamily: mono, fontSize: 9, fontWeight: "900", fontVariant: ["tabular-nums"] },
  topControlHover: { backgroundColor: colors.surfaceAlt },
  topControlPressed: { transform: [{ scale: 0.97 }], opacity: 0.9 },
  topAccount: {
    minHeight: 42,
    maxWidth: 190,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingLeft: 5,
    paddingRight: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    ...Platform.select({ web: { cursor: "pointer", transitionDuration: "110ms", transitionProperty: "background-color, transform" } }),
  },
  topAccountCopy: { minWidth: 0, maxWidth: 118 },
  topAccountName: { color: colors.text, fontFamily: displayFont, fontSize: 12.5, fontWeight: "800" },
  topAccountHandle: { color: colors.textDim, fontSize: 10.5, marginTop: 1 },
  topAuthActions: { flexDirection: "row", alignItems: "center", gap: 7 },
  topIntroButton: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 8, borderRadius: radius.pill },
  topIntroText: { color: colors.textDim, fontFamily: font, fontSize: 13, fontWeight: "700" },
  topLoginButton: { minHeight: 40, alignItems: "center", justifyContent: "center", paddingHorizontal: 13, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  topLoginText: { color: colors.text, fontFamily: displayFont, fontSize: 13, fontWeight: "800" },
  topSignupButton: { minHeight: 40, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.amberStrong, borderWidth: 1, borderBottomWidth: 3, borderColor: colors.amber, borderBottomColor: colors.accentEdge, ...shadow.control },
  topSignupText: { color: "#1A1206", fontFamily: displayFont, fontSize: 13, fontWeight: "800" },

  // right rail, RNW gives ScrollView a default flex:1, so pin it rigid or it
  // grows past its width and starves the feed column.
  right: { width: 340, flexGrow: 0, flexShrink: 0, flexBasis: 340 },
  rightContent: { padding: 16, gap: 14 },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, padding: 14, ...shadow.card },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  cardTitle: { color: colors.textFaint, fontFamily: displayFont, fontSize: 11, letterSpacing: 1.35, fontWeight: "800" },
  seeAll: { color: colors.amber, fontSize: 12, fontWeight: "700" },
  toggle: { flexDirection: "row", backgroundColor: colors.bgElev, borderRadius: radius.pill, padding: 3, borderWidth: 1, borderColor: colors.line, boxShadow: "inset 0 1px 3px rgba(0,0,0,0.15)" },
  tgBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  tgOn: { backgroundColor: colors.amberStrong, boxShadow: "0 2px 5px rgba(0,0,0,0.18)" },
  tgTxt: { color: colors.textDim, fontSize: 11, fontWeight: "700" },
  tgTxtOn: { color: "#1A1206" },
  aRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, paddingHorizontal: 6, marginHorizontal: -6, borderRadius: radius.sm, borderCurve: "continuous" },
  rank: { color: colors.textFaint, fontFamily: mono, fontSize: 13, fontWeight: "800", width: 18, textAlign: "center" },
  aDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  aName: { color: colors.text, fontFamily: displayFont, fontSize: 14, fontWeight: "800", letterSpacing: -0.1 },
  aSub: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  scorePill: { flexDirection: "row", alignItems: "center", gap: 3 },
  scoreTxt: { color: colors.gold, fontFamily: mono, fontSize: 12, fontWeight: "700" },
  upPill: { backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.amber, borderRadius: radius.pill, minWidth: 24, paddingHorizontal: 7, paddingVertical: 2, alignItems: "center" },
  upTxt: { color: colors.amber, fontSize: 12, fontWeight: "800" },
  eventCardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 },
  eventCardSub: { color: colors.textDim, fontSize: 10, marginTop: 3 },
  eventCalendarMark: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line },
  eventScopeToggle: { alignSelf: "stretch", marginBottom: 10 },
  eventScopeButton: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  eventList: { gap: 8 },
  loungeList: { gap: 8 },
  eventPressable: { borderRadius: radius.md, borderCurve: "continuous", ...Platform.select({ web: { cursor: "pointer", transitionDuration: "110ms", transitionProperty: "transform, filter" } }) },
  eventHover: { ...Platform.select({ web: { filter: "brightness(1.06)" } }) },
  empty: { color: colors.textDim, fontSize: 12, fontStyle: "italic" },
  itemPressed: { transform: [{ scale: 0.98 }], opacity: 0.88 },
  rowHover: { backgroundColor: colors.surfaceAlt },
  rowPressed: { backgroundColor: colors.bgElev, transform: [{ scale: 0.985 }] },
});
