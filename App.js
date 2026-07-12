import { useState, useRef, useEffect } from "react";
import { View, Text, StyleSheet, Pressable, SafeAreaView, Platform, StatusBar as RNStatusBar, Animated, useWindowDimensions, BackHandler } from "react-native";
import { StatusBar } from "expo-status-bar";
import "./src/lib/safeArea"; // reserves iOS notch / toolbar safe areas (web)
import "./src/lib/webInputFix"; // strips the harsh browser focus box from inputs (web)
import { colors, mono, radius, roleColor } from "./src/theme";
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
import NotificationsScreen from "./src/screens/NotificationsScreen";
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
import PlayerBar from "./src/components/PlayerBar";
import PlaylistPickerScreen from "./src/screens/PlaylistPickerScreen";
import PostScreen from "./src/screens/PostScreen";
import ResetPasswordScreen from "./src/screens/ResetPasswordScreen";
import BadgeLegendScreen from "./src/screens/BadgeLegendScreen";
import WelcomeScreen from "./src/screens/WelcomeScreen";
import FollowListScreen from "./src/screens/FollowListScreen";
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
  const { session, addLog, visibleFeed, followingFeed, localFeed, logout, userByHandle, searchPeople, inboxUnread, accountStatus, track, unreadNotifications, recordPlay, playHistory, saveSnapshot, autoplayQueue, followingCount, spotifyNotice, dismissSpotifyNotice } = useStore();
  const staff = isStaff(session?.role);
  const feed = visibleFeed(staff);
  const following = followingFeed(staff);
  const local = localFeed(staff);

  const { width } = useWindowDimensions();
  // Only true desktops get the 3-column shell. Below this (tablets, landscape
  // phones, split-screen, narrow windows) use the single-column mobile layout —
  // it's fluid and clean, whereas the 3-column shell squishes and misaligns.
  const wide = Platform.OS === "web" && width >= 1150; // desktop 3-column layout

  const web = Platform.OS === "web" && typeof window !== "undefined";

  // Restore the last tab on reload so a refresh doesn't dump you back on the feed.
  const [tab, setTab] = useState(() => (web ? load("pit.tab", "feed") : "feed"));
  // Navigation is a STACK of frames. Each frame is one overlay screen, e.g.
  // { artistName } or { profileId }; the top frame is what's showing. An empty
  // base frame ({}) means "just the tab screens." Opening a screen PUSHES a
  // frame; Back POPS one — so you retrace your steps instead of always being
  // dumped back to the feed. (Before this, nav was a single flat object and
  // every close reset it to {}, which is why Back only ever went to the feed.)
  // The whole stack is PERSISTED, so a refresh restores the exact screen you were
  // on (and its back-stack) instead of flashing the feed then jumping around.
  const [stack, setStack] = useState(() => {
    if (!web) return [{}];
    const saved = load("pit.stack", null);
    if (!Array.isArray(saved) || !saved.length) return [{}];
    // Restore the exact screen you were on, but COLLAPSE the back-stack to a single
    // step. Before, a refresh resurrected the whole chain of pages you'd visited,
    // so Back walked through a string of half-remembered screens ("jumps to a
    // random back page"). Now: refresh lands you here; Back goes straight to the tab.
    const top = saved[saved.length - 1];
    return top && Object.keys(top).length ? [{}, top] : [{}];
  });
  const nav = stack[stack.length - 1];
  const stackRef = useRef(stack);
  stackRef.current = stack;

  const [preview, setPreview] = useState(null);
  // Persisted so the player survives a reload (switching themes reloads the page):
  // the bar comes back with its queue instead of vanishing mid-listen.
  const [player, setPlayer] = useState(() => (web ? load("pit.player", null) : null));
  useEffect(() => { if (web) save("pit.player", player); }, [player]);
  const [acctOpen, setAcctOpen] = useState(false);
  // First-run welcome (Spotify + find-your-people). Armed at signup, shown once the
  // taste picker is closed so it survives the theme reload PickArtists can trigger.
  const [welcome, setWelcome] = useState(false);
  // Password reset: if we arrived on an emailed ?reset=TOKEN link, show the set-new-
  // password screen over everything until it's completed or cancelled.
  const [resetToken, setResetToken] = useState(() => { try { return web ? new URLSearchParams(window.location.search).get("reset") : null; } catch { return null; } });
  const clearResetUrl = () => { try { if (web) window.history.replaceState({}, "", window.location.pathname); } catch {} setResetToken(null); };
  // The concert opening screen: fresh visitors (and anyone who logs out) see it;
  // "browse as guest" or logging in dismisses it. Guest choice persists.
  const [landing, setLanding] = useState(() => !load("pit.session", null) && !load("pit.entered", false));

  // Fire the welcome once signup's taste picker is closed (survives a theme reload
  // because the "pending" flag is on disk). Consume the flag so it shows only once.
  useEffect(() => {
    if (!web || !session?.id || !load("pit.welcomePending", false)) return;
    if (nav.pickArtists || nav.auth) return; // wait until the picker is gone
    save("pit.welcomePending", false);
    setWelcome(true);
    // Depend on the picker/auth booleans, not the whole nav object (which is a new
    // reference every render — that made this effect + a localStorage read fire on
    // every render, a real source of lag).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, !!nav.pickArtists, !!nav.auth]);

  // Push a fresh screen onto the stack. On web we mirror it into browser history
  // so the hardware/browser Back button pops the same stack the in-app back
  // buttons do (both funnel through popstate below).
  const go = (frame) => {
    setStack((s) => [...s, frame]);
    if (web) { try { window.history.pushState({ pit: "nav" }, ""); } catch {} }
  };
  // Swap the top screen without growing the stack — for lateral moves where the
  // previous screen shouldn't come back (menu → target, signup → pick-artists).
  const replace = (frame) => setStack((s) => [...s.slice(0, -1), frame]);
  const popStack = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  // Back one screen. On web, route through history.back() so the browser Back
  // button and in-app back share one code path (the popstate handler pops).
  const back = () => { if (web) { try { window.history.back(); return; } catch {} } popStack(); };
  // Jump straight to the tab screens (after posting, tab switches, brand tap).
  const clear = () => setStack([{}]);

  const enter = () => {
    setLanding(false);
    save("pit.entered", true);
    // Arm one history entry so browser Back from the app root returns to landing.
    if (web) { try { window.history.pushState({ pit: "app" }, ""); } catch {} }
  };
  const exitToLanding = () => { save("pit.entered", false); setTab("feed"); setStack([{}]); setLanding(true); };

  // Persist tab + nav stack so a reload lands exactly where you were.
  useEffect(() => { if (web) save("pit.tab", tab); }, [tab]);
  useEffect(() => { if (web) save("pit.stack", stack); }, [stack]);

  // Wire browser/hardware Back to the nav stack. If there's a screen to pop, pop
  // it; at the root, guests fall back to the landing and signed-in users are kept
  // in-app (re-arm a history entry so a stray Back never boots them off the site).
  const sessionRef = useRef(session);
  sessionRef.current = session;
  useEffect(() => {
    if (!web) return;
    // Arm a base history buffer so the very first Back press is caught here
    // rather than navigating away from the site — PLUS one entry per restored
    // overlay so browser/in-app Back pops the restored stack 1:1 (otherwise a
    // deep restored stack would send Back off the site on the first press).
    try {
      window.history.pushState({ pit: "base" }, "");
      for (let i = 0; i < stackRef.current.length - 1; i++) window.history.pushState({ pit: "nav" }, "");
    } catch {}
    const onPop = () => {
      if (stackRef.current.length > 1) popStack();
      else if (!sessionRef.current) setLanding(true);
      else { try { window.history.pushState({ pit: "root" }, ""); } catch {} }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Android hardware back: pop the stack when we have somewhere to go.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stackRef.current.length > 1) { popStack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, []);

  const fade = useRef(new Animated.Value(0)).current;
  const previewTimer = useRef(null);

  const showPreview = (song, artist) => {
    setPreview({ song, artist });
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: false }).start();
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: 220, useNativeDriver: false }).start(() => setPreview(null));
    }, 3200);
  };

  const requireAuth = (fn) => (session ? fn() : go({ auth: true }));

  const onAddLog = (log) => {
    addLog(log);
    clear();
    setTab("feed");
  };

  const openProfile = (id) => go({ profileId: id });
  const openProfileByHandle = async (h) => {
    const u = userByHandle(h);
    if (u) return openProfile(u.id);
    // Unknown handle (an @mention of someone this device never cached): look them
    // up on the server instead of silently doing nothing.
    const found = await searchPeople(h);
    const hit = (found || []).find((x) => x.handle === h);
    if (hit) openProfile(hit.id);
  };
  const openShow = (log) => { track("view_show", { artist: log?.artist, venue: log?.venue }); go({ openLog: log }); };
  const openPost = (log) => { if (log) go({ post: log }); };
  const openBadges = (userId) => go({ badges: { userId } });
  const openArtist = (name) => { track("view_artist", { artist: name }); go({ artistName: name }); };
  const openVenue = (name) => { track("view_venue", { venue: name }); go({ venueName: name }); };
  const openFanClub = (artist) => go({ fanClub: artist });
  // Open the persistent top player. `queue` (optional) is a list of tracks so the
  // bar can skip prev/next; without it, a single track. player = { list, index }.
  const openPlayer = (media, queue) => {
    if (!media) return;
    const key = (m) => m?.id || m?.url || m?.preview || m?.title;
    // Always continue past the explicit queue with genre/taste-based recommendations
    // so "up next" is populated and playback never dead-ends after one song.
    let base = Array.isArray(queue) && queue.length ? queue : [media];
    // The tapped track MUST be what plays: if it's not in the queue it was handed
    // (e.g. an album track played against the top-tracks queue), put it first.
    if (!base.some((m) => key(m) === key(media))) base = [media, ...base];
    const list = autoplayQueue(media, base);
    setPlayer({ list, index: Math.max(0, list.findIndex((m) => key(m) === key(media))) });
    recordPlay(media);
  };
  const setPlayerIndex = (i) => setPlayer((p) => {
    if (!p) return p;
    const idx = Math.max(0, Math.min(i, p.list.length - 1));
    recordPlay(p.list[idx]);
    return { ...p, index: idx };
  });
  // Queue edits from the up-next panel: jump to, remove, or move a track to next.
  const playAt = (i) => setPlayerIndex(i);
  const removeFromQueue = (i) => setPlayer((p) => {
    if (!p || i === p.index) return p;
    const list = p.list.filter((_, j) => j !== i);
    const index = i < p.index ? p.index - 1 : p.index;
    return { ...p, list, index };
  });
  const moveToNext = (i) => setPlayer((p) => {
    if (!p || i === p.index) return p;
    const item = p.list[i];
    const rest = p.list.filter((_, j) => j !== i);
    const curPos = rest.indexOf(p.list[p.index]);
    rest.splice(curPos + 1, 0, item);
    return { ...p, list: rest, index: curPos };
  });
  const openPhotos = (images, index = 0) => go({ photos: { images, index } });
  const openAddToPlaylist = (track) => requireAuth(() => go({ addToPlaylist: track }));
  const openFollowList = (userId, mode) => go({ followList: { userId, mode } });
  const reviewShow = (log) => requireAuth(() => go({ logging: true, prefill: { artist: log.artist, venue: log.venue, city: log.city } }));
  const openInbox = () => requireAuth(() => go({ inbox: true }));
  const openNotifications = () => requireAuth(() => go({ notifications: true }));
  const openThread = (otherId) => requireAuth(() => go({ thread: otherId }));
  const openVenueReview = (name) => requireAuth(() => go({ venueReview: name }));

  let overlay = null;
  // Auth is a modal that must win over any page overlay — requireAuth() can fire
  // from inside a venue/show/profile page, and the login sheet has to surface.
  if (nav.photos) overlay = <PhotoViewer photos={nav.photos.images} index={nav.photos.index} onClose={back} />;
  else if (nav.addToPlaylist) overlay = <PlaylistPickerScreen track={nav.addToPlaylist} onClose={back} />;
  else if (nav.followList) overlay = <FollowListScreen userId={nav.followList.userId} mode={nav.followList.mode} onClose={back} onOpenProfile={openProfile} />;
  else if (nav.auth) overlay = <AuthScreen initialMode={nav.authMode} onDone={(mode) => { if (mode === "signup") { if (web) save("pit.welcomePending", true); replace({ pickArtists: true }); } else back(); }} onCancel={back} />;
  else if (nav.pickArtists) overlay = <PickArtistsScreen onDone={clear} onSkip={clear} />;
  else if (nav.logging) overlay = <LogScreen user={session} prefill={nav.prefill} onPost={onAddLog} onCancel={back} />;
  else if (nav.reporting) overlay = <ReportScreen log={nav.reporting} onClose={back} />;
  else if (nav.editProfile) overlay = <EditProfileScreen onClose={back} onPickArtists={() => replace({ pickArtists: true })} />;
  else if (nav.venueReview) overlay = <VenueReviewScreen venueName={nav.venueReview} onClose={back} />;
  else if (nav.thread) overlay = <ThreadScreen otherId={nav.thread} onClose={back} onOpenProfile={openProfile} onOpenProfileByHandle={openProfileByHandle} />;
  else if (nav.inbox) overlay = <InboxScreen onClose={back} onOpenThread={openThread} />;
  else if (nav.notifications) overlay = <NotificationsScreen onClose={back} onOpenProfile={openProfile} onOpenThread={openThread} onOpen={openShow} onOpenPost={openPost} />;
  else if (nav.profileId) overlay = <ProfileScreen userId={nav.profileId} onClose={back} onOpenShow={openShow} onOpenArtist={openArtist} onOpenVenue={openVenue} onEditProfile={() => go({ editProfile: true })} onPreview={showPreview} onMessage={openThread} onReport={(log) => requireAuth(() => go({ reporting: log }))} onOpenPhotos={openPhotos} onPlay={openPlayer} onOpenFollowList={openFollowList} onOpenBadges={openBadges} />;
  else if (nav.fanClub) overlay = <FanClubScreen artist={nav.fanClub} onClose={back} onOpenProfile={openProfile} onOpenProfileByHandle={openProfileByHandle} />;
  else if (nav.editArtist) overlay = <EditArtistProfileScreen artistName={nav.editArtist} onClose={back} />;
  else if (nav.artistName) overlay = <ArtistScreen artistName={nav.artistName} onClose={back} onOpenShow={openShow} onOpenVenue={openVenue} onOpenFanClub={openFanClub} onOpenPhotos={openPhotos} onEditArtist={(name) => go({ editArtist: name })} onPlay={openPlayer} onAddToPlaylist={openAddToPlaylist} />;
  else if (nav.venueName) overlay = <VenueScreen venueName={nav.venueName} onClose={back} onOpenShow={openShow} onOpenArtist={openArtist} onOpenVenue={openVenue} onReviewVenue={openVenueReview} onOpenProfile={openProfile} onOpenPhotos={openPhotos} />;
  else if (nav.nearby) overlay = <NearbyScreen onClose={back} onOpenVenue={openVenue} onOpenArtist={openArtist} />;
  else if (nav.venues) overlay = <VenuesScreen onClose={back} onOpenVenue={openVenue} />;
  else if (nav.fanClubs) overlay = <FanClubsScreen onClose={back} onOpenFanClub={openFanClub} />;
  else if (nav.settings) overlay = <SettingsScreen onClose={back} onEditProfile={() => go({ editProfile: true })} onOpenProfile={() => (session ? go({ profileId: session.id }) : go({ auth: true }))} onOpenPrivacy={() => go({ privacy: true })} onOpenTerms={() => go({ terms: true })} onLogout={() => { logout(); clear(); exitToLanding(); }} />;
  else if (nav.privacy) overlay = <PrivacyScreen onClose={back} />;
  else if (nav.terms) overlay = <TermsScreen onClose={back} />;
  else if (nav.lounge) overlay = <LoungeScreen log={nav.lounge} onClose={back} onOpenProfile={openProfile} onOpenProfileByHandle={openProfileByHandle} />;
  else if (nav.openLog) overlay = <ShowScreen log={nav.openLog} onClose={back} onPreview={showPreview} onReview={reviewShow} onOpenProfile={openProfile} onOpenArtist={openArtist} onOpenVenue={openVenue} onOpenLounge={(log) => go({ lounge: log })} onRequireAuth={() => go({ auth: true })} />;
  else if (nav.post) overlay = <PostScreen log={nav.post} onClose={back} onOpenProfile={openProfile} onOpenArtist={openArtist} onOpenVenue={openVenue} onOpenShow={openShow} onReport={(log) => requireAuth(() => go({ reporting: log }))} />;
  else if (nav.badges) overlay = <BadgeLegendScreen userId={nav.badges.userId} onClose={back} />;
  else if (nav.topRated) overlay = <TopRatedScreen onClose={back} onOpen={openShow} />;
  else if (nav.admin) overlay = <AdminScreen onClose={back} />;
  else if (nav.bulk) overlay = <BulkTourDatesScreen onClose={back} />;
  else if (nav.reqArtist) overlay = <RequestArtistScreen onClose={back} />;
  else if (nav.menu) overlay = (
    <MenuScreen
      onClose={back}
      onNear={() => requireAuth(() => replace({ nearby: true }))}
      onVenues={() => replace({ venues: true })}
      onFanClubs={() => replace({ fanClubs: true })}
      onTopRated={() => replace({ topRated: true })}
      onInbox={() => requireAuth(() => replace({ inbox: true }))}
      onActivity={() => requireAuth(() => replace({ notifications: true }))}
      onProfile={() => session && replace({ profileId: session.id })}
      onEditProfile={() => replace({ editProfile: true })}
      onAdmin={() => replace({ admin: true })}
      onTourDates={() => replace({ bulk: true })}
      onRequestArtist={() => replace({ reqArtist: true })}
      onLogin={() => replace({ auth: true })}
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
                  notifUnread={session ? unreadNotifications() : 0}
                  newUser={!!session && feed.filter((l) => l.userId === session.id).length === 0}
                  onLogShow={() => requireAuth(() => go({ logging: true }))}
                  onEditProfile={() => go({ editProfile: true })}
                  onOpenInbox={openInbox}
                  onOpenNotifications={openNotifications}
                  onOpen={openShow}
                  onComment={openPost}
                  onPreview={showPreview}
                  onOpenProfile={openProfile}
                  onOpenArtist={openArtist}
                  onOpenVenue={openVenue}
                  onOpenNearby={() => requireAuth(() => go({ nearby: true }))}
                  onOpenMenu={() => go({ menu: true })}
                  onReport={(log) => requireAuth(() => go({ reporting: log }))}
                />
              )}
              {tab === "search" && <SearchScreen onOpen={openShow} onOpenArtist={openArtist} onOpenVenue={openVenue} onOpenFanClub={openFanClub} onOpenProfile={openProfile} />}
              {tab === "discover" && <DiscoverScreen onOpenTopRated={() => go({ topRated: true })} onOpen={openShow} onOpenArtist={openArtist} onOpenNearby={() => requireAuth(() => go({ nearby: true }))} onOpenFanClubs={() => go({ fanClubs: true })} onOpenVenues={() => go({ venues: true })} onOpenPhotos={openPhotos} onPlay={openPlayer} onOpenProfile={openProfile} />}
              {tab === "you" && (
                <YouScreen
                  feed={feed}
                  onLogin={() => go({ auth: true })}
                  onLogout={() => { logout(); exitToLanding(); }}
                  onAdmin={() => go({ admin: true })}
                  onAddTourDate={() => go({ bulk: true })}
                  onRequestArtist={() => go({ reqArtist: true })}
                  onEditProfile={() => go({ editProfile: true })}
                  onOpenProfile={openProfile}
                  onOpen={openShow}
                  onActivity={openNotifications}
                  onInbox={openInbox}
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
              <Text style={[styles.acctSub, roleColor(session.role) && { color: roleColor(session.role), fontWeight: "800" }]} numberOfLines={1}>@{session.handle}</Text>
            </View>
            <Icon name="chevron-down" size={16} color={colors.textDim} />
          </Pressable>
        ) : (
          <View style={styles.authBtns}>
            <Pressable style={styles.introBtn} onPress={() => { clear(); exitToLanding(); }} hitSlop={6}>
              <Icon name="chevron-left" size={15} color={colors.textDim} />
              <Text style={styles.introBtnTxt}>Intro</Text>
            </Pressable>
            <Pressable style={styles.loginPill} onPress={() => go({ auth: true, authMode: "login" })}>
              <Text style={styles.loginPillTxt}>Log in</Text>
            </Pressable>
            <Pressable style={styles.signupPill} onPress={() => go({ auth: true, authMode: "signup" })}>
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
          notifUnread={session ? unreadNotifications() : 0}
          onActivity={openNotifications}
          onLog={() => requireAuth(() => go({ logging: true }))}
          onFindVenues={() => go({ venues: true })}
          onFanClubs={() => go({ fanClubs: true })}
          onNearby={() => requireAuth(() => go({ nearby: true }))}
          onTopRated={() => go({ topRated: true })}
          onInbox={openInbox}
          onProfile={() => (session ? openProfile(session.id) : go({ auth: true }))}
          onLogin={() => go({ auth: true })}
        />
        <View style={styles.deskCenter}>{overlay || tabScreens}</View>
        <RightRail onOpenArtist={openArtist} onOpenVenue={openVenue} onFindVenues={() => go({ venues: true })} onOpenEvent={(t) => openArtist(t.artist)} />
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />

        {!(landing && !session) && player && (
          <PlayerBar player={player} onClose={() => setPlayer(null)} onIndex={setPlayerIndex}
            onPlayAt={playAt} onRemove={removeFromQueue} onMoveNext={moveToNext}
            history={playHistory} onSaveSession={saveSnapshot} onPlayTrack={openPlayer} onOpenArtist={openArtist} onAddToPlaylist={openAddToPlaylist} />
        )}

        {landing && !session ? (
          <LandingScreen
            onLogin={() => { enter(); go({ auth: true, authMode: "login" }); }}
            onSignup={() => { enter(); go({ auth: true, authMode: "signup" }); }}
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
                <Pressable style={styles.fab} onPress={() => requireAuth(() => go({ logging: true }))} accessibilityLabel="Make a post">
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
            { icon: "edit", label: "Edit profile", onPress: () => { setAcctOpen(false); go({ editProfile: true }); } },
            { icon: "menu", label: "Settings", onPress: () => { setAcctOpen(false); go({ settings: true }); } },
            { icon: "lock", label: "Privacy", onPress: () => { setAcctOpen(false); go({ privacy: true }); } },
            { icon: "shield", label: "Terms & conditions", onPress: () => { setAcctOpen(false); go({ terms: true }); } },
            { divider: true },
            { icon: "logout", label: "Log out", danger: true, onPress: () => { setAcctOpen(false); logout(); clear(); exitToLanding(); } },
          ]}
        />

        {spotifyNotice && (
          <View style={styles.spotifyBanner}>
            <Icon name="music" size={16} color={colors.gold} />
            <Text style={styles.spotifyBannerTxt}>{spotifyNotice}</Text>
            <Pressable onPress={dismissSpotifyNotice} hitSlop={8}><Icon name="x" size={15} color={colors.textDim} /></Pressable>
          </View>
        )}

        {resetToken && (
          <View style={styles.welcomeModal}>
            <ResetPasswordScreen token={resetToken} onDone={clearResetUrl} onCancel={clearResetUrl} />
          </View>
        )}

        {welcome && session && (
          <View style={styles.welcomeModal}>
            <WelcomeScreen
              onClose={() => setWelcome(false)}
              onOpenFanClub={(a) => { setWelcome(false); openFanClub(a); }}
              onOpenShow={(s) => { setWelcome(false); openShow(s); }}
              onOpenFanClubs={() => { setWelcome(false); go({ fanClubs: true }); }}
              onOpenNearby={() => { setWelcome(false); requireAuth(() => go({ nearby: true })); }}
            />
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

function TabButton({ tab, active, onPress }) {
  const on = active === tab.key;
  return (
    <Pressable style={styles.tab} onPress={() => onPress(tab.key)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={tab.label}>
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
  welcomeModal: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.bg, zIndex: 200, ...(Platform.OS === "web" ? { position: "fixed" } : null) },
  spotifyBanner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.gold, borderRadius: radius.md, margin: 12, padding: 12, ...(Platform.OS === "web" ? { position: "fixed", left: 12, right: 12, bottom: 12, zIndex: 210, maxWidth: 520 } : null) },
  spotifyBannerTxt: { color: colors.text, fontSize: 12.5, lineHeight: 18, flex: 1 },

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
