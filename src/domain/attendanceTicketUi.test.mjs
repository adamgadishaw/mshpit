import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../components/ConcertTicketCard.jsx", import.meta.url);
const source = await readFile(sourceUrl, "utf8");

test("ticket card collapses failed artist artwork without generating a replacement", () => {
  assert.match(source, /preview\.imageUri\s*&&\s*preview\.imageUri\s*!==\s*failedImageUri/);
  assert.match(source, /onError=\{\(\)\s*=>\s*setFailedImageUri\(imageUri\)\}/);
  assert.match(source, /setFailedImageUri\(null\)/);
  assert.doesNotMatch(source, /PHOTO UNAVAILABLE|initials|fallback image/i);
});

test("ticket card renders only social attendance details, never purchase credentials", () => {
  assert.doesNotMatch(source, /barcode|qr\s*code|order(?:\s*number|Id)|confirmation\s*number/i);
  assert.doesNotMatch(source, /MSHPIT SHOW PASS|\bADMIT\b|OFFICIAL TOUR|OFFICIAL EVENT/);
  assert.match(source, /NOT VALID FOR ENTRY/);
  assert.match(source, /preview\.seatLocation/);
  assert.match(source, /<SeatStub seatLocation=\{preview\.seatLocation\} narrow=\{narrow\}/);
  assert.match(source, /preview\.contextTitle/);
  assert.doesNotMatch(source, /preview\.officialTitle|officialBlock|officialLabel|officialTitle/);
  assert.match(source, /preview\.authorSentence/);
  assert.match(source, /preview\.tourStopLabel/);
});

test("ticket card is responsive and uses the shared design system", () => {
  assert.match(source, /useWindowDimensions\(\)/);
  assert.match(source, /const \{ width, fontScale \} = useWindowDimensions\(\)/);
  assert.match(source, /const WIDE_BREAKPOINT = 620/);
  assert.match(source, /const PHONE_BREAKPOINT = 430/);
  assert.match(source, /cardWidth > 0[\s\S]*?\? Math\.min\(cardWidth, width\)[\s\S]*?: Math\.min\(width, PHONE_BREAKPOINT - 1\)/);
  assert.match(source, /responsiveWidth >= WIDE_BREAKPOINT && fontScale < 1\.35 && !compact/);
  assert.match(source, /responsiveWidth < PHONE_BREAKPOINT \|\| fontScale >= 1\.25/);
  assert.match(source, /onLayout=\{measureCard\}/);
  assert.match(source, /artworkCompact/);
  assert.match(source, /maxWidth: 900/);
  for (const style of ["scheduleNarrow", "detailsNarrow", "detailProminentNarrow", "stubNarrow", "openActionNarrow"]) {
    assert.ok(source.includes(style), style + " should guard narrow ticket boundaries");
  }
  assert.match(source, /colors,\s*displayFont,\s*focusRing,\s*font,\s*mono,\s*radius,\s*shadow,\s*space/);
  assert.match(source, /Platform\.select\(\{[\s\S]*?outlineOffset: -3/);
  assert.match(source, /target\.matches\(":focus-visible"\)/);
  assert.match(source, /focusVisible && ticketFocusRing/);
  assert.doesNotMatch(source, /focused && focusRing/);
  assert.doesNotMatch(source, /#[0-9a-f]{3,8}/i);
});

test("ticket card keeps its interactive and summary modes accessible", () => {
  assert.match(source, /accessibilityRole="button"/);
  assert.match(source, /accessibilityRole="summary"/);
  assert.match(source, /const cardAccessibilityLabel = "Mshpit RSVP keepsake, not valid for entry\. "/);
  assert.match(source, /accessibilityLabel=\{cardAccessibilityLabel\}/);
  assert.match(source, /accessibilityHint=\{accessibilityHint \|\| "Opens the show page"\}/);
  assert.match(source, /importantForAccessibility="no-hide-descendants"/);
  assert.match(source, /minHeight: 44/);
  assert.match(source, /fontVariant: \["tabular-nums"\]/);
  assert.match(source, /useReducedMotion/);
  assert.match(source, /transition=\{reduceMotion \? 0 : 160\}/);
  assert.match(source, /pressed && !reduceMotion && styles\.cardPressedMotion/);
});

test("ticket artwork uses Expo Image caching and the ticket edge is presentational", () => {
  assert.match(source, /Image as ExpoImage/);
  assert.match(source, /cachePolicy="memory-disk"/);
  assert.match(source, /recyclingKey=\{imageUri\}/);
  assert.match(source, /borderStyle: "dashed"/);
});

test("ticket artwork stays photo-led and keeps attribution out of the image overlay", () => {
  assert.match(source, /const hasLicensedPortrait = !!\(imageUri && preview\.artistPhotoAttribution\);/);
  assert.match(source, /contentPosition=\{hasLicensedPortrait \? "top center" : "center"\}/);
  assert.doesNotMatch(source, /artworkCredit(?:Lead|Text)?:\s*\{/);
  assert.doesNotMatch(source, /preview\.artistPhotoAttribution\.(?:creator|sourceName|licenseName|licenseUrl|sourceUrl)/);
});

test("ticket composition reads like a concert keepsake instead of a generic action card", () => {
  assert.match(source, />MSHPIT<\/Text>/);
  assert.match(source, /LIVE MUSIC, REMEMBERED/);
  assert.doesNotMatch(source, /MSHPIT \/ GOING|SOCIAL RSVP/);
  assert.match(source, />RSVP<\/Text>/);
  assert.match(source, /SEATING/);
  assert.match(source, /NOT SHARED/);
  assert.match(source, /VIEW SHOW/);
  assert.match(source, /RSVP CARD/);
  assert.match(source, /ARTIST \//);
  assert.match(source, /VENUE \/ CITY/);
  assert.match(source, /MSHPIT RSVP/);
  assert.match(source, /legalFinePrint/);
  assert.equal((source.match(/NOT VALID FOR ENTRY/g) || []).length, 1,
    "the disclaimer appears once, in fine print at the very bottom");
  assert.ok(source.indexOf("styles.legalFooter") > source.indexOf("styles.stub"),
    "the entry disclaimer follows the full ticket stub");
  assert.doesNotMatch(source, /KEEP THE NIGHT|OPEN THE NIGHT|LIVE KEEPSAKE|THIS NIGHT/);
  assert.match(source, /colorRegister/);
  assert.match(source, /statusStamp/);
  assert.match(source, /keepsakeDateParts/);
  assert.match(source, /import BrandMark from "\.\/BrandMark"/);
  assert.match(source, /<BrandMark size=\{20\} \/>/);
  assert.doesNotMatch(source, /pit-favicon-v1|TICKET_BRAND_MARK/);
  assert.doesNotMatch(source, /brandMarkText|>M<\/Text>/);
  assert.doesNotMatch(source, /fontStyle: "italic"/);
  assert.match(source, /borderRadius: radius\.sm/);
  assert.match(source, /letterSpacing: 1\.35/);
});
