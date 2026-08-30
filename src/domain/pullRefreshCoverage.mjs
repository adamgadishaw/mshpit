const coverage = (screen, category, reason) => Object.freeze({ screen, category, reason });

// Every screen that owns a vertical ScrollView/FlatList/SectionList is listed
// here. The source-contract test fails when a new scroll surface is added
// without either a real pull refresh or a written product reason to omit one.
export const PULL_REFRESH_COVERAGE = Object.freeze([
  coverage("AdminScreen.jsx", "required", "Remote moderation data, scoped to the signed-in staff account and active data tab."),
  coverage("ArtistArchiveScreen.jsx", "required", "Remote artist performance archive with cursor pagination."),
  coverage("ArtistGalleryScreen.jsx", "required", "Remote artist media archive with cursor pagination."),
  coverage("ArtistScreen.jsx", "required", "Remote artist profile and fan-photo detail."),
  coverage("ClipsScreen.jsx", "required", "Remote clip reel with cursor pagination."),
  coverage("FanClubScreen.jsx", "required", "Active-room community messages; pull complements, but does not replace, live updates."),
  coverage("FanClubsScreen.jsx", "required", "Remote artist-community directory while preserving its search query."),
  coverage("FollowListScreen.jsx", "required", "Remote follower/following relationship directory."),
  coverage("InboxScreen.jsx", "required", "Remote message-thread summaries for the signed-in account."),
  coverage("LoungeScreen.jsx", "required", "Exact-show Lounge messages while the room is open."),
  coverage("NearbyScreen.jsx", "required", "Remote nearby shows and venue activity for the selected city and radius."),
  coverage("NotificationsScreen.jsx", "required", "Remote activity plus durable read acknowledgement."),
  coverage("PostScreen.jsx", "required", "Remote comments without background polling."),
  coverage("ProfileScreen.jsx", "required", "Remote public profile, concert history, and rewards."),
  coverage("ShowScreen.jsx", "required", "Canonical show, privacy-scoped Crowd/Lounge metadata, and venue media."),
  coverage("ThreadScreen.jsx", "required", "Remote direct-message thread and participant identity."),
  coverage("TopRatedScreen.jsx", "required", "Remote ranked-show directory for the selected region."),
  coverage("TourArchiveScreen.jsx", "required", "Remote tour archive with cursor pagination."),
  coverage("VenueScreen.jsx", "required", "Remote venue reviews and licensed/fan photo pool."),
  coverage("VenuesScreen.jsx", "required", "Remote venue directory and upcoming-show counts for the active region."),

  coverage("CalendarScreen.jsx", "primary-navigation", "Primary surface owns its deliberate refresh in the navigation refresh pass."),
  coverage("DiscoverScreen.jsx", "primary-navigation", "Primary surface owns discovery refresh and region switching."),
  coverage("FeedScreen.jsx", "primary-navigation", "Primary surface owns deliberate feed refresh and pagination."),
  coverage("SearchScreen.jsx", "primary-navigation", "Search is query-driven and owns request cancellation in the primary navigation pass."),
  coverage("YouScreen.jsx", "primary-navigation", "Private dashboard owns its refresh in the primary navigation pass."),

  coverage("ArtistHubScreen.jsx", "form", "Artist management is a command workspace; refresh must not interrupt unsaved work."),
  coverage("AuthScreen.jsx", "form", "Authentication form has no refreshable remote collection."),
  coverage("BulkTourDatesScreen.jsx", "form", "Bulk date composer must preserve unsaved work."),
  coverage("DeleteAccountScreen.jsx", "form", "Destructive confirmation flow has no refreshable collection."),
  coverage("EditArtistProfileScreen.jsx", "form", "Profile editor must preserve unsaved work."),
  coverage("EditProfileScreen.jsx", "form", "Profile editor must preserve unsaved work."),
  coverage("LogScreen.jsx", "form", "Concert/post composer must preserve unsaved work."),
  coverage("OwnerApprovalScreen.jsx", "form", "Owner approval is a command form with explicit actions."),
  coverage("PickArtistsScreen.jsx", "form", "Onboarding picker is local selection plus query-driven search."),
  coverage("ReportScreen.jsx", "form", "Report composer must preserve the person's draft."),
  coverage("RequestArtistScreen.jsx", "form", "Artist request composer must preserve unsaved work."),
  coverage("ResetPasswordScreen.jsx", "form", "Password form has no refreshable collection."),
  coverage("SongPicker.jsx", "form", "Song picker is query-driven and owns its search lifecycle."),
  coverage("SuggestionBoxScreen.jsx", "form", "Suggestion composer must preserve unsaved work."),
  coverage("VenueReviewScreen.jsx", "form", "Review composer must preserve unsaved work."),

  coverage("BadgeLegendScreen.jsx", "static", "Local badge reference; remote rewards refresh on Profile."),
  coverage("DiagnosticsScreen.jsx", "static", "Authorized local diagnostic history, not a remote feed."),
  coverage("LandingScreen.jsx", "static", "Public marketing/SEO surface with no account-scoped collection."),
  coverage("MenuScreen.jsx", "static", "Navigation menu contains no remote collection."),
  coverage("PolicyScreen.jsx", "static", "Static policy copy."),
  coverage("SettingsScreen.jsx", "static", "Settings commands and local preferences are not a feed."),
  coverage("WelcomeScreen.jsx", "static", "Onboarding guidance has no refreshable collection."),
]);

export const REQUIRED_PULL_REFRESH_SCREENS = Object.freeze(
  PULL_REFRESH_COVERAGE.filter((entry) => entry.category === "required").map((entry) => entry.screen),
);
