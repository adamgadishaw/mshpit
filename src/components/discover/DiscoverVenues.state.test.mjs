import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as venueCities from "../../domain/discoverVenues.mjs";
import * as explorer from "../../domain/discoverVenueExplorer.mjs";
import * as venueDiscovery from "../../domain/venueDiscovery.mjs";
import * as selection from "../../domain/venueMapSelection.mjs";
import { countryForCity } from "../../domain/geo.mjs";
import { publicVenueRequestPath } from "../../domain/publicVenueSnapshot.mjs";
import { discoverRowMatchesRegion } from "../../domain/discoverScene.mjs";

const require = createRequire(import.meta.url), React = require("react"), reconciler = require("react-reconciler");
const { parse } = require("@babel/parser");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const source = readFileSync(new URL("../../features/venueCommunity/DiscoverVenues.jsx", import.meta.url), "utf8");
const component = parse(source, { sourceType: "module", plugins: ["jsx"] }).program.body.find(node => node.type === "ExportDefaultDeclaration").declaration;
// Reconcile the component's actual hooks, control callbacks and effects; only its host JSX is omitted.
const statements = component.body.body.filter(node => node.type !== "ReturnStatement").map(node => source.slice(node.start, node.end)).join("\n");
const noop = () => {}, context = {};
let priority = 0;
const renderer = reconciler({
  supportsMutation: true, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
  getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
  prepareForCommit: () => null, resetAfterCommit: noop,
  createInstance: (type, props) => ({ type, props }), createTextInstance: text => ({ text }),
  appendInitialChild: noop, appendChild: noop, appendChildToContainer: noop, removeChild: noop, removeChildFromContainer: noop,
  insertBefore: noop, insertInContainerBefore: noop, finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
  commitUpdate: noop, commitTextUpdate: noop, clearContainer: noop, resetTextContent: noop, commitMount: noop,
  scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1, supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
  getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: value => { priority = value; },
  resolveUpdatePriority: () => priority || 32, shouldAttemptEagerTransition: () => false, detachDeletedInstance: noop,
  maySuspendCommit: () => false, preloadInstance: () => true, startSuspendingCommit: noop, suspendInstance: noop,
  waitForCommitToBeReady: () => null, NotPendingTransition: null, HostTransitionContext: React.createContext(null), resetFormInstance: noop,
  bindToConsole: (method, args) => console[method].bind(console, ...args),
});
const index = [
  { name: "Toronto Room", place: "Toronto, ON, Canada", identity: "toronto" },
  ...Array.from({ length: 20 }, (_, i) => ({ name: `Montreal Hall ${i}`, place: "Montreal, QC, Canada", identity: `montreal-${i}` })),
  { name: "Paris Room", place: "Paris, France", identity: "paris" },
];
const member = { id: "member", home: { city: "Toronto, ON, Canada" } };

function fixture() {
  let snapshot;
  const saved = { current: null };
  const bindings = { ...React, ...venueCities, ...explorer, ...venueDiscovery, ...selection, countryForCity, publicVenueRequestPath, discoverRowMatchesRegion,
    useWindowDimensions: () => ({ width: 390, fontScale: 1 }), useVenueCommunity: () => ({ resource: { data: null } }),
    useVenueMapCatalogue: () => null, expose: value => { snapshot = value; },
  };
  const Probe = new Function(...Object.keys(bindings), `return function Probe({session, region, homeCity, venueDirectoryIndex, tourDates, viewStateRef, persistView = true, privacyRevision = 0}) {
    ${statements}
    expose({ query, cityQuery, cityPickerOpen, mapOpen, chosenCity, chosenVenue, expandedShowsFor, cityLimit, allVenuesOpen, page,
      cities, city, venues, shownVenues, selectCity, changeQuery, selectMapVenue, setMapOpen, setPage, setExpandedShowsFor });
    return null;
  };`)(...Object.values(bindings));
  const fail = error => { throw error; };
  const container = renderer.createContainer({}, 1, null, false, null, "", fail, fail, fail, null);
  const flush = element => React.act(() => { renderer.updateContainerSync(element, container, null, null); renderer.flushSyncWork(); renderer.flushPassiveEffects(); });
  return { saved, snapshot: () => snapshot,
    render({ session = member, region = "Canada", rows = index, persistView = true } = {}) {
      flush(React.createElement(Probe, { key: session?.id || "guest", session, region, homeCity: session?.home?.city || "", venueDirectoryIndex: rows, tourDates: [], viewStateRef: saved, persistView }));
    },
    chooseMontreal() { React.act(() => snapshot.selectCity(snapshot.cities.find(city => city.city === "Montreal").id)); },
    chooseDetails() { React.act(() => { snapshot.changeQuery("Hall"); snapshot.setMapOpen(false); snapshot.setPage(1); });
      React.act(() => { snapshot.selectMapVenue(snapshot.venues[13].id); snapshot.setExpandedShowsFor(snapshot.venues[13].id); }); },
    close() { flush(null); },
  };
}

