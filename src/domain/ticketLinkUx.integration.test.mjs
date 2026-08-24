import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const helper = readFileSync(new URL("../lib/ticketLinks.js", import.meta.url), "utf8");
const screenPaths = [
  "../screens/ArtistArchiveScreen.jsx",
  "../screens/ArtistScreen.jsx",
  "../screens/CalendarScreen.jsx",
  "../screens/NearbyScreen.jsx",
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
    assert.match(source, /import \{ openTicketLink \} from "\.\.\/lib\/ticketLinks";/, path);
    assert.match(source, /openTicketLink\([^)]*ticketUrl/, path);
    assert.doesNotMatch(source, /Linking\.openURL\([^\n)]*ticketUrl/, path);
  }
});
