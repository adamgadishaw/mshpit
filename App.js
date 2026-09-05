import { useState, useRef, useEffect, useLayoutEffect, Suspense } from "react";
import { View, Text, StyleSheet, Pressable, SafeAreaView, Platform, StatusBar as RNStatusBar, Animated, ActivityIndicator, useWindowDimensions, BackHandler } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "./src/lib/safeArea"; // reserves iOS notch / toolbar safe areas (web)
import "./src/lib/webInputFix"; // strips the harsh browser focus box from inputs (web)
import { colors, mono, radius, themeIsDark } from "./src/theme";
import { StoreProvider, useStore, isMod, isStaff } from "./src/store";
import Icon from "./src/components/Icon";
import ErrorBoundary from "./src/components/ErrorBoundary";
import RuntimeErrorMonitor from "./src/components/RuntimeErrorMonitor";
import FeedbackHost from "./src/components/FeedbackHost";
import VerifyEmailBanner from "./src/components/VerifyEmailBanner";
import { DesktopTopNav, RightRail } from "./src/components/Rails";
import { PublicDirectoryPanel, PublicWebTrail } from "./src/components/PublicWebLinks";
import FeedScreen from "./src/screens/FeedScreen";
const SearchScreen = lazyWithRetry(() => import("./src/screens/SearchScreen"), "SearchScreen");
const YouScreen = lazyWithRetry(() => import("./src/screens/YouScreen"), "YouScreen");
const DiscoverScreen = lazyWithRetry(() => import("./src/screens/DiscoverScreen"), "DiscoverScreen");
const ShowScreen = lazyWithRetry(() => import("./src/screens/ShowScreen"), "ShowScreen");
const LoungeScreen = lazyWithRetry(() => import("./src/screens/LoungeScreen"), "LoungeScreen");
const InboxScreen = lazyWithRetry(() => import("./src/screens/InboxScreen"), "InboxScreen");
const ListeningHistoryScreen = lazyWithRetry(() => import("./src/screens/ListeningHistoryScreen"), "ListeningHistoryScreen");
const NotificationsScreen = lazyWithRetry(() => import("./src/screens/NotificationsScreen"), "NotificationsScreen");
const CalendarScreen = lazyWithRetry(() => import("./src/screens/CalendarScreen"), "CalendarScreen");
const ClipsScreen = lazyWithRetry(() => import("./src/screens/ClipsScreen"), "ClipsScreen");
const ThreadScreen = lazyWithRetry(() => import("./src/screens/ThreadScreen"), "ThreadScreen");
const VenueReviewScreen = lazyWithRetry(() => import("./src/screens/VenueReviewScreen"), "VenueReviewScreen");
const FanClubScreen = lazyWithRetry(() => import("./src/screens/FanClubScreen"), "FanClubScreen");
import AccountGate from "./src/screens/AccountGate";
const MenuScreen = lazyWithRetry(() => import("./src/screens/MenuScreen"), "MenuScreen");
const PhotoViewer = lazyWithRetry(() => import("./src/components/PhotoViewer"), "PhotoViewer");
const LogScreen = lazyWithRetry(() => import("./src/screens/LogScreen"), "LogScreen");
const TopRatedScreen = lazyWithRetry(() => import("./src/screens/TopRatedScreen"), "TopRatedScreen");
import AuthScreen from "./src/screens/AuthScreen";
const AdminScreen = lazyWithRetry(() => import("./src/screens/AdminScreen"), "AdminScreen");
const BulkTourDatesScreen = lazyWithRetry(() => import("./src/screens/BulkTourDatesScreen"), "BulkTourDatesScreen");
const RequestArtistScreen = lazyWithRetry(() => import("./src/screens/RequestArtistScreen"), "RequestArtistScreen");
const ProfileScreen = lazyWithRetry(() => import("./src/screens/ProfileScreen"), "ProfileScreen");
const EditProfileScreen = lazyWithRetry(() => import("./src/screens/EditProfileScreen"), "EditProfileScreen");
const ReportScreen = lazyWithRetry(() => import("./src/screens/ReportScreen"), "ReportScreen");
const ArtistScreen = lazyWithRetry(() => import("./src/screens/ArtistScreen"), "ArtistScreen");
const ArtistGalleryScreen = lazyWithRetry(() => import("./src/screens/ArtistGalleryScreen"), "ArtistGalleryScreen");
const ArtistArchiveScreen = lazyWithRetry(() => import("./src/screens/ArtistArchiveScreen"), "ArtistArchiveScreen");
const TourArchiveScreen = lazyWithRetry(() => import("./src/screens/TourArchiveScreen"), "TourArchiveScreen");
const ArtistHubScreen = lazyWithRetry(() => import("./src/screens/ArtistHubScreen"), "ArtistHubScreen");
const EditArtistProfileScreen = lazyWithRetry(() => import("./src/screens/EditArtistProfileScreen"), "EditArtistProfileScreen");
const VenueScreen = lazyWithRetry(() => import("./src/screens/VenueScreen"), "VenueScreen");
const VenuesScreen = lazyWithRetry(() => import("./src/screens/VenuesScreen"), "VenuesScreen");
const PickArtistsScreen = lazyWithRetry(() => import("./src/screens/PickArtistsScreen"), "PickArtistsScreen");
const FanClubsScreen = lazyWithRetry(() => import("./src/screens/FanClubsScreen"), "FanClubsScreen");
const NearbyScreen = lazyWithRetry(() => import("./src/screens/NearbyScreen"), "NearbyScreen");
const SettingsScreen = lazyWithRetry(() => import("./src/screens/SettingsScreen"), "SettingsScreen");
const SuggestionBoxScreen = lazyWithRetry(() => import("./src/screens/SuggestionBoxScreen"), "SuggestionBoxScreen");
const DeleteAccountScreen = lazyWithRetry(() => import("./src/screens/DeleteAccountScreen"), "DeleteAccountScreen");
const DiagnosticsScreen = lazyWithRetry(() => import("./src/screens/DiagnosticsScreen"), "DiagnosticsScreen");
const PrivacyScreen = lazyWithRetry(() => import("./src/screens/PrivacyScreen"), "PrivacyScreen");
const TermsScreen = lazyWithRetry(() => import("./src/screens/TermsScreen"), "TermsScreen");
import AccountMenu from "./src/components/AccountMenu";
const PlayerBar = lazyWithRetry(() => import("./src/components/PlayerBar"), "PlayerBar");
const PlaylistPickerScreen = lazyWithRetry(() => import("./src/screens/PlaylistPickerScreen"), "PlaylistPickerScreen");
const PostScreen = lazyWithRetry(() => import("./src/screens/PostScreen"), "PostScreen");
const ResetPasswordScreen = lazyWithRetry(() => import("./src/screens/ResetPasswordScreen"), "ResetPasswordScreen");
const UnsubscribeScreen = lazyWithRetry(() => import("./src/screens/UnsubscribeScreen"), "UnsubscribeScreen");
const VerifyEmailScreen = lazyWithRetry(() => import("./src/screens/VerifyEmailScreen"), "VerifyEmailScreen");
const OwnerApprovalScreen = lazyWithRetry(() => import("./src/screens/OwnerApprovalScreen"), "OwnerApprovalScreen");
const BadgeLegendScreen = lazyWithRetry(() => import("./src/screens/BadgeLegendScreen"), "BadgeLegendScreen");
const WelcomeScreen = lazyWithRetry(() => import("./src/screens/WelcomeScreen"), "WelcomeScreen");
const SignupOnboardingScreen = lazyWithRetry(() => import("./src/screens/SignupOnboardingScreen"), "SignupOnboardingScreen");
const FollowListScreen = lazyWithRetry(() => import("./src/screens/FollowListScreen"), "FollowListScreen");
import LandingScreen from "./src/screens/LandingScreen";
import { load, remove, save } from "./src/lib/persist";
import { configureDiagnosticsIdentity } from "./src/lib/diagnostics";
import { getPendingImagePickerResult } from "./src/lib/imagePickerRecovery";
import { lazyWithRetry } from "./src/lib/lazyWithRetry";
import { recordFeedImpressionForSession } from "./src/features/feedImpressions/feedImpressionService";
import useFeedImpressionSession from "./src/features/feedImpressions/useFeedImpressionSession";
import { artistPath, eventPath, parsePath, isPublicEntityPath } from "./src/domain/urls.mjs";
import { shouldRestorePersistedStack } from "./src/domain/browserNavigation.mjs";
import { initialLandingState, landingRenderSurface } from "./src/domain/landingStartup.mjs";
import { publicNavigationLinks, shouldShowMobilePublicTrail } from "./src/domain/publicNavigationLinks.mjs";
import {
  publicCollectionHydration,
  publicFramePath,
  resolvedPublicCollectionFrame,
} from "./src/domain/publicFrameNavigation.mjs";
import {
  readPublicPost,
  resolvePublicEntity,
} from "./src/features/publicNavigation/publicNavigationService";
import {
  composerNavigationTransition,
  isActiveComposer,
  isComposerFrame,
  prepareNavigationFrame,
} from "./src/domain/composerNavigation.mjs";
import {
  ACTIVE_COMPOSER_KEY,
  PENDING_COMPOSER_PICKER_KEY,
  pickerOwnerMatchesComposer,
  restoreComposerFrame,
} from "./src/domain/composerRecovery.mjs";
import { trackKey } from "./src/domain/trackIdentity.mjs";
import { ENABLE_CLIPS, ENABLE_DEMO_DATA } from "./src/config/runtime.mjs";
import {
  MUSIC_PLAYER_ENABLED,
  isMusicPlayerNavigationFrame,
  sanitizeDisabledMusicPlayerNavigationFrame,
} from "./src/domain/musicPlayerAvailability.mjs";
import { analyticsDwellBucket } from "./src/domain/analyticsPolicy.mjs";
import { ownedPlayerEnvelope, playerQueueWithEntryIds, restoreOwnedPlayerState } from "./src/domain/player-session.mjs";
import { playerLookupIntent } from "./src/domain/playback.mjs";
import { profileManagementAction, publicIdentityTarget } from "./src/domain/artistWorkspace.mjs";
import { prepareShowNavigation } from "./src/domain/showNavigation.mjs";
import { isOnlineReview } from "./src/domain/onlineReview.mjs";
import { readSensitiveFragmentToken, readSensitiveLinkToken, scrubSensitiveLinkToken } from "./src/domain/sensitiveLinkTokens.mjs";
import { verifiedMutationDecision } from "./src/domain/emailVerificationUx.mjs";
import { needsSignupOnboarding } from "./src/domain/signupOnboarding.mjs";
import { desktopRightRailLayout } from "./src/domain/desktopRailLayout.mjs";
import { filterDiscoverSceneRows } from "./src/domain/discoverScene.mjs";
import { calendarFocusForPost } from "./src/domain/calendarShows.mjs";
import { homeShowCountdownPlan } from "./src/domain/homeShowCountdown.mjs";
import { countryForCity } from "./src/geo";
import {
  PLAYER_POSITION_STORAGE_KEY,
  PLAYER_STATE_STORAGE_KEY,
} from "./src/domain/accountLocalPrivacy.mjs";

