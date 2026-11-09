import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const helper = readFileSync(new URL("../lib/ticketLinks.js", import.meta.url), "utf8");
const screenPaths = [
  "../screens/ArtistArchiveScreen.jsx",
  "../components/artist/ArtistUpcomingShows.jsx",
  "../components/artist/ArtistUpcomingShows.ios.jsx",
  "../screens/CalendarScreen.jsx",
  "../components/NearbyFinderRows.jsx",
  "../screens/SearchScreen.jsx",
  "../screens/ShowScreen.jsx",
  "../screens/VenueScreen.jsx",
];

test("ticket opener presents the canonical hostname on web and native", () => {
  assert.match(helper, /You're leaving PIT for:\\n\\n\$\{hostname\}/);
  assert.match(helper, /window\.confirm/);
  assert.match(helper, /Alert\.alert/);
  assert.match(helper, /followTicketLink/);
});

test("every ticket UI sink uses the fail-closed shared opener", () => {
  for (const path of screenPaths) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    if (/\/(Show|Venue)Screen/.test(path)) {
      assert.match(source, /import useIOSTicketAction from "\.\.\/components\/useIOSTicketAction";/, path);
      assert.match(source, /ticketAction\.open\([^)]*ticketUrl/, path);
      const scopedOpener = readFileSync(new URL("../components/useIOSTicketAction.js", import.meta.url), "utf8");
      assert.match(scopedOpener, /import \{ openTicketLink \} from "\.\.\/lib\/ticketLinks";/);
      assert.match(scopedOpener, /await openTicketLink\(url, \{/);
      assert.match(scopedOpener, /onFailure:/);
      assert.doesNotMatch(scopedOpener, /Linking\.openURL|window\.open/);
    } else {
      assert.match(source, /import \{ openTicketLink \} from "(?:\.\.\/)+lib\/ticketLinks";/, path);
      assert.match(source, /openTicketLink\([^)]*ticketUrl/, path);
    }
    assert.doesNotMatch(source, /Linking\.openURL\([^\n)]*ticketUrl/, path);
  }
});

test("artist show tickets validate URLs, suppress unavailable sales, and report opener failures", () => {
  const source = readFileSync(new URL("../components/artist/ArtistUpcomingShows.ios.jsx", import.meta.url), "utf8");
  assert.match(source, /const ticketUrl = \/cancel\|postpon\/\.test\(status\) \|\| event\.soldOut \? "" : canonicalTicketUrl\(event\.ticketUrl\)/);
  assert.match(source, /const openTickets = \(\) => \{ setTicketError\(false\); void openTicketLink\(ticketUrl, \{ isCurrent: canAct, onFailure: guard\(\(\) => setTicketError\(true\)\) \}\); \}/);
  assert.match(source, /\{ticketUrl \? <PublicPressableLink href=\{ticketUrl\} onNavigate=\{guard\(openTickets\)\}/);
  assert.match(source, /ticketError \? <Text selectable accessibilityRole="alert"/);
  assert.doesNotMatch(source, /Linking\.openURL|window\.open|href=\{event\.ticketUrl\}/);
});
