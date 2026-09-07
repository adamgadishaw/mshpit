export const DEFAULT_CITY_COPY = Object.freeze({
  cityTitle: "{city}, live", cityDescription: "Concerts, venues, artists, and reviews in {city}. See today's shows and photos from local concertgoers.",
  citySeoTitle: "{city} concerts and live music venues",
  citySeoDescription: "Find concerts in {city}, explore live music venues, and read audience reviews. See upcoming shows, crowd photos, and the city's music history.",
  citiesSeoTitle: "City guides: concerts, venues and music history",
  guideLabel: "City guide", historyTitle: "Music history in {city}", influenceTitle: "Musical influence",
  artistsTitle: "Artists connected to {city}", performingArtistsTitle: "Artists who play here", venuesTitle: "Live music venues in {city}", todayTitle: "On stage in {city} today",
  upcomingTitle: "Upcoming concerts in {city}", photosTitle: "Concert and city photos", sourcesTitle: "Sources",
  noShowsToday: "No shows listed for today.", noUpcomingShows: "No upcoming shows listed yet.",
  noVenues: "No venues listed yet.", noArtists: "No artists listed yet.", learnMore: "Learn more",
  openVenue: "View venue", openArtist: "View artist", openShow: "View show", openReview: "Open review", close: "Close",
  retry: "Try again", loading: "Loading city guide…", loadError: "The city guide could not load.",
  citiesTitle: "Find your next music city", citiesDescription: "Find concerts, explore live music venues, and read reviews from the crowd. Get to know the music history behind each city.", citySearchPlaceholder: "Search cities", noCities: "No cities found.",
  upcomingCount: "{count} upcoming shows", venueCount: "{count} venues",
  welcomeTitle: "Welcome to {city}", welcomeBody: "Find a show, get to know the venues, and save the nights you'll talk about later.",
  welcomeExplore: "Explore your city", welcomeDismiss: "Maybe later", welcomeBannerUrl: "",
  welcomeBannerAlt: "A crowd at a concert", welcomeBannerCredit: "", welcomeBannerSourceUrl: "",
  welcomeBannerLicenseUrl: "", welcomeBannerOwned: false, photoCredit: "Photo: {credit}",
  showMore: "See more", showLess: "See less", photoLicense: "Photo license",
  refreshCityLabel: "Refresh {city}", refreshCitiesLabel: "Refresh cities",
  programmeLabel: "City programme", fanPhotoLabel: "From the crowd", cityPhotoLabel: "City photo", photoCount: "Photos · {count}",
  welcomeKicker: "Your local music guide", datePending: "Date to be announced",
  todayCountLabel: "Today", upcomingCountLabel: "Upcoming shows", venueCountLabel: "Venues",
  cityGuideLink: "Music guide to {city}",
});

// Only these exact old default values may be replaced on an untouched shared-copy row.
export const CITY_COPY_PREVIOUS_DEFAULTS = Object.freeze({
  cityTitle:"Music in {city}",historyTitle:"Music history",influenceTitle:"Music from here",
  artistsTitle:"Artists connected to the city",venuesTitle:"Venues",todayTitle:"Shows today",upcomingTitle:"Upcoming shows",
  photosTitle:"Photos from the city",citiesTitle:"Cities",citiesDescription:"Find concerts, venues, local music history, and reviews by city.",
  welcomeBody:"See who's playing, find a venue, and share the shows you go to.",
  photoCount:"{count} photos",
});

export const EMPTY_CITY_EDITORIAL = Object.freeze({
  title: "", seoTitle: "", seoDescription: "", intro: "", history: "", influence: "", timeZone: "", sources: [], artists: [], stockImage: null,
});
