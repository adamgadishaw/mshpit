import { useState, useRef, useEffect } from "react";
import { View, Text, StyleSheet, Pressable, SafeAreaView, Platform, StatusBar as RNStatusBar, Animated, useWindowDimensions } from "react-native";
import { StatusBar } from "expo-status-bar";
import "./src/lib/safeArea"; // reserves iOS notch / toolbar safe areas (web)
import "./src/lib/webInputFix"; // strips the harsh browser focus box from inputs (web)
import { colors, mono, radius } from "./src/theme";
import { StoreProvider, useStore, isStaff } from "./src/store";
import Icon from "./src/components/Icon";
import Avatar from "./src/components/Avatar";
import ErrorBoundary from "./src/components/ErrorBoundary";
import { LeftRail, RightRail } from "./src/components/Rails";
import FeedScreen from "./src/screens/FeedScreen";
import SearchScreen from "./src/screens/SearchScreen";
import DiscoverScreen from "./src/screens/DiscoverScreen";
import YouScreen from "./src/screens/YouScreen";
import ShowScreen from "./src/screens/ShowScreen";
import LoungeScreen from "./src/screens/LoungeScreen";
import InboxScreen from "./src/screens/InboxScreen";
import ThreadScreen from "./src/screens/ThreadScreen";
import VenueReviewScreen from "./src/screens/VenueReviewScreen";
import FanClubScreen from "./src/screens/FanClubScreen";
import AccountGate from "./src/screens/AccountGate";
import MenuScreen from "./src/screens/MenuScreen";
import PhotoViewer from "./src/components/PhotoViewer";
import LogScreen from "./src/screens/LogScreen";
import TopRatedScreen from "./src/screens/TopRatedScreen";
import AuthScreen from "./src/screens/AuthScreen";
import AdminScreen from "./src/screens/AdminScreen";
import BulkTourDatesScreen from "./src/screens/BulkTourDatesScreen";
import RequestArtistScreen from "./src/screens/RequestArtistScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import EditProfileScreen from "./src/screens/EditProfileScreen";
import ReportScreen from "./src/screens/ReportScreen";
import ArtistScreen from "./src/screens/ArtistScreen";
import EditArtistProfileScreen from "./src/screens/EditArtistProfileScreen";
import VenueScreen from "./src/screens/VenueScreen";
import VenuesScreen from "./src/screens/VenuesScreen";
import PickArtistsScreen from "./src/screens/PickArtistsScreen";
import FanClubsScreen from "./src/screens/FanClubsScreen";
import NearbyScreen from "./src/screens/NearbyScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import PrivacyScreen from "./src/screens/PrivacyScreen";
import TermsScreen from "./src/screens/TermsScreen";
import AccountMenu from "./src/components/AccountMenu";
import LandingScreen from "./src/screens/LandingScreen";
import { load, save } from "./src/lib/persist";

const LEFT = [
  { key: "feed", label: "Feed", icon: "feed" },
  { key: "search", label: "Search", icon: "search" },
];
const RIGHT = [
  { key: "discover", label: "Discover", icon: "discover" },
  { key: "you", label: "You", icon: "you" },
];

export default function App() {
  return (
    <ErrorBoundary>
      <StoreProvider>
        <Root />
      </StoreProvider>
    </ErrorBoundary>
  );
}