test("venue detail return and programme remount preserve the selected city, search and list choices", () => {
  const f = fixture();
  try {
    f.render(); assert.equal(f.snapshot().city.city, "Toronto");
    assert.equal(f.snapshot().mapOpen, true, "new venue browsing starts with its map visible");
    f.chooseMontreal(); f.chooseDetails();
    const before = f.snapshot(); assert.equal(before.city.city, "Montreal");
    f.close(); f.render();
    const after = f.snapshot();
    for (const key of ["query", "mapOpen", "chosenCity", "chosenVenue", "expandedShowsFor", "page"]) assert.equal(after[key], before[key], `${key} survives detail return`);
    assert.equal(after.city.city, "Montreal"); assert.equal(after.page, 1); assert.equal(after.shownVenues.length, 8);
    assert.ok(after.shownVenues.some(row => row.id === after.chosenVenue));
    assert.equal("venues" in f.saved.current, false, "the snapshot contains no API/catalogue rows");
    assert.equal("tourDates" in f.saved.current, false);
  } finally { f.close(); }
});

test("a different country or viewer receives default venue choices", () => {
  const f = fixture();
  try {
    f.render(); f.chooseMontreal(); f.chooseDetails();
    f.render({ region: "France" });
    assert.equal(f.snapshot().query, ""); assert.equal(f.snapshot().mapOpen, true); assert.equal(f.snapshot().allVenuesOpen, false);
    assert.equal(f.snapshot().chosenCity, null); assert.equal(f.snapshot().chosenVenue, null); assert.equal(f.snapshot().page, 0);
    f.render(); f.chooseMontreal(); f.chooseDetails(); f.close();
    f.render({ session: { ...member, id: "another-member" } });
    assert.equal(f.snapshot().city.city, "Toronto"); assert.equal(f.snapshot().query, ""); assert.equal(f.snapshot().mapOpen, true);
  } finally { f.close(); }
});

test("restored venue choices use current rows and fall back safely if the selected city disappears", () => {
  const f = fixture();
  try {
    f.render(); f.chooseMontreal(); f.chooseDetails(); f.close();
    f.render({ rows: index.filter(row => row.identity === "toronto") });
    assert.equal(f.snapshot().city.city, "Toronto"); assert.deepEqual(f.snapshot().venues, []);
    React.act(() => f.snapshot().changeQuery(""));
    assert.deepEqual(f.snapshot().shownVenues.map(row => row.name), ["Toronto Room"]);
    assert.equal(f.snapshot().chosenVenue, null);
  } finally { f.close(); }
});


test("a native preview reads saved venue choices without overwriting the active owner", () => {
  const f = fixture();
  try {
    f.render(); f.chooseMontreal(); f.chooseDetails();
    const saved = f.saved.current;
    f.close(); f.render({ persistView: false });
    assert.equal(f.snapshot().query, "Hall");
    f.chooseMontreal();
    assert.equal(f.saved.current, saved, "preview-local changes do not persist");
    f.render({ persistView: true });
    assert.equal(f.saved.current.query, "", "the promoted page can persist its current choices");
  } finally { f.close(); }
});
