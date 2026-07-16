import { useState } from "react";
import { Platform, View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { colors, displayFont, focusRing, font, mono, radius, shadow } from "../theme";
import { useStore } from "../store";
import Avatar from "./Avatar";
import Icon from "./Icon";

const NAV = [
  { key: "feed", label: "Feed", icon: "feed" },
  { key: "search", label: "Search", icon: "search" },
  { key: "discover", label: "Discover", icon: "discover" },
  { key: "you", label: "You", icon: "you" },
];

// Left navigation rail (desktop). Mirrors the mobile tab bar + the menu's quick
// links, so nothing is lost when the bottom bar is hidden on wide screens.
export function LeftRail({ tab, setTab, session, unread = 0, notifUnread = 0, onLog, onFindVenues, onFanClubs, onNearby, onTopRated, onInbox, onActivity, onProfile, onEditProfile, onLogin }) {
  const NavItem = ({ item }) => {
    const on = tab === item.key;
    return (
      <Pressable
        style={({ pressed, hovered, focused }) => [
          styles.navItem,
          on && styles.navItemOn,
          hovered && !on && styles.itemHover,
          pressed && styles.itemPressed,
          focused && focusRing,
        ]}
        onPress={() => setTab(item.key)}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
      >
        <Icon name={item.icon} size={20} color={on ? colors.amber : colors.textDim} />
        <Text style={[styles.navTxt, on && styles.navTxtOn]}>{item.label}</Text>
      </Pressable>
    );
  };
  const Link = ({ icon, label, badge, onPress }) => (
    <Pressable
      style={({ pressed, hovered, focused }) => [styles.link, hovered && styles.itemHover, pressed && styles.itemPressed, focused && focusRing]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={badge > 0 ? `${label}, ${badge} unread` : label}
    >
      <Icon name={icon} size={18} color={colors.textDim} />
      <Text style={styles.linkTxt}>{label}</Text>
      {badge > 0 && <View style={styles.badge}><Text style={styles.badgeTxt}>{badge}</Text></View>}
    </Pressable>
  );

  return (
    <View style={styles.left}>
      <View style={{ gap: 4 }}>
        {NAV.map((item) => <NavItem key={item.key} item={item} />)}
      </View>

      <Pressable
        style={({ pressed, hovered, focused }) => [styles.logBtn, hovered && !pressed && styles.logBtnHover, pressed && styles.logBtnPressed, focused && focusRing]}
        onPress={onLog}
        accessibilityRole="button"
      >
        <Icon name="plus" size={18} color="#1A1206" strokeWidth={2.6} />
        <Text style={styles.logTxt}>Make a post</Text>
      </Pressable>

      {/* The lower-left rail is deliberately EMPTY below this point: it's the
          reserved dock for the YouTube player window (src/lib/youtubePlayer.js
          pins itself bottom-left). YouTube's API terms require the video to be
          visible whenever it's playing, so the player owns this space instead
          of the old DISCOVER shortcut list (those all live elsewhere: Discover
          tab, Search, and the top-bar Activity/Inbox buttons). */}
    </View>
  );
}

// Right rail: contextual widgets, Top / A-Z artists, trending venues, upcoming
// events. Read-only discovery surfaces that stay out of the feed's way.
export function RightRail({ onOpenArtist, onOpenVenue, onFindVenues, onOpenEvent }) {
  const { topArtists, artistsAlphabetical, trendingVenues, upcomingEvents, discoverySidebar, discoverySidebarStatus } = useStore();
  const [artistMode, setArtistMode] = useState("top"); // 'top' | 'az'
  const artists = artistMode === "top"
    ? (discoverySidebar.topArtists?.length ? discoverySidebar.topArtists.slice(0, 8) : topArtists(8))
    : artistsAlphabetical(10);
  const venues = discoverySidebar.trendingVenues?.length ? discoverySidebar.trendingVenues.slice(0, 6) : trendingVenues(6);
  const events = discoverySidebar.upcomingEvents?.length ? discoverySidebar.upcomingEvents.slice(0, 6) : upcomingEvents(6);
  const localLabel = discoverySidebar.location?.city ? ` near ${discoverySidebar.location.city}` : "";
  const listingEmpty = discoverySidebarStatus === "loading"
    ? "Tuning your local lineup..."
    : discoverySidebarStatus === "error"
      ? "The local lineup missed a beat. Try refreshing."
      : discoverySidebar.source?.providerConfigured === false
        ? "Live listings are waiting for a ticket provider."
        : `No upcoming shows${localLabel} yet.`;

  return (
    <ScrollView style={styles.right} contentContainerStyle={styles.rightContent} showsVerticalScrollIndicator={false}>
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
          <Pressable key={a.name} style={({ pressed, hovered, focused }) => [styles.aRow, hovered && styles.rowHover, pressed && styles.rowPressed, focused && focusRing]} onPress={() => onOpenArtist?.(a.name)} accessibilityRole="button">
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
          </Pressable>
        ))}
      </View>

      {/* Trending venues */}
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>TRENDING VENUES</Text>
          <Pressable onPress={onFindVenues}><Text style={styles.seeAll}>See all</Text></Pressable>
        </View>
        {venues.length === 0 && <Text style={styles.empty}>{listingEmpty}</Text>}
        {venues.map((v) => (
          <Pressable key={v.name} style={({ pressed, hovered, focused }) => [styles.aRow, hovered && styles.rowHover, pressed && styles.rowPressed, focused && focusRing]} onPress={() => onOpenVenue?.(v.name)} accessibilityRole="button">
            <View style={styles.aDot}><Icon name="pin" size={13} color={colors.cool} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.aName} numberOfLines={1}>{v.name}</Text>
              <Text style={styles.aSub} numberOfLines={1}>{(v.place || "").split(",").slice(0, 2).join(", ")}</Text>
            </View>
            <View style={styles.upPill}><Text style={styles.upTxt}>{v.upcoming}</Text></View>
          </Pressable>
        ))}
      </View>

      {/* Upcoming events */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>UPCOMING EVENTS</Text>
        {events.length === 0 && <Text style={styles.empty}>{listingEmpty}</Text>}
        {events.map((t) => (
          <Pressable key={t.id} style={({ pressed, hovered, focused }) => [styles.eRow, hovered && styles.rowHover, pressed && styles.rowPressed, focused && focusRing]} onPress={() => (onOpenEvent ? onOpenEvent(t) : onOpenArtist?.(t.artist))} accessibilityRole="button">
            <View style={styles.eDate}><Icon name="calendar" size={13} color={colors.amber} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.aName} numberOfLines={1}>{t.artist}</Text>
              <Text style={styles.aSub} numberOfLines={1}>{t.venue}{t.place ? ` · ${t.place.split(",")[0]}` : ""} · {t.date}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // left rail
  left: { width: 200, flexGrow: 0, flexShrink: 0, flexBasis: 200, paddingHorizontal: 12, paddingVertical: 18, borderRightWidth: 1, borderRightColor: colors.lineSoft, gap: 6 },
  navItem: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderBottomWidth: 3, borderColor: "transparent", ...Platform.select({ web: { cursor: "pointer", transitionDuration: "110ms", transitionProperty: "background-color, transform, box-shadow" } }) },
  navItemOn: { backgroundColor: colors.surfaceAlt, borderColor: colors.line, borderBottomColor: colors.accentEdge, ...shadow.control },
  navTxt: { color: colors.textDim, fontFamily: font, fontSize: 15, fontWeight: "600" },
  navTxtOn: { color: colors.amber, fontFamily: displayFont, fontWeight: "800" },
  logBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.amberStrong, borderRadius: radius.pill, borderWidth: 1, borderBottomWidth: 4, borderColor: colors.amber, borderBottomColor: colors.accentEdge, paddingVertical: 11, marginTop: 12, ...shadow.control, ...Platform.select({ web: { cursor: "pointer", transitionDuration: "110ms", transitionProperty: "filter, transform, box-shadow" } }) },
  logBtnHover: { transform: [{ translateY: -1 }], ...Platform.select({ web: { filter: "brightness(1.06)" } }) },
  logBtnPressed: { transform: [{ translateY: 3 }], boxShadow: "inset 0 1px 3px rgba(0,0,0,0.18)" },
  logTxt: { color: "#1A1206", fontFamily: displayFont, fontSize: 14, fontWeight: "800", letterSpacing: 0.1 },
  divider: { height: 1, backgroundColor: colors.lineSoft, marginVertical: 14 },
  railLabel: { color: colors.textFaint, fontSize: 10, letterSpacing: 1.5, fontWeight: "700", marginBottom: 6, marginLeft: 12 },
  link: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9, paddingHorizontal: 12, borderRadius: radius.md, borderCurve: "continuous", ...Platform.select({ web: { cursor: "pointer" } }) },
  linkTxt: { color: colors.text, fontFamily: font, fontSize: 14, fontWeight: "600", flex: 1 },
  badge: { backgroundColor: colors.amberStrong, borderRadius: 10, minWidth: 20, paddingHorizontal: 6, paddingVertical: 1, alignItems: "center" },
  badgeTxt: { color: "#1A1206", fontSize: 11, fontWeight: "800" },
  me: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 10 },
  meName: { color: colors.text, fontSize: 14, fontWeight: "800" },
  meSub: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  loginBtn: { backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 12, alignItems: "center" },
  loginTxt: { color: "#1A1206", fontSize: 13, fontWeight: "800", letterSpacing: 1 },

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
  eRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, paddingHorizontal: 6, marginHorizontal: -6, borderRadius: radius.sm, borderCurve: "continuous" },
  eDate: { width: 26, height: 26, borderRadius: 8, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  empty: { color: colors.textDim, fontSize: 12, fontStyle: "italic" },
  itemHover: { backgroundColor: colors.surface },
  itemPressed: { transform: [{ scale: 0.98 }], opacity: 0.88 },
  rowHover: { backgroundColor: colors.surfaceAlt },
  rowPressed: { backgroundColor: colors.bgElev, transform: [{ scale: 0.985 }] },
});