function Root() {
  const { session, addLog, visibleFeed, followingFeed, localFeed, logout, userByHandle, inboxUnread, accountStatus } = useStore();
  const staff = isStaff(session?.role);
  const feed = visibleFeed(staff);
  const following = followingFeed(staff);
  const local = localFeed(staff);

  const { width } = useWindowDimensions();
  // Only true desktops get the 3-column shell. Below this (tablets, landscape
  // phones, split-screen, narrow windows) use the single-column mobile layout —
  // it's fluid and clean, whereas the 3-column shell squishes and misaligns.
  const wide = Platform.OS === "web" && width >= 1150; // desktop 3-column layout

  const [tab, setTab] = useState("feed");
  const [nav, setNav] = useState({}); // { openLog, logging, prefill, topRated, auth, admin, bulk, reqArtist, profileId, editProfile, reporting }
  const [preview, setPreview] = useState(null);
  const [acctOpen, setAcctOpen] = useState(false);
  // The concert opening screen: fresh visitors (and anyone who logs out) see it;
  // "browse as guest" or logging in dismisses it. Guest choice persists.
  const [landing, setLanding] = useState(() => !load("pit.session", null) && !load("pit.entered", false));
  const enter = () => {
    setLanding(false);
    save("pit.entered", true);
    // Give the browser back button somewhere to go: entering as a guest pushes a
    // history entry, so Back returns to the landing instead of leaving the site.
    if (Platform.OS === "web" && typeof window !== "undefined") {
      try { window.history.pushState({ pit: "app" }, ""); } catch {}
    }
  };
  const exitToLanding = () => { save("pit.entered", false); setLanding(true); };

  // Browser back → landing (guests only; logged-in users are never bounced).
  // Show the landing without persisting the choice: if the popstate came from
  // something other than a real Back press (HMR, tooling), a reload still puts
  // the guest back in the app instead of locking them out.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onPop = () => { if (!sessionRef.current) setLanding(true); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const fade = useRef(new Animated.Value(0)).current;
  const previewTimer = useRef(null);

  const set = (patch) => setNav((n) => ({ ...n, ...patch }));
  const clear = () => setNav({});

  const showPreview = (song, artist) => {
    setPreview({ song, artist });
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: false }).start();
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: 220, useNativeDriver: false }).start(() => setPreview(null));
    }, 3200);
  };

  const requireAuth = (fn) => (session ? fn() : set({ auth: true }));

  const onAddLog = (log) => {
    addLog(log);
    clear();
    setTab("feed");
  };

  const openProfile = (id) => set({ profileId: id, thread: null, inbox: null });
  const openProfileByHandle = (h) => { const u = userByHandle(h); if (u) openProfile(u.id); };
  const openShow = (log) => set({ openLog: log, profileId: null, artistName: null });
  const openArtist = (name) => set({ artistName: name, venueName: null, openLog: null, profileId: null });
  const openVenue = (name) => set({ venueName: name, artistName: null, openLog: null, profileId: null });
  const openFanClub = (artist) => set({ fanClub: artist });
  const openPhotos = (images, index = 0) => set({ photos: { images, index } });
  const reviewShow = (log) => requireAuth(() => set({ logging: true, prefill: { artist: log.artist, venue: log.venue, city: log.city } }));
  const openInbox = () => requireAuth(() => set({ inbox: true, thread: null }));
  const openThread = (otherId) => requireAuth(() => set({ thread: otherId, inbox: null, profileId: null }));
  const openVenueReview = (name) => requireAuth(() => set({ venueReview: name }));

  let overlay = null;
  // Auth is a modal that must win over any page overlay — requireAuth() can fire
  // from inside a venue/show/profile page, and the login sheet has to surface.
  if (nav.photos) overlay = <PhotoViewer photos={nav.photos.images} index={nav.photos.index} onClose={() => set({ photos: null })} />;
  else if (nav.auth) overlay = <AuthScreen initialMode={nav.authMode} onDone={(mode) => set({ auth: false, authMode: null, pickArtists: mode === "signup" })} onCancel={() => set({ auth: false, authMode: null })} />;
  else if (nav.pickArtists) overlay = <PickArtistsScreen onDone={clear} onSkip={clear} />;
  else if (nav.logging) overlay = <LogScreen user={session} prefill={nav.prefill} onPost={onAddLog} onCancel={clear} />;
  else if (nav.reporting) overlay = <ReportScreen log={nav.reporting} onClose={clear} />;
  else if (nav.editProfile) overlay = <EditProfileScreen onClose={() => set({ editProfile: false })} onPickArtists={() => set({ editProfile: false, pickArtists: true })} />;
  else if (nav.venueReview) overlay = <VenueReviewScreen venueName={nav.venueReview} onClose={() => set({ venueReview: null, venueName: nav.venueReview })} />;
  else if (nav.thread) overlay = <ThreadScreen otherId={nav.thread} onClose={openInbox} onOpenProfile={openProfile} onOpenProfileByHandle={openProfileByHandle} />;
  else if (nav.inbox) overlay = <InboxScreen onClose={clear} onOpenThread={openThread} />;
  else if (nav.profileId) overlay = <ProfileScreen userId={nav.profileId} onClose={clear} onOpenShow={openShow} onOpenArtist={openArtist} onOpenVenue={openVenue} onEditProfile={() => set({ editProfile: true })} onPreview={showPreview} onMessage={openThread} onReport={(log) => requireAuth(() => set({ reporting: log }))} />;
  else if (nav.fanClub) overlay = <FanClubScreen artist={nav.fanClub} onClose={() => set({ fanClub: null })} onOpenProfile={openProfile} onOpenProfileByHandle={openProfileByHandle} />;
  else if (nav.editArtist) overlay = <EditArtistProfileScreen artistName={nav.editArtist} onClose={() => set({ editArtist: null, artistName: nav.editArtist })} />;
  else if (nav.artistName) overlay = <ArtistScreen artistName={nav.artistName} onClose={clear} onOpenShow={openShow} onOpenVenue={openVenue} onOpenFanClub={openFanClub} onOpenPhotos={openPhotos} onEditArtist={(name) => set({ editArtist: name })} />;
  else if (nav.venueName) overlay = <VenueScreen venueName={nav.venueName} onClose={clear} onOpenShow={openShow} onOpenArtist={openArtist} onOpenVenue={openVenue} onReviewVenue={openVenueReview} onOpenProfile={openProfile} onOpenPhotos={openPhotos} />;
  else if (nav.nearby) overlay = <NearbyScreen onClose={clear} onOpenVenue={openVenue} onOpenArtist={openArtist} />;
  else if (nav.venues) overlay = <VenuesScreen onClose={clear} onOpenVenue={openVenue} />;
  else if (nav.fanClubs) overlay = <FanClubsScreen onClose={clear} onOpenFanClub={openFanClub} />;
  else if (nav.settings) overlay = <SettingsScreen onClose={clear} onEditProfile={() => set({ editProfile: true, settings: false })} onOpenProfile={() => (session ? set({ profileId: session.id, settings: false }) : set({ auth: true }))} onOpenPrivacy={() => set({ privacy: true, settings: false })} onOpenTerms={() => set({ terms: true, settings: false })} onLogout={() => { logout(); clear(); exitToLanding(); }} />;
  else if (nav.privacy) overlay = <PrivacyScreen onClose={clear} />;
  else if (nav.terms) overlay = <TermsScreen onClose={clear} />;
  else if (nav.lounge) overlay = <LoungeScreen log={nav.lounge} onClose={() => set({ lounge: null, openLog: nav.lounge })} onOpenProfile={openProfile} onOpenProfileByHandle={openProfileByHandle} />;
  else if (nav.openLog) overlay = <ShowScreen log={nav.openLog} onClose={clear} onPreview={showPreview} onReview={reviewShow} onOpenProfile={openProfile} onOpenArtist={openArtist} onOpenVenue={openVenue} onOpenLounge={(log) => set({ lounge: log })} onRequireAuth={() => set({ auth: true })} />;
  else if (nav.topRated) overlay = <TopRatedScreen onClose={clear} onOpen={openShow} />;
  else if (nav.admin) overlay = <AdminScreen onClose={clear} />;
  else if (nav.bulk) overlay = <BulkTourDatesScreen onClose={clear} />;
  else if (nav.reqArtist) overlay = <RequestArtistScreen onClose={clear} />;
  else if (nav.menu) overlay = (
    <MenuScreen
      onClose={clear}
      onNear={() => requireAuth(() => set({ nearby: true, menu: null }))}
      onVenues={() => set({ venues: true, menu: null })}
      onFanClubs={() => set({ fanClubs: true, menu: null })}
      onTopRated={() => set({ topRated: true, menu: null })}
      onInbox={() => requireAuth(() => set({ inbox: true, menu: null }))}
      onProfile={() => session && set({ profileId: session.id, menu: null })}
      onEditProfile={() => set({ editProfile: true, menu: null })}
      onAdmin={() => set({ admin: true, menu: null })}
      onTourDates={() => set({ bulk: true, menu: null })}
      onRequestArtist={() => set({ reqArtist: true, menu: null })}
      onLogin={() => set({ auth: true, menu: null })}
      onLogout={() => { logout(); clear(); exitToLanding(); }}
      onBackToLanding={() => { clear(); exitToLanding(); }}
    />
  );

  const status = session ? accountStatus(session) : "ok";

  const tabScreens = (
            <View style={styles.screen}>
              {tab === "feed" && (
                <FeedScreen
                  feed={feed}
                  followingFeed={following}
                  localFeed={local}
                  loggedIn={!!session}
                  homeCity={session?.home?.city}
                  unread={inboxUnread()}
                  onOpenInbox={openInbox}
                  onOpen={openShow}
                  onPreview={showPreview}
                  onOpenProfile={openProfile}
                  onOpenArtist={openArtist}
                  onOpenVenue={openVenue}
                  onOpenNearby={() => requireAuth(() => set({ nearby: true }))}
                  onOpenMenu={() => set({ menu: true })}
                  onReport={(log) => requireAuth(() => set({ reporting: log }))}
                />
              )}
              {tab === "search" && <SearchScreen onOpen={openShow} onOpenArtist={openArtist} onOpenVenue={openVenue} onOpenFanClub={openFanClub} />}
              {tab === "discover" && <DiscoverScreen onOpenTopRated={() => set({ topRated: true })} onOpen={openShow} onOpenArtist={openArtist} onOpenNearby={() => requireAuth(() => set({ nearby: true }))} />}
              {tab === "you" && (
                <YouScreen
                  feed={feed}
                  onLogin={() => set({ auth: true })}
                  onLogout={() => { logout(); exitToLanding(); }}
                  onAdmin={() => set({ admin: true })}
                  onAddTourDate={() => set({ bulk: true })}
                  onRequestArtist={() => set({ reqArtist: true })}
                  onEditProfile={() => set({ editProfile: true })}
                  onOpenProfile={openProfile}
                  onOpen={openShow}
                />
              )}
            </View>
  );

  // Desktop (wide web): a top bar (brand + account) over a left nav rail, a wide
  // centered content column, and a right sidebar.
  const desktop = (
    <View style={styles.deskOuter}>
      <View style={styles.topbar}>
        <Pressable onPress={() => { setTab("feed"); clear(); }}><Text style={styles.topBrand}>PIT</Text></Pressable>
        <View style={{ flex: 1 }} />
        {session ? (
          <Pressable style={styles.acctChip} onPress={() => setAcctOpen(true)}>
            <Avatar user={session} size={30} />
            <View style={{ maxWidth: 150 }}>
              <Text style={styles.acctName} numberOfLines={1}>{session.name}</Text>
              <Text style={styles.acctSub} numberOfLines={1}>@{session.handle}</Text>
            </View>
            <Icon name="chevron-down" size={16} color={colors.textDim} />
          </Pressable>
        ) : (
          <View style={styles.authBtns}>
            <Pressable style={styles.introBtn} onPress={() => { clear(); exitToLanding(); }} hitSlop={6}>
              <Icon name="chevron-left" size={15} color={colors.textDim} />
              <Text style={styles.introBtnTxt}>Intro</Text>
            </Pressable>
            <Pressable style={styles.loginPill} onPress={() => set({ auth: true, authMode: "login" })}>
              <Text style={styles.loginPillTxt}>Log in</Text>
            </Pressable>
            <Pressable style={styles.signupPill} onPress={() => set({ auth: true, authMode: "signup" })}>
              <Text style={styles.signupPillTxt}>Sign up</Text>
            </Pressable>
          </View>
        )}
      </View>
      <View style={styles.deskWrap}>
        <LeftRail
          tab={tab}
          setTab={(k) => { setTab(k); clear(); }}
          session={session}
          unread={session ? inboxUnread() : 0}
          onLog={() => requireAuth(() => setNav({ logging: true }))}
          onFindVenues={() => setNav({ venues: true })}
          onFanClubs={() => setNav({ fanClubs: true })}
          onNearby={() => requireAuth(() => setNav({ nearby: true }))}
          onTopRated={() => setNav({ topRated: true })}
          onInbox={openInbox}
          onProfile={() => (session ? openProfile(session.id) : set({ auth: true }))}
          onLogin={() => set({ auth: true })}
        />
        <View style={styles.deskCenter}>{overlay || tabScreens}</View>
        <RightRail onOpenArtist={openArtist} onOpenVenue={openVenue} onFindVenues={() => setNav({ venues: true })} onOpenEvent={(t) => openArtist(t.artist)} />
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />

        {landing && !session ? (
          <LandingScreen
            onLogin={() => { enter(); set({ auth: true, authMode: "login" }); }}
            onSignup={() => { enter(); set({ auth: true, authMode: "signup" }); }}
            onBrowse={enter}
          />
        ) : status !== "ok" ? (
          <AccountGate status={status} until={session?.suspendedUntil} onLogout={logout} />
        ) : wide ? (
          desktop
        ) : (
          overlay || (
          <>
            {tabScreens}

            <View style={styles.tabbar}>
              {LEFT.map((t) => <TabButton key={t.key} tab={t} active={tab} onPress={setTab} />)}
              <View style={styles.fabCol}>
                <Pressable style={styles.fab} onPress={() => requireAuth(() => set({ logging: true }))} accessibilityLabel="Make a post">
                  <Icon name="plus" size={26} color="#1A1206" strokeWidth={2.6} />
                </Pressable>
                <Text style={styles.fabLabel}>Post</Text>
              </View>
              {RIGHT.map((t) => <TabButton key={t.key} tab={t} active={tab} onPress={setTab} />)}
            </View>
          </>
          )
        )}

        {status === "ok" && preview && (
          <Animated.View style={[styles.preview, { opacity: fade }]}>
            <View style={styles.previewIcon}>
              <Icon name="play" size={14} color={colors.amber} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.previewSong} numberOfLines={1}>{preview.song}</Text>
              <Text style={styles.previewMeta}>{preview.artist} · 30s preview</Text>
            </View>
          </Animated.View>
        )}

        <AccountMenu
          visible={acctOpen}
          user={session}
          onClose={() => setAcctOpen(false)}
          items={[
            { icon: "you", label: "Go to profile", onPress: () => { setAcctOpen(false); session && openProfile(session.id); } },
            { icon: "edit", label: "Edit profile", onPress: () => { setAcctOpen(false); set({ editProfile: true }); } },
            { icon: "menu", label: "Settings", onPress: () => { setAcctOpen(false); set({ settings: true }); } },
            { icon: "lock", label: "Privacy", onPress: () => { setAcctOpen(false); set({ privacy: true }); } },
            { icon: "shield", label: "Terms & conditions", onPress: () => { setAcctOpen(false); set({ terms: true }); } },
            { divider: true },
            { icon: "logout", label: "Log out", danger: true, onPress: () => { setAcctOpen(false); logout(); clear(); exitToLanding(); } },
          ]}
        />
      </SafeAreaView>
    </View>
  );
}

