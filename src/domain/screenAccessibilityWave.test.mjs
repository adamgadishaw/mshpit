import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";

const files = {
  pickArtists: "../screens/PickArtistsScreen.jsx",
  auth: "../screens/AuthScreen.jsx",
  reset: "../screens/ResetPasswordScreen.jsx",
  requestArtist: "../screens/RequestArtistScreen.jsx",
  settings: "../screens/SettingsScreen.jsx",
  themeSwatch: "../components/ThemeSwatch.jsx",
  venuePhotos: "../components/VenuePhotoWidget.jsx",
  bulkTour: "../screens/BulkTourDatesScreen.jsx",
  datePicker: "../components/DatePicker.jsx",
  calendar: "../screens/CalendarScreen.jsx",
  topRated: "../screens/TopRatedScreen.jsx",
  ticketStub: "../components/TicketStub.jsx",
  reducedMotion: "../hooks/useReducedMotion.js",
};

const source = Object.fromEntries(Object.entries(files).map(([name, relative]) => [
  name,
  readFileSync(new URL(relative, import.meta.url), "utf8"),
]));

test("the accessibility wave leaves every scoped JSX module parseable", () => {
  for (const [name, code] of Object.entries(source)) {
    assert.doesNotThrow(() => parse(code, { sourceType: "module", plugins: ["jsx"] }), `${name} must parse`);
  }
});

test("artist onboarding defers theme application and exposes artist choices", () => {
  assert.match(source.pickArtists, /active=\{t\.key === theme\}/);
  assert.match(source.pickArtists, /onPress=\{\(\) => setThemeChoice\(t\.key\)\}/);
  assert.match(source.pickArtists, /accessibilityRole="checkbox"/);
  assert.match(source.pickArtists, /accessibilityState=\{\{ checked: picked, disabled \}\}/);
  assert.match(source.pickArtists, /accessibilityLabel="Clear artist search"/);
});

test("authentication forms expose autofill, live errors, and real pending locks", () => {
  for (const value of ["email", "current-password", "new-password"]) assert.ok(source.auth.includes(value));
  assert.match(source.auth, /const \[busyAction, setBusyAction\]/);
  assert.match(source.auth, /disabled=\{authBusy \|\| \(mode === "signup" && \(!agreed \|\| !profileGenreSelection\(genres\)\.valid\)\)\}/);
  assert.match(source.auth, /accessibilityLiveRegion="assertive"/);
  assert.match(source.reset, /autoComplete="new-password"/);
  assert.match(source.reset, /if \(busy\) return;/);
  assert.match(source.reset, /accessibilityState=\{\{ disabled: busy, busy \}\}/);
});

test("artist requests only show success after the mutation result succeeds", () => {
  assert.match(source.requestArtist, /await requestArtist/);
  assert.match(source.requestArtist, /if \(result\?\.ok\) setDone\(true\)/);
  assert.match(source.requestArtist, /disabled=\{!valid \|\| busy\}/);
  assert.match(source.requestArtist, /accessibilityRole="alert"/);
});

test("Settings distinguishes actionable rows and exposes selection and busy state", () => {
  assert.match(source.settings, /if \(!onPress\)/);
  assert.match(source.settings, /accessibilityRole=\{accessibilityRole \|\| "button"\}/);
  assert.match(source.settings, /import ThemeSwatch, \{ themeGridStyle \}/);
  assert.match(source.settings, /<ThemeSwatch/);
  assert.match(source.settings, /swatchGrid: themeGridStyle/);
  assert.match(source.themeSwatch, /accessibilityRole="radio"/);
  assert.match(source.themeSwatch, /accessibilityState=\{\{ checked: !!active, selected: !!active \}\}/);
  assert.match(source.settings, /disabled=\{exporting \|\| !exportPassword\}/);
  assert.match(source.settings, /accessibilityState=\{\{ busy: exporting \}\}/);
});

test("venue photos stay user-driven and provide explicit manual controls", () => {
  assert.doesNotMatch(source.venuePhotos, /setInterval|setTimeout|autoplay|slideshow/i);
  assert.match(source.venuePhotos, /accessibilityLabel="Previous venue photo"/);
  assert.match(source.venuePhotos, /accessibilityLabel="Next venue photo"/);
  assert.match(source.venuePhotos, /accessibilityLiveRegion="polite"/);
  assert.match(source.venuePhotos, /accessibilityRole="link"/);
  assert.match(source.venuePhotos, />SOURCE<\/Text>/);
});

test("feed cards share one native Reduce Motion subscription", () => {
  assert.match(source.ticketStub, /useReducedMotion/);
  assert.doesNotMatch(source.ticketStub, /AccessibilityInfo/);
  assert.match(source.reducedMotion, /useSyncExternalStore/);
  assert.equal((source.reducedMotion.match(/addEventListener/g) || []).length, 1);
});

test("bulk tour rows retain identity and expose labelled grouped controls", () => {
  assert.match(source.bulkTour, /id: `tour-date-\$\{\+\+rowSequence\}`/);
  assert.match(source.bulkTour, /key=\{r\.id\}/);
  assert.doesNotMatch(source.bulkTour, /<View key=\{i\} style=\{styles\.rowCard\}/);
  assert.doesNotMatch(source.bulkTour, /setRow\(i,/);
  assert.match(source.bulkTour, /accessibilityLabel=\{`Remove tour date/);
  assert.match(source.bulkTour, /accessibilityRole="radiogroup"/);
  assert.match(source.bulkTour, /<DatePicker value=\{tempDate\}/);
});

test("date picker has a rolling range, 44 point options, and checked radio state", () => {
  assert.match(source.datePicker, /today\.getFullYear\(\) \+ index/);
  assert.doesNotMatch(source.datePicker, /const YEARS = \[2026/);
  assert.match(source.datePicker, /accessibilityRole="radiogroup"/);
  assert.match(source.datePicker, /accessibilityState=\{\{ checked: on \}\}/);
  assert.match(source.datePicker, /minHeight: 44/);
});

test("calendar days expose full names, state, touch size, and web arrow navigation", () => {
  for (const day of ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) assert.ok(source.calendar.includes(day));
  assert.match(source.calendar, /accessibilityState=\{\{ selected: isSel \}\}/);
  assert.match(source.calendar, /pressed === "ArrowRight"/);
  assert.match(source.calendar, /pressed === "Home"/);
  assert.match(source.calendar, /minWidth: 308/);
  assert.match(source.calendar, /minHeight: 44/);
});

test("top-rated city resolution fails closed instead of substituting San Francisco", () => {
  assert.match(source.topRated, /if \(!q\) return null;/);
  assert.match(source.topRated, /return prefixMatches\.length === 1 \? prefixMatches\[0\] : null/);
  assert.doesNotMatch(source.topRated, /includes\(q\)\) \|\| "San Francisco"/);
  assert.match(source.topRated, /aria-invalid=\{invalidCity\}/);
  assert.match(source.topRated, /accessibilityRole="radiogroup"/);
});