const LEFT = [
  { key: "feed", label: "Feed", icon: "feed" },
  { key: "search", label: "Search", icon: "search" },
];
const RIGHT = [
  { key: "discover", label: "Discover", icon: "discover" },
  { key: "you", label: "You", icon: "you" },
];

const ANALYTICS_OVERLAY_KEYS = [
  ["photos", "media_viewer"], ["addToPlaylist", "playlist_picker"], ["followList", "follow_list"],
  ["auth", "auth"], ["pickArtists", "pick_artists"], ["editingPost", "post_edit"], ["logging", "post_create"],
  ["reporting", "report"], ["editProfile", "profile_edit"], ["venueReview", "venue_review"], ["thread", "message_thread"],
  ["inbox", "inbox"], ["listeningHistory", "listening_history"], ["notifications", "activity"], ["calendar", "calendar"], ["clips", "clips"],
  ["profileId", "profile"], ["fanClub", "fan_club"], ["artistHub", "artist_hq"], ["artistPreview", "artist_preview"], ["artistGallery", "artist_gallery"],
  ["editArtist", "artist_edit"], ["artistArchive", "artist_archive"], ["artistTour", "artist_tour"], ["artistName", "artist"],
  ["venueName", "venue"], ["nearby", "nearby"], ["venues", "venues"], ["fanClubs", "fan_clubs"],
  ["settings", "settings"], ["suggestion", "suggestion"], ["deleteAccount", "account_delete"], ["diagnostics", "diagnostics"], ["privacy", "privacy"],
  ["terms", "terms"], ["lounge", "lounge"], ["openLog", "show"], ["post", "post"], ["badges", "badges"],
  ["topRated", "top_rated"], ["admin", "admin"], ["bulk", "tour_dates"], ["reqArtist", "request_artist"], ["menu", "menu"],
];

function analyticsScreenKey({ landing, tab, nav }) {
  if (landing) return "landing";
  const overlay = ANALYTICS_OVERLAY_KEYS.find(([key]) => nav?.[key]);
  return overlay?.[1] || `tab_${["feed", "search", "discover", "you"].includes(tab) ? tab : "feed"}`;
}

function prepareAvailableNavigationFrame(candidate) {
  const prepared = prepareNavigationFrame(candidate);
  const sanitized = sanitizeDisabledMusicPlayerNavigationFrame(prepared);
  if (isMusicPlayerNavigationFrame(prepared) && !Object.keys(sanitized || {}).length) return null;
  return sanitized;
}