function TabButton({ tab, active, onPress }) {
  const on = active === tab.key;
  return (
    <Pressable style={styles.tab} onPress={() => onPress(tab.key)}>
      <Icon name={tab.icon} size={22} color={on ? colors.amber : colors.textDim} />
      <Text style={[styles.tabLabel, on && { color: colors.amber }]}>{tab.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1, backgroundColor: colors.bg, paddingTop: Platform.OS === "android" ? RNStatusBar.currentHeight : 0 },
  screen: { flex: 1 },
  // desktop 3-column shell — a top bar over fixed rails framing a wide, centered
  // content column. Widths sum to deskOuter.maxWidth so there are no dead gaps.
  deskOuter: { flex: 1, width: "100%", maxWidth: 1520, alignSelf: "center", borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.lineSoft },
  topbar: { flexDirection: "row", alignItems: "center", height: 58, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: colors.lineSoft, backgroundColor: colors.bgElev },
  topBrand: { color: colors.amber, fontSize: 22, fontWeight: "900", letterSpacing: 3 },
  acctChip: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, paddingLeft: 6, paddingRight: 12, paddingVertical: 5 },
  acctName: { color: colors.text, fontSize: 13, fontWeight: "800" },
  acctSub: { color: colors.textDim, fontSize: 11 },
  authBtns: { flexDirection: "row", alignItems: "center", gap: 10 },
  introBtn: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 10, paddingVertical: 9, borderRadius: radius.pill },
  introBtnTxt: { color: colors.textDim, fontSize: 14, fontWeight: "600" },
  loginPill: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  loginPillTxt: { color: colors.text, fontSize: 14, fontWeight: "700" },
  signupPill: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.amberStrong },
  signupPillTxt: { color: "#1A1206", fontSize: 14, fontWeight: "800" },
  deskWrap: { flex: 1, flexDirection: "row", width: "100%" },
  deskCenter: { flex: 1, maxWidth: 980, borderRightWidth: 1, borderRightColor: colors.lineSoft },
  tabbar: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderTopWidth: 1,
    borderTopColor: colors.lineSoft,
    backgroundColor: colors.bgElev,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 24 : 12,
  },
  tab: { flex: 1, alignItems: "center", gap: 4 },
  tabLabel: { color: colors.textDim, fontSize: 10, letterSpacing: 0.3 },
  fabCol: { flex: 1, alignItems: "center" },
  fab: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.amberStrong,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -22,
    shadowColor: colors.amberStrong,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabLabel: { color: colors.amber, fontSize: 10, marginTop: 4, letterSpacing: 0.3 },

  preview: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: Platform.OS === "ios" ? 96 : 84,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
  },
  previewIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.amber, alignItems: "center", justifyContent: "center", paddingLeft: 2 },
  previewSong: { color: colors.text, fontSize: 14, fontWeight: "600" },
  previewMeta: { color: colors.textDim, fontFamily: mono, fontSize: 11, marginTop: 2 },
});
