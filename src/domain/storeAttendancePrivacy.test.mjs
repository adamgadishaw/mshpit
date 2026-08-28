import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const store = readFileSync(new URL("../store.js", import.meta.url), "utf8");

function storeSlice(startMarker, endMarker) {
  const start = store.indexOf(startMarker);
  const end = store.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing Store slice: ${startMarker}`);
  return store.slice(start, end);
}

test("canonical attendance is memory-only and exposed through an account-scoped projection", () => {
  const state = storeSlice(
    "// Canonical Interested/Going/Here/Went history is private account data.",
    "const goingConfirmedRef",
  );

  assert.match(state, /if \(!goingRef\.attendance\) \{[\s\S]*goingRef\.attendance = \{ accountId: session\?\.id \|\| null, rows: \[\] \};/);
  assert.match(state, /const myAttendance = accountScopedRows\([\s\S]*goingRef\.attendance\.rows,[\s\S]*goingRef\.attendance\.accountId,[\s\S]*activeAccountId/);
  assert.doesNotMatch(state, /useState|useRef|usePrivateEphemeral|usePersisted|\bsave\(/);
  assert.match(store, /goingFor, myAttendance, isGoing/);
});

test("an account transition clears attendance before the new identity can adopt data", () => {
  const transition = storeSlice("const adoptFeedAccount =", "useEffect(() => {");
  const accountGuard = transition.indexOf("if (nextAccountId === feedAccountIdRef.current) return;");
  const clearRef = transition.indexOf("goingRef.attendance = clearedAttendance;");

  assert.ok(accountGuard >= 0 && clearRef > accountGuard, "only a real account transition should clear attendance");
  assert.match(transition, /const clearedAttendance = \{ accountId: nextAccountId \|\| null, rows: \[\] \};/);
});

test("attendance hydration rejects stale accounts and mutations before adopting canonical rows", () => {
  const hydration = storeSlice(
    "// The same response also carries canonical private attendance history.",
    "// Server-backed notifications",
  );

  assert.match(hydration, /\.then\(\(\{ going: rows, attendance: attendanceRows \}\) => \{/);
  assert.match(hydration, /sessionRef\.current\?\.id !== su\.id/);
  assert.match(hydration, /goingMutationRevisionRef\.current !== goingHydrationRevision/);
  assert.match(hydration, /goingRef\.attendance\.accountId !== su\.id/);
  assert.match(hydration, /Array\.isArray\(attendanceRows\) \? attendanceRows : \[\]/);
  assert.match(hydration, /goingRef\.attendance = nextAttendanceState;/);
  assert.ok(
    hydration.indexOf("goingRef.attendance = nextAttendanceState;")
      < hydration.indexOf("setGoing(next);"),
    "the synchronous attendance ref must update before the existing Going rerender",
  );
});