export default function App() {
  useLayoutEffect(() => {
    if (Platform.OS !== "web" || typeof globalThis === "undefined") return;
    globalThis.__MSHPIT_WEB_BOOT__?.complete?.();
  }, []);

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <>
          <RuntimeErrorMonitor />
          <StoreProvider>
            <Root />
          </StoreProvider>
        </>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

function Root() {
  const {
    session, authReady, addLog, editLog, userById, loadUser, visibleFeed, followingFeed, localFeed, refreshFeed, loadMoreFeed,
    feedHasMore, feedLoadingMore, notInterested, undoNotInterested, logout, exportMyData, userByHandle,
    searchPeople, inboxUnread, accountStatus, track, unreadNotifications, recordPlay, playHistory, isFollowing, follow, isBlocked,
    loadPlayHistory, saveQueueAsPlaylist, autoplayQueue, followingCount, resendEmailVerification, completeSignupOnboarding,
    topArtists, artistsAlphabetical, upcomingEvents, discoverySidebar, discoverySidebarStatus, refreshDiscoverySidebar, refreshTourDates, tourDates, goingFor, myAttendance, refreshMyAttendance,
    remoteArtistMeta,
    resolveYouTube, invalidateYouTube, youtubeVideoRejected, resolveDeezerPreview,
    youtubeLookupStatus, mediaReactions, loadMediaReactions, toggleMediaReaction,
    removeMyPostTag,
  } = useStore();
  useFeedImpressionSession(session);
  const staff = isStaff(session?.role);
  const canViewDiagnostics = isMod(session?.role);
  const feed = visibleFeed(staff);
  const following = followingFeed(staff);
  const local = localFeed(staff);

  const { width } = useWindowDimensions();
  // Only true desktops get the persistent player column + top navigation. Below
  // this, tablets, split-screen windows, and phones keep the compact shell.
  const wide = Platform.OS === "web" && width >= 1200;

  const web = Platform.OS === "web" && typeof window !== "undefined";

  // Keep the composer out of startup. Warm it only from a real posting gesture
  // so feed hydration, images, and account reads never compete with a screen
  // somebody may not open during this visit.
  const preloadComposer = () => {
    LogScreen.preload?.().catch(() => { /* architecture: allow-empty-catch -- Intent warming is optional; Suspense owns visible loading and retry. */ });
  };

  // Restore the last tab on reload so a refresh doesn't dump you back on the feed.
  const [tab, setTab] = useState(() => (web ? load("pit.tab", "feed") : "feed"));
  // Navigation is a STACK of frames. Each frame is one overlay screen, e.g.
  // { artistName } or { profileId }; the top frame is what's showing. An empty
  // base frame ({}) means "just the tab screens." Opening a screen PUSHES a
  // frame; Back POPS one — so you retrace your steps instead of always being
    // dumped back to the feed. (Before this, nav was a single flat object and
  // every close reset it to {}, which is why Back only ever went to the feed.)
  // The stack is persisted as recovery state for URL-less app overlays. On web,
  // however, the address bar owns public navigation: `/` must stay home and an
  // entity URL must be resolved from that URL rather than resurrecting some
  // different artist/profile from local storage.
  const [stack, setStack] = useState(() => {
    if (!web) {
      const restored = restoreComposerFrame(
        load(ACTIVE_COMPOSER_KEY, null),
        load(PENDING_COMPOSER_PICKER_KEY, null),
      );
      return restored ? [{}, restored] : [{}];
    }
    if (!shouldRestorePersistedStack(window.location.pathname)) return [{}];
    const saved = load("pit.stack", null);
    if (!Array.isArray(saved) || !saved.length) return [{}];
    // Restore the exact screen you were on, but COLLAPSE the back-stack to a single
    // step. Before, a refresh resurrected the whole chain of pages you'd visited,
    // so Back walked through a string of half-remembered screens ("jumps to a
    // random back page"). Now: refresh lands you here; Back goes straight to the tab.
    const top = prepareAvailableNavigationFrame(saved[saved.length - 1]);
    if (!ENABLE_CLIPS && top?.clips) return [{}];
    if (top?.diagnostics) return [{}];
    return top && Object.keys(top).length ? [{}, top] : [{}];
  });
  const nav = stack[stack.length - 1];
  const stackRef = useRef(stack);
  stackRef.current = stack;
  // The composer owns its dirty/busy close policy. Keeping the handler in a ref
  // lets browser and Android Back consult the latest form state without forcing
  // the entire shell to rerender on every keystroke.
  const composerCloseGuardRef = useRef(null);
  const bypassNextPopRef = useRef(null);
  const [pendingComposerPicker, setPendingComposerPicker] = useState(null);

  // Keep enough route identity to rebuild an interrupted native composer. This
  // is intentionally one frame rather than the whole navigation history.
  useEffect(() => {
    if (web) return;
    const top = stack[stack.length - 1];
    if (isComposerFrame(top)) save(ACTIVE_COMPOSER_KEY, top);
    else remove(ACTIVE_COMPOSER_KEY);
  }, [web, stack]);

  // SDK 57 documents that Android may destroy MainActivity while the system
  // picker is open. The shell is always mounted, so it owns recovery and hands
  // the result only to the exact composer that launched that picker.
  useEffect(() => {
    if (Platform.OS !== "android") return undefined;
    const owner = load(PENDING_COMPOSER_PICKER_KEY, null);
    if (!owner?.composerId || !owner?.requestId) return undefined;
    let active = true;
    let retryTimer = null;
    getPendingImagePickerResult()
      .then((result) => {
        if (!active) return;
        const frame = stackRef.current[stackRef.current.length - 1];
        if (!pickerOwnerMatchesComposer(owner, frame)) {
          remove(PENDING_COMPOSER_PICKER_KEY);
          return;
        }
        // Android may restore the activity before it has published the picker
        // result. Keep ownership durable and retry briefly instead of clearing a
        // valid in-flight selection on the first null read.
        if (!result) {
          retryTimer = setTimeout(() => {
            if (!active) return;
            getPendingImagePickerResult()
              .then((retry) => {
                if (!active) return;
                if (retry) setPendingComposerPicker({ ...owner, result: retry });
                else remove(PENDING_COMPOSER_PICKER_KEY);
              })
              .catch((error) => {
                if (active) setPendingComposerPicker({ ...owner, result: { code: "PICKER_RECOVERY_FAILED", message: error?.message } });
              });
          }, 250);
          return;
        }
        setPendingComposerPicker({ ...owner, result });
      })
      .catch((error) => {
        if (!active) return;
        const frame = stackRef.current[stackRef.current.length - 1];
        if (pickerOwnerMatchesComposer(owner, frame)) setPendingComposerPicker({ ...owner, result: { code: "PICKER_RECOVERY_FAILED", message: error?.message } });
        else remove(PENDING_COMPOSER_PICKER_KEY);
      });
    return () => { active = false; if (retryTimer) clearTimeout(retryTimer); };
  }, []);

  const [preview, setPreview] = useState(null);
  // Capture this before RN Web's Modal portal moves focus to <body>. The viewer
  // receives the ref without putting a DOM node into persisted navigation state.
  const mediaViewerOpenerRef = useRef(null);
  const mediaViewerOpenerIdentityRef = useRef(null);
  const mediaViewerFocusGenerationRef = useRef(0);
  // RN Web tears down its Modal portal after child-effect cleanup. Restoring
  // focus from inside PhotoViewer is therefore too early: the portal focuses
  // <body> immediately afterwards. Wait until the close commit has painted,
  // and cancel the hand-off if another viewer opens in the meantime.
  useEffect(() => {
    if (!web || nav.photos || !mediaViewerOpenerRef.current) return undefined;
    const opener = mediaViewerOpenerRef.current;
    const identity = mediaViewerOpenerIdentityRef.current;
    const generation = mediaViewerFocusGenerationRef.current;
    let settleFrame = null;
    const teardownFrame = requestAnimationFrame(() => {
      settleFrame = requestAnimationFrame(() => {
        const top = stackRef.current[stackRef.current.length - 1];
        if (generation !== mediaViewerFocusGenerationRef.current || top?.photos) return;
        // The feed is remounted underneath RN Web's Modal, so the captured DOM
        // node can be disconnected even though its logical media tile is back.
        // Resolve the stable nativeID first, then fall back to the exact label.
        let focusTarget = opener;
        if (focusTarget?.isConnected === false && identity?.id) {
          focusTarget = document.getElementById(identity.id);
        }
        if (focusTarget?.isConnected === false && identity?.label) {
          focusTarget = Array.from(document.querySelectorAll('button,[role="button"]'))
            .find((element) => element.getAttribute("aria-label") === identity.label) || null;
        }
        if (focusTarget?.isConnected !== false && typeof focusTarget?.focus === "function") focusTarget.focus();
        if (mediaViewerOpenerRef.current === opener) {
          mediaViewerOpenerRef.current = null;
          mediaViewerOpenerIdentityRef.current = null;
        }
      });
    });
    return () => {
      cancelAnimationFrame(teardownFrame);
      if (settleFrame !== null) cancelAnimationFrame(settleFrame);
    };
  }, [nav.photos, web]);
  // Persisted so the player survives a reload (switching themes reloads the page):
  // the bar comes back with its queue instead of vanishing mid-listen.
  const playerAccountId = session?.id || null;
  const [playerState, setPlayerState] = useState(() => ({
    accountId: playerAccountId,
    player: MUSIC_PLAYER_ENABLED && web && session?.id
      ? restoreOwnedPlayerState(load(PLAYER_STATE_STORAGE_KEY, null), session.id)
      : null,
  }));
  const playerStateIsScoped = playerState.accountId === playerAccountId;
  const player = playerStateIsScoped ? playerState.player : null;
  const setPlayer = (updater) => setPlayerState((current) => {
    const scopedCurrent = current.accountId === playerAccountId ? current.player : null;
    const next = typeof updater === "function" ? updater(scopedCurrent) : updater;
    return { accountId: playerAccountId, player: next };
  });
  // The player starts COLLAPSED (a slim rail on desktop, hidden on mobile) and
  // opens itself the moment something plays; collapsing pauses (YouTube terms).
  const [playerMinimized, setPlayerMinimized] = useState(true);
  const playerColumnWidth = playerMinimized ? 82 : Math.max(356, Math.min(460, Math.round(width * 0.25)));
  const rightRailLayout = desktopRightRailLayout({
    viewportWidth: width,
    desktop: wide,
    playerColumnWidth: MUSIC_PLAYER_ENABLED && wide ? playerColumnWidth : 0,
  });
  const showRightRail = rightRailLayout.visible;
  const homeCountdown = session ? homeShowCountdownPlan({
    attendance: myAttendance,
    going: goingFor(session.id),
    upcoming: [
      ...(Array.isArray(discoverySidebar?.upcomingEvents) ? discoverySidebar.upcomingEvents : []),
      ...(typeof upcomingEvents === "function" ? upcomingEvents(120) : []),
    ],
  }) : null;
  const refreshHomeFeedData = async ({ signal } = {}) => {
    const results = await Promise.allSettled([
      refreshFeed?.({ signal }),
      refreshDiscoverySidebar?.({ signal }),
      refreshTourDates?.({ signal }),
      session ? refreshMyAttendance?.({ signal }) : true,
    ]);
    return !results.some((result) => result.status === "rejected"
      || result.value === false
      || result.value == null);
  };
  // iOS Safari zooms the whole page in when you focus a text field smaller than
  // 16px, and does not cleanly zoom back out. Many of the app's inputs are 13-15px
  // by design, so every search/compose box was jerking the viewport on a phone,
  // which is the "zoom skewing" that got much worse with the player taking space.
  // The fix every site uses: force a 16px minimum on TOUCH devices only, so the
  // desktop keeps its designed sizes. `!important` is required because
  // react-native-web writes font-size as an inline style.
  useEffect(() => {
    if (!web || typeof document === "undefined") return;
    const id = "pit-ios-input-zoom-guard";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = "@media (pointer: coarse) { input, textarea, select { font-size: 16px !important; } }";
    document.head.appendChild(style);
  }, [web]);

  useEffect(() => {
    if (!MUSIC_PLAYER_ENABLED) return;
    if (!authReady) return;
    if (playerState.accountId !== playerAccountId) {
      const stored = web && playerAccountId ? load(PLAYER_STATE_STORAGE_KEY, null) : null;
      setPlayerState({ accountId: playerAccountId, player: restoreOwnedPlayerState(stored, playerAccountId) });
      setPlayerMinimized(true);
    }
  }, [authReady, playerAccountId, playerState.accountId, web]);
  useEffect(() => {
    if (!MUSIC_PLAYER_ENABLED) return;
    if (!web || !authReady || !playerStateIsScoped) return;
    remove("pit.player"); // scrub the legacy device-global queue
    const envelope = player ? ownedPlayerEnvelope(playerAccountId, player) : null;
    if (envelope) save(PLAYER_STATE_STORAGE_KEY, envelope);
    else remove(PLAYER_STATE_STORAGE_KEY);
  }, [authReady, player, playerAccountId, playerStateIsScoped, web]);
  const [acctOpen, setAcctOpen] = useState(false);
  // The reusable product guide remains available from the menu. New-account
  // setup is separate and keyed to private server state below, so it works on
  // web and native and can safely resume after an interrupted first sign-in.
  const [welcome, setWelcome] = useState(false);
  const [verificationPrompt, setVerificationPrompt] = useState(null);
  useEffect(() => {
    if (!session?.id || session.emailVerified !== false) setVerificationPrompt(null);
  }, [session?.id, session?.emailVerified]);
  // Reset links now put their bearer credential in the URL fragment so it never
  // reaches the HTTP server/CDN. Read old query links during their short expiry,
  // then scrub either form from browser history as soon as React mounts.
  const scrubSensitiveUrl = (kind) => {
    if (!web) return;
    const nextUrl = scrubSensitiveLinkToken(window.location, kind);
    try {
      window.history.replaceState({}, "", nextUrl);
    } catch {
      // If history mutation is unavailable, a reload is preferable to leaving
      // a reset/verification bearer credential visible in browser history.
      window.location.replace(nextUrl);
    }
  };
  const [resetToken, setResetToken] = useState(() => { try { return web ? readSensitiveLinkToken(window.location, "reset") : null; } catch { return null; } });
  const scrubResetUrl = () => scrubSensitiveUrl("reset");
  const clearResetUrl = () => { scrubResetUrl(); setResetToken(null); };
  useEffect(() => { if (resetToken) scrubResetUrl(); }, [resetToken]);
  // Unsubscribe: the emailed link only carries the token here. Opting out is the
  // explicit tap below, so a mail scanner following the link cannot silently
  // unsubscribe someone.
  const [unsubToken, setUnsubToken] = useState(() => { try { return web ? readSensitiveLinkToken(window.location, "unsubscribe") : null; } catch { return null; } });
  const scrubUnsubUrl = () => scrubSensitiveUrl("unsubscribe");
  const clearUnsubUrl = () => { scrubUnsubUrl(); setUnsubToken(null); };
  useEffect(() => { if (unsubToken) scrubUnsubUrl(); }, [unsubToken]);
  // Email verification: same shape as unsubscribe, and for the same reason. The
  // emailed link only delivers the token; confirming is the explicit tap, so a
  // scanner that follows the link cannot verify an address for its owner.
  const [verifyToken, setVerifyToken] = useState(() => { try { return web ? readSensitiveLinkToken(window.location, "verify") : null; } catch { return null; } });
  const scrubVerifyUrl = () => scrubSensitiveUrl("verify");
  const clearVerifyUrl = () => { scrubVerifyUrl(); setVerifyToken(null); };
  useEffect(() => { if (verifyToken) scrubVerifyUrl(); }, [verifyToken]);
  // Founder approvals use the same fragment-only bearer pattern. Capture it in
  // memory, remove it from browser history immediately, and never place it in a
  // navigation frame or analytics event.
  const [ownerApprovalToken, setOwnerApprovalToken] = useState(() => { try { return web ? readSensitiveFragmentToken(window.location, "ownerApproval") : null; } catch { return null; } });
  const scrubOwnerApprovalUrl = () => scrubSensitiveUrl("ownerApproval");
  const clearOwnerApprovalUrl = () => { scrubOwnerApprovalUrl(); setOwnerApprovalToken(null); };
  useEffect(() => { if (ownerApprovalToken) scrubOwnerApprovalUrl(); }, [ownerApprovalToken]);
  // A full web load of canonical `/` always begins at the opening screen until
  // the cookie handshake confirms an account. Explicit public entity URLs still
  // hydrate inside the app, and an Explore gesture dismisses landing for this
  // mounted visit. Native keeps its existing persisted continuity behavior.
  const [landing, setLanding] = useState(() => initialLandingState({
    web,
    pathname: web ? window.location.pathname : "",
    demoEnabled: ENABLE_DEMO_DATA,
    readPersisted: load,
  }));
  const lastAnalyticsScreenRef = useRef({ accountId: null, screen: null });
  useEffect(() => {
    const screen = analyticsScreenKey({ landing, tab, nav });
    const accountId = session?.id || null;
    const previous = lastAnalyticsScreenRef.current;
    if (screen === previous.screen && accountId === previous.accountId) return;
    track("screen_view", { screen, referrer: accountId === previous.accountId ? previous.screen || undefined : undefined });
    lastAnalyticsScreenRef.current = { accountId, screen };
  }, [landing, tab, nav, session?.id, track]);

  // Which nav frames are public, shareable pages. Everything else (composer,
  // settings, moderation) deliberately has no URL: those are sheets over the
  // page you were on, not destinations, and giving them addresses would put
  // half-finished drafts in someone's history.
  const pathForFrame = (frame) => publicFramePath(frame, {
    resolveArtistMeta: remoteArtistMeta,
    resolveUser: userById,
  });

  // Push a fresh screen onto the stack. On web we mirror it into browser history
  // so the hardware/browser Back button pops the same stack the in-app back
  // buttons do (both funnel through popstate below).
  const runAfterComposerClose = (action, cancel = () => {}) => {
    const guard = composerCloseGuardRef.current;
    if (guard) { guard({ proceed: action, cancel }); return; }
    action();
  };
  const commitGo = (candidate) => {
    const frame = prepareAvailableNavigationFrame(candidate);
    if (!frame) return;
    setStack((s) => [...s, frame]);
    if (web) {
      try {
        // The third argument is the whole point: it changes the address bar
        // without a navigation, so PlayerBar (a sibling of the content area)
        // is never unmounted and audio does not restart. Never use
        // location.href or a plain anchor here - that is a full page load,
        // which stops playback and re-parses the entire bundle.
        window.history.pushState({ pit: "nav" }, "", pathForFrame(frame) || undefined);
      } catch {
        // architecture: allow-empty-catch -- history mirroring is best effort; the in-memory stack remains authoritative.
      }
    }
  };
  // Swap the top screen without growing the stack — for lateral moves where the
  // previous screen shouldn't come back (menu → target, signup → pick-artists).
  const commitReplace = (candidate) => {
    const frame = prepareAvailableNavigationFrame(candidate);
    if (!frame) return;
    setStack((s) => [...s.slice(0, -1), frame]);
    if (web) {
      try { window.history.replaceState({ pit: "nav" }, "", pathForFrame(frame) || undefined); }
      catch {
        // architecture: allow-empty-catch -- history mirroring is best effort; the in-memory stack remains authoritative.
      }
    }
  };
  const go = (candidate) => {
    const current = stackRef.current[stackRef.current.length - 1];
    if (isComposerFrame(current) && isComposerFrame(candidate)) return;
    const transition = composerNavigationTransition(current);
    runAfterComposerClose(() => (transition === "replace" ? commitReplace(candidate) : commitGo(candidate)));
  };
  const replace = (frame) => runAfterComposerClose(() => commitReplace(frame));
  const requireAuth = (fn) => (session ? fn() : go({ auth: true }));
  // This is an affordance, not the security boundary: the server independently
  // rejects every protected mutation. Intercepting here keeps people out of a
  // composer that cannot publish and gives them a direct resend path instead of
  // a generic permission error.
  const requireVerifiedMutation = (intent, fn) => {
    const decision = verifiedMutationDecision(session);
    if (decision === "authenticate") { go({ auth: true }); return false; }
    if (decision === "verify") { setVerificationPrompt(intent || "default"); return false; }
    return fn();
  };
  const profileAction = profileManagementAction(session);
  const profileDestination = profileAction.destination;
  const profileManagementFrame = () => (profileDestination === "artistHub" ? { artistHub: true } : { editProfile: true });
  const openProfileManagement = () => (profileDestination === "artistHub"
    ? go(profileManagementFrame())
    : requireVerifiedMutation("profile", () => go(profileManagementFrame())));
  const replaceProfileManagement = () => (profileDestination === "artistHub"
    ? replace(profileManagementFrame())
    : requireVerifiedMutation("profile", () => replace(profileManagementFrame())));
  const publicIdentityFrame = (id, authoritativeUser = null) => {
    const targetId = String(id || "");
    const suppliedUser = authoritativeUser && String(authoritativeUser.id || "") === targetId
      ? authoritativeUser
      : null;
    const user = String(session?.id || "") === targetId ? session : suppliedUser || userById?.(id);
    const target = publicIdentityTarget(user || { id });
    return target.kind === "artist"
      ? { artistName: target.artistName }
      : { profileId: target.userId || id };
  };
  const popStack = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const requestComposerPop = (onCancel = () => {}) => {
    runAfterComposerClose(popStack, onCancel);
  };
  // Back one screen. On web, route through history.back() so the browser Back
  // button and in-app back share one code path (the popstate handler pops).
  const back = () => { if (web) { try { window.history.back(); return; } catch {} } requestComposerPop(); };
  // Successful mutations must close without re-running the dirty form prompt,
  // but still mirror the pop into browser history.
  const finishComposerBack = () => {
    if (web) {
      try {
        const marker = {};
        bypassNextPopRef.current = marker;
        window.history.back();
        setTimeout(() => { if (bypassNextPopRef.current === marker) bypassNextPopRef.current = null; }, 1000);
        return;
      } catch {
        bypassNextPopRef.current = null;
      }
    }
    popStack();
  };
  // Jump straight to the tab screens (after posting, tab switches, brand tap).
  const commitClear = () => {
    setStack([{}]);
    if (web) { try { window.history.replaceState({ pit: "root" }, "", "/"); } catch {} }
  };
  const clear = () => runAfterComposerClose(commitClear);
  const switchTab = (key) => runAfterComposerClose(() => {
    // Discover is a secondary, comparatively rich surface. Keep it out of the
    // first-load bundle, but start its guarded chunk request in the same user
    // gesture that selects the tab so the suspense state is as short as the
    // connection allows.
    if (key === "search") SearchScreen.preload?.().catch(() => { /* architecture: allow-empty-catch -- Tab intent warming is optional; Suspense owns visible loading and retry. */ });
    if (key === "discover") DiscoverScreen.preload?.().catch(() => { /* architecture: allow-empty-catch -- Tab intent warming is optional; Suspense owns visible loading and retry. */ });
    if (key === "you") YouScreen.preload?.().catch(() => { /* architecture: allow-empty-catch -- Tab intent warming is optional; Suspense owns visible loading and retry. */ });
    setTab(key);
    commitClear();
  });
  const openPublicDirectory = (directory, { region } = {}) => {
    if (directory !== "artists" && directory !== "events") return;
    runAfterComposerClose(() => {
      // architecture: allow-empty-catch -- Directory chunk preloading is optional; Suspense owns the visible loading and retry state.
      DiscoverScreen.preload?.().catch(() => {});
      setLanding(false);
      setTab("discover");
      commitGo({
        directory,
        ...(directory === "events" && region && region !== "Worldwide" ? { discoverRegion: region } : {}),
      });
    });
  };

  const updateComposerDraftIdentity = (composerId, draftId) => {
    if (!composerId) return;
    setStack((current) => {
      if (!isActiveComposer(current, composerId)) return current;
      const top = current[current.length - 1];
      const frame = { ...top, draftId: draftId || null };
      if (!web) save(ACTIVE_COMPOSER_KEY, frame);
      return [...current.slice(0, -1), frame];
    });
  };

  const consumePendingComposerPicker = (requestId) => {
    setPendingComposerPicker((current) => (current?.requestId === requestId ? null : current));
    const stored = load(PENDING_COMPOSER_PICKER_KEY, null);
    if (!requestId || stored?.requestId === requestId) remove(PENDING_COMPOSER_PICKER_KEY);
  };

  const enter = () => {
    setLanding(false);
    save("pit.entered", true);
    // Arm one history entry so browser Back from the app root returns to landing.
    if (web) { try { window.history.pushState({ pit: "app" }, ""); } catch {} }
  };
  const stopAndClearPlayback = () => {
    setPlayer(null);
    // Back to the slim idle rail: an empty expanded column is just dead space.
    setPlayerMinimized(true);
    if (web) {
      remove("pit.player");
      remove(PLAYER_STATE_STORAGE_KEY);
      remove("pit.playpos");
      remove(PLAYER_POSITION_STORAGE_KEY);
    }
  };
  const commitExitToLanding = () => {
    stopAndClearPlayback();
    save("pit.entered", false);
    setTab("feed");
    setStack([{}]);
    setLanding(true);
  };
  const exitToLanding = () => runAfterComposerClose(commitExitToLanding);
  const signOut = () => runAfterComposerClose(() => { logout(); commitExitToLanding(); });
  const onAccountDeleted = () => {
    commitExitToLanding();
  };

  // An origin-wide cookie can change in another tab. Store locks the private
  // data plane while `/api/me` is checked; once that boundary is authoritative,
  // discard any screen-local composer/viewer state before the A -> guest/B
  // commit can paint. Routine A -> A focus validation leaves the workspace intact.
  const confirmedNavigationAccountRef = useRef(session?.id || null);
  useLayoutEffect(() => {
    if (!authReady) return;
    const nextAccountId = session?.id || null;
    configureDiagnosticsIdentity(nextAccountId);
    const previousAccountId = confirmedNavigationAccountRef.current;
    confirmedNavigationAccountRef.current = nextAccountId;
    if (!previousAccountId || previousAccountId === nextAccountId) return;

    composerCloseGuardRef.current = null;
    bypassNextPopRef.current = null;
    setPendingComposerPicker(null);
    remove(ACTIVE_COMPOSER_KEY);
    remove(PENDING_COMPOSER_PICKER_KEY);
    stopAndClearPlayback();
    setPreview(null);
    setWelcome(false);
    setVerificationPrompt(null);
    setAcctOpen(false);
    setTab("feed");
    setStack([{}]);
    if (!nextAccountId) {
      save("pit.entered", false);
      setLanding(true);
    }
  }, [authReady, session?.id]);

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
      if (stackRef.current.length > 1) {
        if (bypassNextPopRef.current) {
          bypassNextPopRef.current = null;
          popStack();
        } else {
          // The browser already moved back one history entry. If the composer
          // declines, restore the entry so the stack and browser stay aligned.
          requestComposerPop(() => {
            try { window.history.pushState({ pit: "nav" }, ""); } catch {}
          });
        }
      }
      else if (!sessionRef.current) setLanding(true);
      else { try { window.history.pushState({ pit: "root" }, ""); } catch {} }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Open whatever URL the visitor arrived on. Runs once: a shared link, a search
  // result, or a refresh must land on the page it names rather than the home
  // feed. The server already served the right metadata for this path; this is
  // what makes the app agree with it.
  //
  // Resolution is server-side (`/api/resolve`) because a root slug like
  // "/turnstile" is ambiguous between a handle, an artist and a venue, and the
  // client has no way to settle that without the catalogue. Doing it in one
  // place also guarantees a crawler and a visitor get the same page.
  useEffect(() => {
    if (!web) return;
    let cancelled = false;
    const path = window.location.pathname;
    if (!path || path === "/") return;
    const collectionHydration = publicCollectionHydration(path);
    if (collectionHydration) {
      setLanding(false);
      (async () => {
        try {
          const entity = await resolvePublicEntity(collectionHydration.resolvePath);
          const frame = resolvedPublicCollectionFrame(collectionHydration, entity);
          if (cancelled || !frame) return;
          setStack([{}, frame]);
          try { window.history.pushState({ pit: "nav" }, "", path); } catch {
            // architecture: allow-empty-catch -- app state already owns the resolved public archive.
          }
        } catch {
          // architecture: allow-empty-catch -- server-rendered archive content remains visible when client hydration is unavailable.
        }
      })();
      return () => { cancelled = true; };
    }
    if (path === "/artists" || path === "/events") {
      setLanding(false);
      setTab("discover");
      setStack([{}, { directory: path.slice(1) }]);
      try { window.history.pushState({ pit: "nav" }, "", path); } catch {
        // architecture: allow-empty-catch -- History is a best-effort web enhancement; app state already owns the requested directory.
      }
      return;
    }
    if (!isPublicEntityPath(path)) return;
    (async () => {
      try {
        const entity = await resolvePublicEntity(path);
        if (cancelled || !entity) return;
        // Land inside the app, not on the marketing page: someone following a
        // link to a band wants the band.
        setLanding(false);
        if (entity.kind === "artist") {
          const canonical = parsePath(entity.path);
          setStack([{}, {
            artistName: entity.name,
            ...(canonical?.type === "artist" ? { artistPublicSlug: canonical.value } : {}),
          }]);
        }
        else if (entity.kind === "venue") setStack([{}, {
          venueName: entity.name,
          venue: {
            name: entity.name,
            providerVenueId: entity.providerVenueId || entity.venue_provider_id || null,
            source: entity.source || null,
          },
        }]);
        else if (entity.kind === "profile") {
          const targetId = String(entity.id || "");
          const knownUser = String(sessionRef.current?.id || "") === targetId
            ? sessionRef.current
            : userById?.(entity.id);
          // `/@handle` links resolve before the people cache is guaranteed to be
          // warm. Carry the authoritative public user through this navigation so
          // a named artist cannot briefly reopen the duplicate member profile.
          const resolvedUser = knownUser || (await loadUser(entity.id))?.user || null;
          if (!cancelled) setStack([{}, publicIdentityFrame(entity.id, resolvedUser)]);
        }
        else if (entity.kind === "show") {
          const post = await readPublicPost(entity.id).catch(() => null);
          if (!cancelled && post) setStack([{}, post.kind === "status" || isOnlineReview(post) ? { post } : { openLog: post }]);
        }
        else if (entity.kind === "event" || entity.kind === "concert") {
          setStack([{}, { openLog: { ...entity, performanceEvent: true } }]);
        }
        // One history entry for the opened screen, so Back returns to the feed
        // rather than leaving the site.
        if (!cancelled) { try { window.history.pushState({ pit: "nav" }, "", path); } catch {} }
      } catch {
        // An unresolvable link just opens the app; the URL is left alone so it
        // can be read or corrected rather than silently rewritten.
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Android hardware back: pop the stack when we have somewhere to go.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stackRef.current.length > 1) { requestComposerPop(); return true; }
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

  const musicPreviewAction = MUSIC_PLAYER_ENABLED ? showPreview : undefined;
  const openReport = (candidate) => requireVerifiedMutation("report", () => {
    if (!candidate) return;
    const target = candidate.targetType && candidate.targetId
      ? candidate
      : candidate.id
        ? {
            targetType: "post",
            targetId: candidate.id,
            ownerId: candidate.userId || null,
            targetName: "post",
            title: [candidate.artist, candidate.user?.name ? `by ${candidate.user.name}` : ""].filter(Boolean).join(" - ") || "Selected post",
            summary: candidate.review || "This report covers the selected post and its attachments.",
          }
        : null;
    if (!target?.targetId || (target.ownerId && target.ownerId === session?.id)) return;
    go({ reporting: target });
  });

  const onAddLog = async (log) => {
    const composerId = nav.composerId;
    const result = await addLog(log);
    if (result?.ok === false) return result;
    // A response can arrive after the user has left or another composer has
    // opened. Publish still succeeded, but that stale operation no longer owns
    // navigation and must not pull the user away from their current screen.
    if (isActiveComposer(stackRef.current, composerId)) {
      const calendarFocus = calendarFocusForPost(result?.post, new Date());
      if (calendarFocus) {
        CalendarScreen.preload?.().catch(() => { /* architecture: allow-empty-catch -- Calendar chunk preloading is optional; the mounted screen owns its visible loading state */ });
        // Replace the completed composer with the exact saved night. The
        // canonical post already updated profile history, so Calendar can show
        // it immediately without a second write or a fragile local-only flag.
        commitReplace({
          calendar: true,
          calendarDate: calendarFocus.date,
          calendarView: calendarFocus.view,
        });
      } else {
        // Ordinary text/photo statuses have no show identity and keep the
        // familiar feed destination; they are never blocked by Calendar rules.
        commitClear();
        setTab("feed");
      }
    }
    return result;
  };
  const onEditLog = async (log) => {
    const target = nav.editingPost;
    const composerId = nav.composerId;
    if (!target?.id) return { ok: false };
    const result = await editLog(target, log);
    if (result?.ok && isActiveComposer(stackRef.current, composerId)) finishComposerBack();
    return result;
  };

  const openProfile = (id, authoritativeUser = null) => go(publicIdentityFrame(id, authoritativeUser));
  const openProfileByHandle = async (h) => {
    const u = userByHandle(h);
    if (u) return openProfile(u.id, u);
    // Unknown handle (an @mention of someone this device never cached): look them
    // up on the server instead of silently doing nothing.
    const found = await searchPeople(h);
    const hit = (found || []).find((x) => x.handle === h);
    if (hit) openProfile(hit.id, hit);
  };
  const openPost = (log, analytics = {}) => {
    if (!log) return;
    track("content_open", {
      postId: log.id,
      surface: analytics.surface || "direct",
      ...(Number.isSafeInteger(analytics.position) ? { position: analytics.position } : {}),
    });
    go({ post: log });
  };
  // Ordinary statuses open their discussion. A Going ticket can instead pass
  // the exact performance projection produced by calendarShowFromPost.
  const openShow = (log, analytics = {}) => {
    if (!log) return;
    if ((log.kind === "status" && log.performanceEvent !== true) || isOnlineReview(log)) return openPost(log, analytics);
    const navigation = prepareShowNavigation(log);
    if (!navigation) return;
    const { destination } = navigation;
    if (navigation.kind === "performance") {
      // Provider ids and opaque archive keys are not Pit post ids. Keep them out
      // of post analytics; the categorical view measures performance-page use.
      track("view_performance");
    } else {
      track("content_open", {
        postId: navigation.postId,
        surface: analytics.surface || "direct",
        ...(Number.isSafeInteger(analytics.position) ? { position: analytics.position } : {}),
      });
      track("view_show", { postId: navigation.postId });
    }
    go({ openLog: destination });
  };
  const openPostEditor = (log) => requireVerifiedMutation("post", () => { if (log?.id) go({ editingPost: log }); });
  const openBadges = (userId) => go({ badges: { userId } });
  const openArtist = (artist) => {
    const payload = artist && typeof artist === "object" ? artist : null;
    const name = String(payload?.name || artist || "").trim();
    if (!name) return;
    track("view_artist");
    go({
      artistName: name,
      ...(payload?.publicSlug ? { artistPublicSlug: payload.publicSlug } : {}),
    });
  };
  const openArtistArchive = (name, artistKey = null, publicSlug = null) => {
    if (!name) return;
    track("view_artist_archive");
    const cachedArtist = remoteArtistMeta?.(name);
    const resolvedArtistKey = artistKey || cachedArtist?.key || cachedArtist?.norm || null;
    const resolvedPublicSlug = publicSlug || cachedArtist?.publicSlug || null;
    go({ artistArchive: { name, artistKey: resolvedArtistKey, ...(resolvedPublicSlug ? { publicSlug: resolvedPublicSlug } : {}) } });
  };
  const openArtistTour = (name, artistKey, tour) => {
    if (!name || !tour?.key) return;
    track("view_artist_tour");
    go({ artistTour: { name, artistKey: artistKey || null, tourKey: tour.key, tourName: tour.name || "Live tour" } });
  };
  const openVenue = (venue) => {
    const payload = venue && typeof venue === "object" ? venue : null;
    const name = String(payload?.name || venue || "").trim();
    if (!name) return;
    track("view_venue");
    go({ venueName: name, ...(payload ? { venue: payload } : {}) });
  };
  const openFanClub = (artist) => go({ fanClub: artist });
  // Open the persistent top player. `queue` (optional) is a list of tracks so the
  // bar can skip prev/next; without it, a single track. player = { list, index }.
  const openPlayer = (media, queue) => {
    if (!MUSIC_PLAYER_ENABLED) return;
    if (!media) return;
    // Always continue past the explicit queue with genre/taste-based recommendations
    // so "up next" is populated and playback never dead-ends after one song.
    let base = Array.isArray(queue) && queue.length ? queue : [media];
    // The tapped track MUST be what plays: if it's not in the queue it was handed
    // (e.g. an album track played against the top-tracks queue), put it first.
    if (!base.some((m) => trackKey(m) === trackKey(media))) base = [media, ...base];
    const list = playerQueueWithEntryIds(autoplayQueue(media, base));
    const index = Math.max(0, list.findIndex((m) => trackKey(m) === trackKey(media)));
    setPlayerMinimized(false);
    setPlayer({
      list,
      explicitCount: Math.min(base.length, list.length),
      index,
      playbackIntent: playerLookupIntent(list[index], "explicit"),
    });
  };
  const musicPlayerAction = MUSIC_PLAYER_ENABLED ? openPlayer : undefined;
  const setPlayerIndex = (i, { trigger = "explicit" } = {}) => setPlayer((p) => {
    if (!p) return p;
    const idx = Math.max(0, Math.min(i, p.list.length - 1));
    return {
      ...p,
      index: idx,
      playbackIntent: playerLookupIntent(p.list[idx], trigger),
    };
  });
  // Queue edits from the up-next panel: jump to, remove, or move a track to next.
  const playAt = (i) => setPlayerIndex(i);
  const removeFromQueue = (i) => setPlayer((p) => {
    if (!p || i === p.index) return p;
    const list = p.list.filter((_, j) => j !== i);
    const index = i < p.index ? p.index - 1 : p.index;
    const explicitCount = Math.max(0, (p.explicitCount ?? p.list.length) - (i < (p.explicitCount ?? p.list.length) ? 1 : 0));
    return { ...p, list, index, explicitCount };
  });
  const moveToNext = (i) => setPlayer((p) => {
    if (!p || i === p.index) return p;
    const item = p.list[i];
    const rest = p.list.filter((_, j) => j !== i);
    const curPos = rest.indexOf(p.list[p.index]);
    rest.splice(curPos + 1, 0, item);
    return { ...p, list: rest, index: curPos };
  });
  const restorePlayer = () => {
    // Restoring is an explicit listener action. Upgrade legacy/restored player
    // envelopes with an occurrence-bound intent before PlayerBar resolves it.
    setPlayer((p) => {
      if (!p?.list?.length) return p;
      const idx = Math.max(0, Math.min(p.index || 0, p.list.length - 1));
      return { ...p, playbackIntent: playerLookupIntent(p.list[idx], "explicit") };
    });
    setPlayerMinimized(false);
  };
  const openPhotos = (images, index = 0, postId = null, opener = null) => {
    if (web && typeof document !== "undefined") {
      mediaViewerFocusGenerationRef.current += 1;
      const capturedOpener = opener?.focus ? opener : document.activeElement;
      mediaViewerOpenerRef.current = capturedOpener;
      mediaViewerOpenerIdentityRef.current = {
        id: capturedOpener?.id || null,
        label: capturedOpener?.getAttribute?.("aria-label") || null,
      };
    }
    go({ photos: { images, index, postId } });
  };
  const openAddToPlaylist = (track) => {
    if (!MUSIC_PLAYER_ENABLED) return;
    requireVerifiedMutation("playlist", () => go({ addToPlaylist: track }));
  };
  const openArtistGallery = (name, artistKey = null, legacyMode = false) => {
    if (!name) return;
    track("view_artist_gallery");
    go({ artistGallery: { name, artistKey: artistKey || null, legacyMode: legacyMode === true } });
  };
  const musicPlaylistAction = MUSIC_PLAYER_ENABLED ? openAddToPlaylist : undefined;
  const musicListeningHistoryAction = MUSIC_PLAYER_ENABLED ? () => go({ listeningHistory: true }) : undefined;
  const openFollowList = (userId, mode) => go({ followList: { userId, mode } });
  const reviewShow = (log) => requireVerifiedMutation("review", () => go({
    logging: true,
    prefill: {
      artist: log.artist,
      artistKey: log.artistKey || null,
      venue: log.venue,
      city: log.city,
      date: log.date || null,
      tour: log.tourName || log.tour || "",
      officialEventName: log.eventName || null,
      officialEventSource: log.source || null,
      tourDateId: log.tourDateId || log.id || null,
    },
  }));
  const openInbox = () => requireAuth(() => go({ inbox: true }));
  const openNotifications = () => requireAuth(() => go({ notifications: true }));
  const openThread = (otherId) => requireAuth(() => go({ thread: otherId }));
  const openVenueReview = (name) => requireVerifiedMutation("review", () => go({ venueReview: name }));
  const removePostTag = (postId) => requireVerifiedMutation("interact", () => removeMyPostTag(postId));

  let overlay = null;
  // Auth is a modal that must win over any page overlay — requireAuth() can fire
  // from inside a venue/show/profile page, and the login sheet has to surface.
  if (nav.photos) overlay = <PhotoViewer photos={nav.photos.images} index={nav.photos.index} postId={nav.photos.postId} returnFocusRef={mediaViewerOpenerRef} session={session} mediaReactions={mediaReactions} loadMediaReactions={loadMediaReactions} toggleMediaReaction={toggleMediaReaction} track={track} onReport={openReport} onClose={back} />;
  else if (MUSIC_PLAYER_ENABLED && nav.addToPlaylist) overlay = <PlaylistPickerScreen track={nav.addToPlaylist} onClose={back} />;
  else if (nav.followList) overlay = <FollowListScreen userId={nav.followList.userId} mode={nav.followList.mode} onClose={back} onOpenProfile={openProfile} />;
  else if (nav.auth) overlay = <AuthScreen initialMode={nav.authMode} onDone={back} onCancel={back} />;
  else if (nav.pickArtists) overlay = <PickArtistsScreen onDone={clear} onSkip={clear} onRequireVerification={() => setVerificationPrompt("artistPicks")} />;
  else if (nav.editingPost) overlay = <LogScreen user={session} editing={nav.editingPost} composerId={nav.composerId} initialDraftId={nav.draftId} onDraftIdentity={updateComposerDraftIdentity} pendingMedia={pendingComposerPicker?.composerId === nav.composerId ? pendingComposerPicker : null} onPendingMediaConsumed={consumePendingComposerPicker} onPost={onEditLog} onCancel={back} closeGuardRef={composerCloseGuardRef} />;
  else if (nav.logging) overlay = <LogScreen user={session} prefill={nav.prefill} defaultMode={nav.postMode || "show"} legacyArtistProfile={nav.legacyArtistProfile === true} composerId={nav.composerId} initialDraftId={nav.draftId} onDraftIdentity={updateComposerDraftIdentity} pendingMedia={pendingComposerPicker?.composerId === nav.composerId ? pendingComposerPicker : null} onPendingMediaConsumed={consumePendingComposerPicker} onPost={onAddLog} onCancel={back} closeGuardRef={composerCloseGuardRef} />;
  else if (nav.reporting) overlay = <ReportScreen target={nav.reporting} onClose={back} />;
  else if (nav.editProfile) overlay = <EditProfileScreen onClose={back} />;
  else if (nav.venueReview) overlay = <VenueReviewScreen venueName={nav.venueReview} onClose={back} />;
  else if (nav.thread) overlay = <ThreadScreen otherId={nav.thread} onClose={back} onOpenProfile={openProfile} onOpenProfileByHandle={openProfileByHandle} onReport={openReport} />;
  else if (nav.inbox) overlay = <InboxScreen onClose={back} onOpenThread={openThread} />;
  else if (MUSIC_PLAYER_ENABLED && nav.listeningHistory) overlay = <ListeningHistoryScreen onClose={back} onPlay={musicPlayerAction} />;
  else if (nav.notifications) overlay = <NotificationsScreen onClose={back} onOpenProfile={openProfile} onOpenThread={openThread} onOpen={openShow} onOpenPost={openPost} />;
  else if (nav.calendar) overlay = <CalendarScreen initialDate={nav.calendarDate} initialView={nav.calendarView} onClose={back} onOpen={openShow} onOpenArtist={openArtist} />;
  else if (ENABLE_CLIPS && nav.clips) overlay = <ClipsScreen onClose={back} onOpenPost={openPost} onOpenProfile={openProfile} onOpenArtist={openArtist} onRequireAuth={() => go({ auth: true })} />;
  else if (nav.profileId) overlay = <ProfileScreen userId={nav.profileId} onClose={back} onOpenShow={openShow} onOpenPost={openPost} onOpenProfile={openProfile} onOpenArtist={openArtist} onOpenArtistArchive={openArtistArchive} onOpenVenue={openVenue} onManageProfile={openProfileManagement} onPreview={musicPreviewAction} onMessage={openThread} onReport={openReport} onEditPost={openPostEditor} onOpenPhotos={openPhotos} onPlay={musicPlayerAction} onRemoveMyPostTag={removePostTag} onOpenFollowList={openFollowList} onOpenBadges={openBadges} />;
  else if (nav.fanClub) overlay = <FanClubScreen artist={nav.fanClub} onClose={back} onOpenProfile={openProfile} onOpenProfileByHandle={openProfileByHandle} onReport={openReport} />;
  else if (nav.artistHub) overlay = <ArtistHubScreen onClose={back} onPreview={(name) => name && go({ artistPreview: name })} onEditPage={(name) => name && requireVerifiedMutation("artist", () => go({ editArtist: name }))} onEditAccount={() => requireVerifiedMutation("profile", () => go({ editProfile: true }))} onTourDates={() => requireVerifiedMutation("artist", () => go({ bulk: true }))} onCampaignPost={() => requireVerifiedMutation("artist", () => go({ logging: true, postMode: "campaign" }))} onPlay={musicPlayerAction} />;
  else if (nav.artistGallery) overlay = <ArtistGalleryScreen artistName={nav.artistGallery.name} artistKey={nav.artistGallery.artistKey} legacyMode={nav.artistGallery.legacyMode === true} onClose={back} onOpenPhotos={openPhotos} />;
  else if (nav.artistPreview) overlay = <ArtistScreen artistName={nav.artistPreview} previewAsFan onClose={back} onOpenPost={openPost} onOpenShow={openShow} onOpenArchive={openArtistArchive} onOpenVenue={openVenue} onOpenFanClub={openFanClub} onOpenPhotos={openPhotos} onOpenGallery={openArtistGallery} onOpenProfile={openProfile} onPlay={musicPlayerAction} onAddToPlaylist={musicPlaylistAction} />;
  else if (nav.editArtist) overlay = <EditArtistProfileScreen artistName={nav.editArtist} onClose={back} />;
  else if (nav.artistArchive) overlay = <ArtistArchiveScreen artistName={nav.artistArchive.name} artistKey={nav.artistArchive.artistKey} onClose={back} onOpenShow={openShow} onOpenTour={(tour, resolvedArtistKey) => openArtistTour(nav.artistArchive.name, resolvedArtistKey || nav.artistArchive.artistKey, tour)} onOpenPhotos={openPhotos} onOpenProfile={openProfile} />;
  else if (nav.artistTour) overlay = <TourArchiveScreen artistName={nav.artistTour.name} artistKey={nav.artistTour.artistKey} tourKey={nav.artistTour.tourKey} tourName={nav.artistTour.tourName} onClose={back} onOpenShow={openShow} onOpenPost={openPost} onOpenPhotos={openPhotos} onOpenProfile={openProfile} />;
  else if (nav.artistName) overlay = <ArtistScreen artistName={nav.artistName} onClose={back} onOpenPost={openPost} onOpenShow={openShow} onOpenArchive={openArtistArchive} onOpenVenue={openVenue} onOpenFanClub={openFanClub} onShareMemory={(name, artistKey, options = {}) => requireVerifiedMutation("post", () => go({ logging: true, postMode: "memory", legacyArtistProfile: options.legacyProfile === true, prefill: { artist: name, artistKey } }))} onOpenPhotos={openPhotos} onOpenGallery={openArtistGallery} onOpenProfile={openProfile} onManageArtistProfile={() => go({ artistHub: true })} onEditArtistProfile={(name) => name && requireVerifiedMutation("artist", () => go({ editArtist: name }))} onPlay={musicPlayerAction} onAddToPlaylist={musicPlaylistAction} onReport={openReport} />;
  else if (nav.venueName) overlay = <VenueScreen venueName={nav.venueName} venueIdentity={nav.venue || null} onClose={back} onOpenShow={openShow} onOpenArtist={openArtist} onOpenVenue={openVenue} onReviewVenue={openVenueReview} onOpenProfile={openProfile} onOpenPhotos={openPhotos} onReport={openReport} />;
  else if (nav.nearby) overlay = <NearbyScreen onClose={back} onOpenVenue={openVenue} onOpenArtist={openArtist} />;
  else if (nav.venues) overlay = <VenuesScreen initialRegion={nav.discoverRegion} onClose={back} onOpenVenue={openVenue} />;
  else if (nav.fanClubs) overlay = <FanClubsScreen onClose={back} onOpenFanClub={openFanClub} />;
  else if (nav.suggestion) overlay = <SuggestionBoxScreen onClose={back} initialSurface={nav.suggestion.surface} />;
  else if (nav.settings) overlay = <SettingsScreen onClose={back} onManageProfile={openProfileManagement} onOpenProfile={() => (session ? openProfile(session.id) : go({ auth: true }))} onOpenPrivacy={() => go({ privacy: true })} onOpenTerms={() => go({ terms: true })} onOpenDiagnostics={() => { if (canViewDiagnostics) go({ diagnostics: true }); }} onOpenDeleteAccount={() => go({ deleteAccount: true })} onLogout={signOut} />;
  else if (nav.deleteAccount) overlay = <DeleteAccountScreen onClose={back} onDeleted={onAccountDeleted} />;
  else if (nav.diagnostics && canViewDiagnostics) overlay = <DiagnosticsScreen onClose={back} />;
  else if (nav.privacy) overlay = <PrivacyScreen onClose={back} />;
  else if (nav.terms) overlay = <TermsScreen onClose={back} />;
  else if (nav.lounge) overlay = <LoungeScreen log={nav.lounge} onClose={back} onOpenProfile={openProfile} onOpenProfileByHandle={openProfileByHandle} onOpenFanClub={openFanClub} onReport={openReport} />;
  else if (nav.openLog) overlay = <ShowScreen log={nav.openLog} onClose={back} onPreview={musicPreviewAction} onReview={reviewShow} onOpenProfile={openProfile} onOpenArtist={openArtist} onOpenArchive={openArtistArchive} onOpenVenue={openVenue} onOpenLounge={(log) => go({ lounge: log })} onOpenPost={openPost} onOpenPhotos={openPhotos} onRequireAuth={() => go({ auth: true })} />;
  else if (nav.post) overlay = <PostScreen log={nav.post} onClose={back} onOpenProfile={openProfile} onOpenArtist={openArtist} onOpenArtistArchive={openArtistArchive} onOpenVenue={openVenue} onOpenShow={openShow} onReport={openReport} onEdit={openPostEditor} onOpenPhotos={openPhotos} onPlay={musicPlayerAction} onRemoveMyPostTag={removePostTag} />;
  else if (nav.badges) overlay = <BadgeLegendScreen userId={nav.badges.userId} onClose={back} />;
  else if (nav.topRated) overlay = <TopRatedScreen initialRegion={nav.discoverRegion} onClose={back} onOpen={openShow} />;
  else if (nav.admin) overlay = <AdminScreen onClose={back} />;
  else if (nav.bulk) overlay = <BulkTourDatesScreen onClose={back} />;
  else if (nav.reqArtist) overlay = <RequestArtistScreen onClose={back} />;
  else if (nav.menu) overlay = (
    <MenuScreen
      onClose={back}
      onNear={() => replace({ nearby: true })}
      onVenues={() => replace({ venues: true })}
      onFanClubs={() => replace({ fanClubs: true })}
      onTopRated={() => replace({ topRated: true })}
      onInbox={() => requireAuth(() => replace({ inbox: true }))}
      onActivity={() => requireAuth(() => replace({ notifications: true }))}
      onSuggestion={() => replace({ suggestion: { surface: "menu" } })}
      onProfile={() => session && replace(publicIdentityFrame(session.id))}
      onManageProfile={replaceProfileManagement}
      onSettings={() => replace({ settings: true })}
      onAdmin={() => replace({ admin: true })}
      onTourDates={() => requireVerifiedMutation("artist", () => replace({ bulk: true }))}
      onRequestArtist={() => requireVerifiedMutation("artist", () => replace({ reqArtist: true }))}
      onHowItWorks={() => setWelcome(true)}
      onLogin={() => replace({ auth: true })}
      onLogout={signOut}
      onBackToLanding={exitToLanding}
    />
  );

  const hydratedPublicLinks = publicNavigationLinks(nav, { resolveUser: userById });
  const showMobilePublicTrail = shouldShowMobilePublicTrail(nav);
  const hydratedDirectoryArtists = nav.directory === "artists"
    ? [
      ...(Array.isArray(discoverySidebar?.topArtists) ? discoverySidebar.topArtists : []),
      ...(typeof topArtists === "function" ? topArtists(12) : []),
    ].filter((artist, index, rows) => {
      const href = artistPath(artist);
      return !!href && rows.findIndex((candidate) => artistPath(candidate) === href) === index;
    }).slice(0, 10)
    : [];
  const hydratedDirectoryEvents = nav.directory === "events"
    ? filterDiscoverSceneRows([
      ...(Array.isArray(tourDates) ? tourDates : []),
      ...(Array.isArray(discoverySidebar?.upcomingEvents) ? discoverySidebar.upcomingEvents : []),
      ...(typeof upcomingEvents === "function" ? upcomingEvents(12) : []),
    ].filter((event, index, rows) => {
      const href = eventPath(event);
      return !!href && rows.findIndex((candidate) => eventPath(candidate) === href) === index;
    }), {
      region: nav.discoverRegion || "Worldwide",
      countryForCity,
      limit: 10,
    })
    : [];
  const openHydratedPublicTarget = (target) => {
    if (!target) return;
    if (target.type === "home") { switchTab("feed"); return; }
    if (target.type === "directory") { openPublicDirectory(target.value); return; }
    if (target.type === "artist") { openArtist(target.value); return; }
    if (target.type === "venue") { openVenue(target.value); return; }
    if (target.type === "event") { openShow(target.value); return; }
    if (target.type === "profile") openProfile(target.value);
  };

  const status = session ? accountStatus(session) : "ok";

  const tabScreens = (
            <View style={styles.screen}>
              {tab === "feed" && (
                <FeedScreen
                  feed={feed}
                  followingFeed={following}
                  localFeed={local}
                  loggedIn={!!session}
                  accountId={session?.id || null}
                  homeCity={session?.home?.city}
                  unread={inboxUnread()}
                  notifUnread={session ? unreadNotifications() : 0}
                  hideHeaderActions={wide}
                  newUser={!!session && feed.filter((l) => l.userId === session.id).length === 0}
                  onRefresh={refreshHomeFeedData}
                  onLoadMore={loadMoreFeed}
                  hasMore={feedHasMore}
                  loadingMore={feedLoadingMore}
                  countdownPlan={homeCountdown}
                  showHomeCountdown={!!session && !showRightRail}
                  suggestedUsers={discoverySidebar?.suggestedUsers || []}
                  suggestedUsersLoading={discoverySidebarStatus === "loading"}
                  showSuggestedPitters={!!session && !showRightRail}
                  onFollowUser={follow}
                  isFollowing={isFollowing}
                  isBlocked={isBlocked}
                  onOpenCountdown={openShow}
                  onViewAllCountdown={() => go({ calendar: true })}
                  onLogShow={() => requireVerifiedMutation("review", () => go({ logging: true }))}
                  onOpenDiscover={() => switchTab("discover")}
                  onOpenInbox={openInbox}
                  onOpenNotifications={openNotifications}
                  onOpen={openShow}
                  onImpression={(log, position, surface) => {
                    recordFeedImpressionForSession(session, {
                      postId: log?.id,
                      surface: surface === "everyone" ? "for_you" : surface,
                    });
                    track("feed_impression", {
                      postId: log?.id,
                      position,
                      surface,
                      algorithm: log?.recommendation?.algorithm || "chronological-v1",
                      algorithmVersion: log?.recommendation?.algorithmVersion || 1,
                      reasonCode: log?.recommendation?.reasonCode,
                    });
                  }}
                  onDwell={(log, milliseconds, surface) => track("content_dwell", {
                    postId: log?.id,
                    durationBucket: analyticsDwellBucket(milliseconds),
                    surface,
                  })}
                  onNotInterested={(log) => requireVerifiedMutation("interact", () => notInterested(log?.id))}
                  onUndoNotInterested={(log) => requireVerifiedMutation("interact", () => undoNotInterested(log?.id))}
                  onComment={openPost}
                  onPreview={musicPreviewAction}
                  onOpenProfile={openProfile}
                  onOpenArtist={openArtist}
                  onOpenArtistArchive={openArtistArchive}
                  onOpenVenue={openVenue}
                  onOpenNearby={() => go({ nearby: true })}
                  onOpenMenu={() => go({ menu: true })}
                  onOpenClips={ENABLE_CLIPS ? () => go({ clips: true }) : undefined}
                  onReport={openReport}
                  onEdit={openPostEditor}
                  onOpenPhotos={openPhotos}
                  onPlay={musicPlayerAction}
                  onRemoveMyPostTag={removePostTag}
                />
              )}
              {tab === "search" && <SearchScreen onOpen={openShow} onOpenArtist={openArtist} onOpenVenue={openVenue} onOpenFanClub={openFanClub} onOpenProfile={openProfile} onPlay={musicPlayerAction} onAddToPlaylist={musicPlaylistAction} />}
              {tab === "discover" && <DiscoverScreen onOpenTopRated={(discoverRegion) => go({ topRated: true, discoverRegion })} onOpenEvents={(discoverRegion) => openPublicDirectory("events", { region: discoverRegion })} onOpen={openShow} onOpenArtist={openArtist} onOpenVenue={openVenue} onOpenNearby={() => go({ nearby: true })} onOpenFanClubs={() => go({ fanClubs: true })} onOpenVenues={(discoverRegion) => go({ venues: true, discoverRegion })} onOpenLounge={(lounge) => go({ lounge })} onOpenPhotos={openPhotos} onPlay={musicPlayerAction} onAddToPlaylist={musicPlaylistAction} onOpenProfile={openProfile} />}
              {tab === "you" && (
                <YouScreen
                  onLogin={() => go({ auth: true })}
                  onLogout={signOut}
                  onAdmin={() => go({ admin: true })}
                  onRequestArtist={() => requireVerifiedMutation("artist", () => go({ reqArtist: true }))}
                  onManageProfile={openProfileManagement}
                  onSettings={() => go({ settings: true })}
                  onOpenProfile={openProfile}
                  onOpenArtist={openArtist}
                  onOpen={openShow}
                  onOpenPost={openPost}
                  onActivity={openNotifications}
                  onInbox={openInbox}
                  onCalendar={() => go({ calendar: true })}
                  onListeningHistory={musicListeningHistoryAction}
                  onOpenNearby={() => go({ nearby: true })}
                  homeCity={session?.home?.city}
                  onPlay={musicPlayerAction}
                  onOpenArtist={openArtist}
                />
              )}
            </View>
  );

  // Desktop: the player owns a persistent left column (outside this routed
  // surface), while navigation sits across the content that actually changes.
  const desktop = (
    <View style={styles.deskOuter}>
      <DesktopTopNav
        tab={tab}
        setTab={switchTab}
        session={session}
        unread={session ? inboxUnread() : 0}
        notifUnread={session ? unreadNotifications() : 0}
        compact={width < 1500}
        onHome={() => switchTab("feed")}
        onLogIntent={preloadComposer}
        onLog={() => requireVerifiedMutation("post", () => go({ logging: true, postMode: "status" }))}
        onActivity={openNotifications}
        onInbox={openInbox}
        onClips={ENABLE_CLIPS ? () => go({ clips: true }) : undefined}
        onMenu={() => go({ menu: true })}
        onAccount={() => setAcctOpen(true)}
        onIntro={exitToLanding}
        onLogin={() => go({ auth: true, authMode: "login" })}
        onSignup={() => go({ auth: true, authMode: "signup" })}
      />
      <PublicWebTrail links={hydratedPublicLinks} onNavigate={openHydratedPublicTarget} />
      <View style={styles.deskWrap}>
        <View style={styles.deskCenter}>
          <PublicDirectoryPanel
            directory={nav.directory}
            region={nav.discoverRegion}
            artists={hydratedDirectoryArtists}
            events={hydratedDirectoryEvents}
            onOpenArtist={openArtist}
            onOpenEvent={openShow}
          />
          <Suspense fallback={<ScreenLoading />}>{overlay || tabScreens}</Suspense>
        </View>
        {showRightRail && <RightRail railWidth={rightRailLayout.width} topArtists={topArtists} artistsAlphabetical={artistsAlphabetical} upcomingEvents={upcomingEvents} discoverySidebar={discoverySidebar} discoverySidebarStatus={discoverySidebarStatus} accountId={session?.id || null} homeCity={session?.home?.city} countdownPlan={homeCountdown} onOpenCountdown={openShow} onViewAllCountdown={() => go({ calendar: true })} onOpenArtist={openArtist} onOpenProfile={openProfile} onFollowUser={follow} isFollowing={isFollowing} isBlocked={isBlocked} onOpenLounge={(lounge) => go({ lounge })} onOpenDiscover={() => switchTab("discover")} onOpenEvent={openShow} />}
      </View>
    </View>
  );
  // Clips mode has its own audio; obscuring pauses the music player so the two
  // don't talk over each other (the clip drives sound while you're in there).
  // Full-screen clips and gallery videos own audio while visible. Pause the
  // music player at its current position and require an explicit Play afterward
  // instead of auto-resuming two audio surfaces on viewer close.
  const signupOnboardingVisible = authReady
    && needsSignupOnboarding(session)
    && status === "ok"
    && !nav.auth
    && !resetToken
    && !unsubToken
    && !verifyToken
    && !ownerApprovalToken;
  const finishSignupOnboarding = async ({ openArtistPicker = false } = {}) => {
    const result = await completeSignupOnboarding();
    if (result?.ok && openArtistPicker) replace({ pickArtists: true });
    return result;
  };
  const playerObscured = !!resetToken || !!ownerApprovalToken || !!welcome || signupOnboardingVisible || !!nav.photos || (ENABLE_CLIPS && !!nav.clips);
  const landingSurface = landingRenderSurface({ authReady, session, landing });

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <StatusBar style={themeIsDark ? "light" : "dark"} />

        {landingSurface === "pending" ? (
          <ScreenLoading />
        ) : landingSurface === "landing" ? (
          <LandingScreen
            onLogin={() => { enter(); go({ auth: true, authMode: "login" }); }}
            onSignup={() => { enter(); go({ auth: true, authMode: "signup" }); }}
            onBrowse={enter}
            onOpenEvent={(event) => { enter(); openShow(event); }}
            onExploreLounges={() => { enter(); setTab("discover"); go({ auth: true, authMode: "login" }); }}
            onSuggestion={() => { enter(); go({ suggestion: { surface: "landing" } }); }}
          />
        ) : status !== "ok" ? (
          nav.deleteAccount ? overlay : <AccountGate status={status} until={session?.suspendedUntil} onLogout={signOut} onExport={exportMyData} onDelete={() => go({ deleteAccount: true })} />
        ) : (
          <View style={[styles.appFrame, wide && styles.appFrameWide]}>
            {MUSIC_PLAYER_ENABLED && (wide || (player && !(ENABLE_CLIPS && nav.clips))) && (
              <View style={wide ? [styles.playerColumn, { width: playerColumnWidth }] : styles.mobilePlayerSlot}>
                <Suspense fallback={null}>
                <PlayerBar
                  player={player}
                  layout={wide ? "column" : "bar"}
                  minimized={playerMinimized}
                  obscured={playerObscured}
                  onMinimize={() => setPlayerMinimized(true)}
                  onRestore={restorePlayer}
                  onClose={stopAndClearPlayback}
                  onIndex={setPlayerIndex}
                  onPlayAt={playAt}
                  onRemove={removeFromQueue}
                  onMoveNext={moveToNext}
                  history={playHistory}
                  onRefreshHistory={() => loadPlayHistory()}
                  onSaveQueueAsPlaylist={saveQueueAsPlaylist}
                  onPlayTrack={musicPlayerAction}
                  onPlaybackStarted={recordPlay}
                  onOpenArtist={openArtist}
                  onAddToPlaylist={musicPlaylistAction}
                  session={session}
                  resolveYouTube={resolveYouTube}
                  invalidateYouTube={invalidateYouTube}
                  youtubeVideoRejected={youtubeVideoRejected}
                  resolveDeezerPreview={resolveDeezerPreview}
                  youtubeLookupStatus={youtubeLookupStatus}
                />
                </Suspense>
              </View>
            )}
            <View style={styles.appContent}>
              {wide ? desktop : (
                <>
                  {showMobilePublicTrail ? <PublicWebTrail links={hydratedPublicLinks} onNavigate={openHydratedPublicTarget} /> : null}
                  <PublicDirectoryPanel
                    directory={nav.directory}
                    region={nav.discoverRegion}
                    artists={hydratedDirectoryArtists}
                    events={hydratedDirectoryEvents}
                    onOpenArtist={openArtist}
                    onOpenEvent={openShow}
                  />
                  {overlay ? <Suspense fallback={<ScreenLoading />}>{overlay}</Suspense> : (
                    <>
                      <Suspense fallback={<ScreenLoading />}>{tabScreens}</Suspense>
                      <View style={styles.tabbar}>
                        {LEFT.map((t) => <TabButton key={t.key} tab={t} active={tab} onPress={switchTab} />)}
                        <View style={styles.fabCol}>
                          <Pressable
                            style={styles.fab}
                            onPressIn={preloadComposer}
                            onHoverIn={preloadComposer}
                            onFocus={preloadComposer}
                            onPress={() => requireVerifiedMutation("post", () => go({ logging: true, postMode: "status" }))}
                            accessibilityLabel="Make a post"
                          >
                            <Icon name="plus" size={26} color="#1A1206" strokeWidth={2.6} />
                          </Pressable>
                          <Text style={styles.fabLabel}>Post</Text>
                        </View>
                        {RIGHT.map((t) => <TabButton key={t.key} tab={t} active={tab} onPress={switchTab} />)}
                      </View>
                    </>
                  )}
                </>
              )}
            </View>
          </View>
        )}

        {/* Browsing and privacy/account rights stay available, while protected
            actions expand this persistent reminder into a verification gate. */}
        {status === "ok" && session && session.emailVerified === false && (
          <VerifyEmailBanner
            email={session.email}
            topOffset={MUSIC_PLAYER_ENABLED && !wide && player ? 72 : undefined}
            onResend={resendEmailVerification}
            blockedAction={verificationPrompt}
            onCloseGate={() => setVerificationPrompt(null)}
          />
        )}

        <FeedbackHost canViewDiagnostics={canViewDiagnostics} onOpenDiagnostics={() => { if (canViewDiagnostics) go({ diagnostics: true }); }} />

        {MUSIC_PLAYER_ENABLED && status === "ok" && preview && (
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
            { icon: "you", label: profileDestination === "artistHub" ? "View public artist page" : "View public profile", onPress: () => { setAcctOpen(false); session && openProfile(session.id); } },
            { icon: profileAction.icon, label: profileAction.title, onPress: () => { setAcctOpen(false); openProfileManagement(); } },
            { icon: "menu", label: "Settings", onPress: () => { setAcctOpen(false); go({ settings: true }); } },
            { divider: true },
            { icon: "logout", label: "Log out", danger: true, onPress: () => { setAcctOpen(false); signOut(); } },
          ]}
        />

        {resetToken && (
          <View style={styles.welcomeModal}>
            <ResetPasswordScreen token={resetToken} onDone={clearResetUrl} onCancel={clearResetUrl} />
          </View>
        )}

        {unsubToken && (
          <View style={styles.welcomeModal}>
            <UnsubscribeScreen token={unsubToken} onDone={clearUnsubUrl} />
          </View>
        )}

        {verifyToken && (
          <View style={styles.welcomeModal}>
            <VerifyEmailScreen token={verifyToken} onConsumed={scrubVerifyUrl} onDone={clearVerifyUrl} />
          </View>
        )}

        {ownerApprovalToken && (
          <View style={styles.welcomeModal}>
            {!authReady ? <ScreenLoading /> : !session ? (
              <AuthScreen initialMode="login" onDone={() => {}} onCancel={clearOwnerApprovalUrl} />
            ) : (
              <Suspense fallback={<ScreenLoading />}>
                <OwnerApprovalScreen
                  token={ownerApprovalToken}
                  session={session}
                  onConsumed={scrubOwnerApprovalUrl}
                  onDone={clearOwnerApprovalUrl}
                  onSignOut={signOut}
                />
              </Suspense>
            )}
          </View>
        )}

        {signupOnboardingVisible && session && (
          <View style={styles.welcomeModal} accessibilityViewIsModal>
            <Suspense fallback={<ScreenLoading />}>
              <SignupOnboardingScreen session={session} onComplete={finishSignupOnboarding} />
            </Suspense>
          </View>
        )}

        {welcome && session && !signupOnboardingVisible && (
          <View style={styles.welcomeModal}>
            <WelcomeScreen
              onClose={() => setWelcome(false)}
              onOpenFanClub={(a) => { setWelcome(false); openFanClub(a); }}
              onOpenShow={(s) => { setWelcome(false); openShow(s); }}
              onOpenFanClubs={() => { setWelcome(false); go({ fanClubs: true }); }}
              onOpenNearby={() => { setWelcome(false); go({ nearby: true }); }}
            />
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

function ScreenLoading() {
  return (
    <View style={styles.screenLoading} accessibilityRole="progressbar" accessibilityLabel="Loading screen">
      <ActivityIndicator size="small" color={colors.amber} />
      <Text style={styles.screenLoadingTxt}>Loading...</Text>
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
  appFrame: { flex: 1, minHeight: 0 },
  appFrameWide: { flexDirection: "row" },
  appContent: { flex: 1, minWidth: 0, minHeight: 0 },
  playerColumn: { flexGrow: 0, flexShrink: 0, minWidth: 82, height: "100%" },
  mobilePlayerSlot: { width: "100%", flexGrow: 0, flexShrink: 0 },
  deskOuter: { flex: 1, minWidth: 0, width: "100%", borderRightWidth: 1, borderRightColor: colors.lineSoft },
  deskWrap: { flex: 1, minHeight: 0, flexDirection: "row", width: "100%" },
  deskCenter: { flex: 1, minWidth: 0, borderRightWidth: 1, borderRightColor: colors.lineSoft },
  screenLoading: { flex: 1, minHeight: 180, alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: colors.bg },
  screenLoadingTxt: { color: colors.textDim, fontFamily: mono, fontSize: 12 },
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
    ...(Platform.OS === "web"
      ? { boxShadow: `0 4px 12px ${colors.amberStrong}73` }
      : { shadowColor: colors.amberStrong, shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 }),
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
