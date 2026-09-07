// Shared, centralized wording. Callers may supply overrides with these keys.
export const ARTIST_OVERVIEW_COPY = Object.freeze({
  title: "Upcoming shows", description: "Dates, venues and ticket links.", allLocations: "All locations", filterLocation: "Choose location",
  countryLabel: "Country", countryPlaceholder: "Country name or code", cityLabel: "City", cityPlaceholder: "Any city", applyLocation: "Apply", closeFilters: "Close filters",
  invalidCountry: "Choose a country name or two-letter code.", loading: "Loading show dates…", refreshing: "Updating show dates…", retry: "Try again",
  empty: "No upcoming dates are listed here yet.", emptyFiltered: "No dates are listed for this location. Try all locations.",
  failed: "Show dates could not load. Please try again.", stale: "Showing the last loaded dates. The update did not finish.",
  partial: "Some dates may be missing. Check the artist’s official channels too.", coverageStale: "These dates have not been checked recently. Confirm details with the venue.",
  coverageUnknown: "We have not checked every source for this artist yet.", coverageUnavailable: "The date source is unavailable. Listed dates may be incomplete.",
  coveragePending: "More date sources are being checked.", moreFailed: "More dates could not load. Your current list is still here.",
  loadMore: "More shows", loadingMore: "Loading more shows…", viewAll: "View all shows", shownCount: "{shown} of {total} listed dates",
  openShow: "View show", tickets: "Tickets", ticketFailure: "The ticket link could not open. Try the show page.",
  datePending: "Date to be confirmed", venuePending: "Venue to be announced", cancelled: "Cancelled", postponed: "Postponed", rescheduled: "Rescheduled", soldOut: "Sold out",
});
export function artistOverviewText(copy, key, values = {}) {
  const source = typeof copy?.[key] === "string" && copy[key].trim() ? copy[key] : ARTIST_OVERVIEW_COPY[key] || "";
  return source.replace(/\{(\w+)\}/g, (match, name) => values[name] == null ? match : String(values[name]));
}
