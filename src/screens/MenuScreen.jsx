import { View, Text, StyleSheet, ScrollView, Pressable, useWindowDimensions } from "react-native";
import { colors, displayFont, focusRing, font, mono, radius, shadow, space, THEMES, themeKey } from "../theme";
import ThemeSwatch, { themeGridStyle } from "../components/ThemeSwatch";
import { useStore } from "../store";
import { JOURNEY_TAGLINE, journeyMenuModel } from "../domain/menuJourney.mjs";
import ScreenHeader from "../components/ScreenHeader";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";

const ACCENTS = {
  good: colors.good,
  cool: colors.cool,
  magenta: colors.magenta,
  gold: colors.gold,
  amber: colors.amber,
};

function SectionHeading({ eyebrow, title, detail }) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionEyebrow}>{eyebrow}</Text>
      <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
      {!!detail && <Text style={styles.sectionDetail}>{detail}</Text>}
    </View>
  );
}

function JourneyTile({ item, onPress, narrow }) {
  const accent = ACCENTS[item.accent] || colors.amber;
  return (
    <Pressable
      style={({ pressed, focused }) => [
        styles.tile,
        narrow && styles.tileNarrow,
        { borderTopColor: accent },
        pressed && styles.pressed,
        focused && focusRing,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${item.detail}`}
      accessibilityHint={`Open ${item.title}`}
    >
      <View style={[styles.tileIcon, { backgroundColor: `${accent}18`, borderColor: `${accent}42` }]}>
        <Icon name={item.icon} size={20} color={accent} strokeWidth={2.2} />
      </View>
      <View style={styles.tileCopy}>
        <Text style={styles.tileTitle}>{item.title}</Text>
        <Text style={styles.tileDetail}>{item.detail}</Text>
      </View>
      <View style={styles.tileArrow}>
        <Icon name="chevron-right" size={17} color={accent} />
      </View>
    </Pressable>
  );
}

function ListRow({ item, onPress, last = false, danger = false }) {
  return (
    <Pressable
      style={({ pressed, focused }) => [
        styles.listRow,
        !last && styles.listRowBorder,
        pressed && styles.listRowPressed,
        focused && focusRing,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}${item.detail ? `. ${item.detail}` : ""}`}
      accessibilityHint={`Open ${item.title}`}
    >
      <View style={[styles.listIcon, danger && styles.listIconDanger]}>
        <Icon name={item.icon} size={18} color={danger ? colors.danger : colors.amber} />
      </View>
      <View style={styles.listCopy}>
        <Text style={[styles.listTitle, danger && styles.dangerText]}>{item.title}</Text>
        {!!item.detail && <Text style={styles.listDetail}>{item.detail}</Text>}
      </View>
      {!!item.badge && (
        <View style={styles.badge} accessibilityLabel={item.key === "activity" ? `${item.badge} new activities` : `${item.badge} unread messages`}>
          <Text style={styles.badgeText}>{item.badge > 99 ? "99+" : item.badge}</Text>
        </View>
      )}
      {!danger && <Icon name="chevron-right" size={17} color={colors.textFaint} />}
    </Pressable>
  );
}

function ListGroup({ items, actions }) {
  return (
    <View style={styles.listGroup}>
      {items.map((item, index) => (
        <ListRow key={item.key} item={item} onPress={actions[item.key]} last={index === items.length - 1} />
      ))}
    </View>
  );
}

function JourneyHero({ session, onProfile, onLogin, wide }) {
  return (
    <View style={[styles.hero, wide && styles.heroWide]}>
      <View pointerEvents="none" style={styles.heroGlow} />
      {wide && (
        <View pointerEvents="none" style={styles.recordArt}>
          <View style={styles.recordOuter}>
            <View style={styles.recordGroove}>
              <View style={styles.recordLabel}><Icon name="music" size={18} color={colors.bg} strokeWidth={2.4} /></View>
            </View>
          </View>
        </View>
      )}

      <View style={styles.heroCopy}>
        <Text style={styles.heroEyebrow}>PIT · YOUR STORY IN SOUND</Text>
        <Text style={styles.heroTitle} accessibilityRole="header" selectable>{JOURNEY_TAGLINE}</Text>
        <Text style={styles.heroBody} selectable>
          Revisit the nights that shaped you, stay close to your music community, and find the room worth showing up for next.
        </Text>
      </View>

      {session ? (
        <Pressable
          style={({ pressed, focused }) => [styles.profileButton, pressed && styles.pressed, focused && focusRing]}
          onPress={onProfile}
          accessibilityRole="button"
          accessibilityLabel={`View ${session.name}'s journey and profile`}
        >
          <Avatar user={session} size={46} />
          <View style={styles.profileCopy}>
            <Text style={styles.profileKicker}>YOUR PROFILE</Text>
            <Text style={styles.profileName} numberOfLines={1}>{session.name}</Text>
            <Text style={styles.profileHandle} numberOfLines={1}>@{session.handle}</Text>
          </View>
          <Icon name="chevron-right" size={18} color={colors.amber} />
        </Pressable>
      ) : (
        <Pressable
          style={({ pressed, focused }) => [styles.loginButton, pressed && styles.pressed, focused && focusRing]}
          onPress={onLogin}
          accessibilityRole="button"
          accessibilityLabel="Log in or sign up to start your musical journey"
        >
          <Text style={styles.loginText}>Start your journey</Text>
          <Icon name="chevron-right" size={18} color="#1A1206" />
        </Pressable>
      )}
    </View>
  );
}

export default function MenuScreen({ onClose, onNear, onVenues, onFanClubs, onTopRated, onInbox, onActivity, onProfile, onEditProfile, onAdmin, onTourDates, onRequestArtist, onLogin, onLogout, onBackToLanding }) {
  const { width } = useWindowDimensions();
  const wide = width >= 920;
  const narrow = width < 560;
  const { session, inboxUnread, unreadNotifications, chooseTheme } = useStore();
  const model = journeyMenuModel({
    session,
    inboxUnread: session ? inboxUnread() : 0,
    notifications: session ? unreadNotifications() : 0,
    includeActivity: !!onActivity,
  });
  const actions = {
    near: onNear,
    venues: onVenues,
    fanClubs: onFanClubs,
    topRated: onTopRated,
    activity: onActivity,
    inbox: onInbox,
    editProfile: onEditProfile,
    admin: onAdmin,
    tourDates: onTourDates,
    requestArtist: onRequestArtist,
  };

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="MENU" title="Your journey" onBack={onClose} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.shell}>
          <JourneyHero session={session} onProfile={onProfile} onLogin={onLogin} wide={wide} />

          <View style={[styles.columns, wide && styles.columnsWide]}>
            <View style={styles.primaryColumn}>
              <SectionHeading
                eyebrow="DISCOVER"
                title="Find your next night"
                detail="Follow the sound from your city to the crowd favorites everyone is talking about."
              />
              <View style={styles.tileGrid}>
                {model.discover.map((item) => (
                  <JourneyTile key={item.key} item={item} onPress={actions[item.key]} narrow={narrow} />
                ))}
              </View>
            </View>

            <View style={[styles.sideColumn, wide && styles.sideColumnWide]}>
              <View style={styles.sideSection}>
                <SectionHeading eyebrow="CONNECTIONS" title="Stay in the loop" />
                <ListGroup items={model.connection} actions={actions} />
              </View>

              {session ? (
                <View style={styles.sideSection}>
                  <SectionHeading eyebrow="ACCOUNT" title="Make Pit yours" />
                  <ListGroup items={model.account} actions={actions} />
                  <View style={styles.logoutWrap}>
                    <ListRow item={{ icon: "logout", title: "Log out" }} onPress={onLogout} last danger />
                  </View>
                </View>
              ) : (
                <>
                  <View style={styles.sideSection}>
                    <SectionHeading eyebrow="APPEARANCE" title="Set the mood" detail="Your theme applies across Pit. Log in to save it to your account." />
                    <View style={styles.themePanel}>
                      <View style={styles.themeGrid}>
                        {THEMES.map((theme) => (
                          <ThemeSwatch key={theme.key} theme={theme} active={theme.key === themeKey} onPress={() => chooseTheme(theme.key)} />
                        ))}
                      </View>
                    </View>
                  </View>
                  {!!onBackToLanding && (
                    <View style={styles.sideSection}>
                      <ListGroup
                        items={[{ key: "welcome", icon: "chevron-left", title: "Welcome screen", detail: "Return to Pit's opening page" }]}
                        actions={{ welcome: onBackToLanding }}
                      />
                    </View>
                  )}
                </>
              )}
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { alignItems: "center", paddingHorizontal: space(4), paddingTop: space(3), paddingBottom: space(14) },
  shell: { width: "100%", maxWidth: 1120, gap: space(8) },
  hero: {
    position: "relative", overflow: "hidden", gap: space(5),
    minHeight: 250, padding: space(6), borderRadius: radius.lg, borderCurve: "continuous",
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft,
    ...shadow.card,
  },
  heroWide: { minHeight: 290, justifyContent: "space-between", padding: space(8) },
  heroGlow: {
    position: "absolute", width: 340, height: 340, borderRadius: 170,
    right: -110, top: -170, backgroundColor: `${colors.amber}12`,
  },
  recordArt: { position: "absolute", right: 86, top: 34, opacity: 0.74 },
  recordOuter: {
    width: 184, height: 184, borderRadius: 92, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line,
    boxShadow: "0 22px 45px rgba(0,0,0,0.28)",
  },
  recordGroove: { width: 132, height: 132, borderRadius: 66, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  recordLabel: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.amber, alignItems: "center", justifyContent: "center" },
  heroCopy: { maxWidth: 560, gap: space(2) },
  heroEyebrow: { color: colors.amber, fontFamily: mono, fontSize: 10, fontWeight: "800", letterSpacing: 1.8 },
  heroTitle: { color: colors.text, fontFamily: displayFont, fontSize: 34, lineHeight: 39, fontWeight: "900", letterSpacing: -1.15 },
  heroBody: { color: colors.textDim, fontFamily: font, fontSize: 15, lineHeight: 23, maxWidth: 530 },
  profileButton: {
    alignSelf: "flex-start", minHeight: 64, width: "100%", maxWidth: 310,
    flexDirection: "row", alignItems: "center", gap: space(3), paddingHorizontal: space(3), paddingVertical: space(2.5),
    borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line,
  },
  profileCopy: { flex: 1, minWidth: 0 },
  profileKicker: { color: colors.amber, fontFamily: mono, fontSize: 9, fontWeight: "800", letterSpacing: 1.3 },
  profileName: { color: colors.text, fontFamily: displayFont, fontSize: 15, fontWeight: "800", paddingTop: 1 },
  profileHandle: { color: colors.textDim, fontSize: 11, paddingTop: 1 },
  loginButton: {
    alignSelf: "flex-start", minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space(2),
    paddingHorizontal: space(5), borderRadius: radius.pill, backgroundColor: colors.amberStrong, ...shadow.control,
  },
  loginText: { color: "#1A1206", fontSize: 14, fontWeight: "900" },
  columns: { gap: space(8) },
  columnsWide: { flexDirection: "row", alignItems: "flex-start" },
  primaryColumn: { flex: 1, minWidth: 0, gap: space(4) },
  sideColumn: { gap: space(7) },
  sideColumnWide: { width: 350 },
  sideSection: { gap: space(3) },
  sectionHeading: { gap: space(1), maxWidth: 650 },
  sectionEyebrow: { color: colors.textFaint, fontFamily: mono, fontSize: 10, fontWeight: "800", letterSpacing: 1.55 },
  sectionTitle: { color: colors.text, fontFamily: displayFont, fontSize: 22, lineHeight: 27, fontWeight: "800", letterSpacing: -0.4 },
  sectionDetail: { color: colors.textDim, fontFamily: font, fontSize: 13, lineHeight: 19, maxWidth: 570 },
  tileGrid: { flexDirection: "row", flexWrap: "wrap", gap: space(3) },
  tile: {
    flexGrow: 1, flexBasis: "46%", minWidth: 220, minHeight: 154, justifyContent: "space-between", gap: space(3),
    padding: space(4), borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surface,
    borderWidth: 1, borderTopWidth: 3, borderColor: colors.lineSoft, ...shadow.card,
  },
  tileNarrow: { minWidth: 145, minHeight: 146, padding: space(3.5) },
  tileIcon: { width: 42, height: 42, borderRadius: radius.sm, borderCurve: "continuous", alignItems: "center", justifyContent: "center", borderWidth: 1 },
  tileCopy: { gap: space(1), paddingRight: space(5) },
  tileTitle: { color: colors.text, fontFamily: displayFont, fontSize: 16, fontWeight: "800", letterSpacing: -0.2 },
  tileDetail: { color: colors.textDim, fontFamily: font, fontSize: 12, lineHeight: 17 },
  tileArrow: { position: "absolute", right: space(3), bottom: space(3), width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  listGroup: { overflow: "hidden", backgroundColor: colors.surface, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, ...shadow.card },
  listRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: space(3), paddingHorizontal: space(3), paddingVertical: space(2.5) },
  listRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  listRowPressed: { backgroundColor: colors.surfaceAlt },
  listIcon: { width: 38, height: 38, borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: colors.bgElev, alignItems: "center", justifyContent: "center" },
  listIconDanger: { backgroundColor: `${colors.danger}12` },
  listCopy: { flex: 1, minWidth: 0 },
  listTitle: { color: colors.text, fontFamily: displayFont, fontSize: 14, fontWeight: "800" },
  listDetail: { color: colors.textDim, fontSize: 11, lineHeight: 16, paddingTop: 2 },
  badge: { minWidth: 23, height: 23, paddingHorizontal: 6, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.amber },
  badgeText: { color: "#1A1206", fontFamily: mono, fontSize: 10, fontWeight: "900", fontVariant: ["tabular-nums"] },
  themePanel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.md, borderCurve: "continuous", padding: space(3), ...shadow.card },
  themeGrid: themeGridStyle,
  logoutWrap: { paddingTop: space(2) },
  dangerText: { color: colors.danger },
  pressed: { opacity: 0.82, transform: [{ scale: 0.992 }] },
});
