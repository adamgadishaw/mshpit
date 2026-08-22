import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  architectureBaselineRefreshBlockers,
  captureArchitectureBaseline,
  inspectArchitecture,
  unexplainedEmptyCatchCount,
} from "./check-architecture.mjs";

function fixtureCanonicalCommandResult() {
  return "export function isAppErrorLike() { return true; }\nexport function commandSuccess(value) { return { ok: true, value }; }\nexport function commandFailure(error) { return { ok: false, error }; }\n";
}

function fixture(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "pit-architecture-"));
  const defaults = {
    "src/store.js": "import { useState } from \"react\";\nexport function Store() { const [feed, setFeed] = useState([]); return feed; }\n",
    "server/api.js": "export const routes = { \"GET /api/health\": () => ({ ok: true }) };\n",
    "src/domain/feedState.mjs": "export const selectFeed = (rows) => rows;\n",
    "src/domain/commandResult.mjs": fixtureCanonicalCommandResult(),
    "src/domain/loadState.mjs": "export function isLoadCancellation() { return false; }\nexport function createLoadState(value) { return value; }\nexport function beginLoadState(value) { return value; }\nexport function resolveLoadState(value) { return value; }\nexport function rejectLoadState(value) { return value; }\nexport function projectLoadState(value) { return value; }\n",
    "src/lib/api.js": "export const fetchFeed = async () => [];\n",
    "src/components/FeedCard.jsx": "export default function FeedCard() { return null; }\n",
    "src/screens/FeedScreen.jsx": "export default function FeedScreen() { return null; }\n",
  };
  for (const [path, source] of Object.entries({ ...defaults, ...files })) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, source);
  }
  return root;
}

function withFixture(files, run) {
  const root = fixture(files);
  try { return run(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("the captured baseline accepts the existing architecture", () => {
  withFixture({}, (root) => {
    const baseline = captureArchitectureBaseline(root);
    assert.deepEqual(inspectArchitecture({ root, baseline }).errors, []);
  });
});

test("new state and inline routes cannot grow the legacy monoliths", () => {
  withFixture({}, (root) => {
    const baseline = captureArchitectureBaseline(root);
    writeFileSync(join(root, "src/store.js"), "import { useState } from \"react\";\nexport function Store() { const [feed, setFeed] = useState([]); const [comments, setComments] = useState([]); return feed; }\n");
    writeFileSync(join(root, "server/api.js"), "export const routes = { \"GET /api/health\": () => ({}), \"POST /api/comments\": () => ({}) };\n");
    const codes = inspectArchitecture({ root, baseline }).errors.map(({ code }) => code);
    assert.ok(codes.includes("legacy-store-state"));
    assert.ok(codes.includes("legacy-store-state-count"));
    assert.ok(codes.includes("legacy-api-route"));
    assert.ok(codes.includes("legacy-api-route-count"));
  });
});

test("one-for-one replacements cannot bypass the named legacy allowlists", () => {
  withFixture({}, (root) => {
    const baseline = captureArchitectureBaseline(root);
    writeFileSync(join(root, "src/store.js"), "import { useState } from \"react\";\nexport function Store() { const [comments, setComments] = useState([]); return comments; }\n");
    writeFileSync(join(root, "server/api.js"), "export const routes = { \"POST /api/comments\": () => ({}) };\n");
    const codes = inspectArchitecture({ root, baseline }).errors.map(({ code }) => code);
    assert.ok(codes.includes("legacy-store-state"));
    assert.equal(codes.includes("legacy-store-state-count"), false);
    assert.ok(codes.includes("legacy-api-route"));
    assert.equal(codes.includes("legacy-api-route-count"), false);
  });
});

test("computed route keys cannot bypass the legacy API route ratchet", () => {
  withFixture({}, (root) => {
    const baseline = captureArchitectureBaseline(root);
    writeFileSync(join(root, "server/api.js"), "export const routes = { \"GET /api/health\": () => ({}) };\nroutes[`POST /api/comments`] = () => ({});\n");
    const codes = inspectArchitecture({ root, baseline }).errors.map(({ code }) => code);
    assert.ok(codes.includes("legacy-api-route"));
    assert.ok(codes.includes("legacy-api-route-count"));
  });
});

test("the baseline cannot retarget monolith checks or detach totals from named debt", () => {
  withFixture({}, (root) => {
    const retargeted = captureArchitectureBaseline(root);
    retargeted.legacyStore.file = "src/domain/feedState.mjs";
    assert.ok(inspectArchitecture({ root, baseline: retargeted }).errors.some(({ code }) => code === "baseline-invalid"));

    const inflated = captureArchitectureBaseline(root);
    inflated.legacyApi.maxInlineRoutes += 100;
    assert.ok(inspectArchitecture({ root, baseline: inflated }).errors.some(({ code }) => code === "baseline-invalid"));
  });
});

test("reducers, refs, React-qualified hooks, and custom hooks cannot bypass the Store gate", () => {
  withFixture({}, (root) => {
    const candidates = [
      "const [state] = useReducer(reducer, {});",
      "const cache = useRef(new Map());",
      "const [state, setState] = React.useState({});",
      "const featureState = useCommentState();",
    ];
    for (const candidate of candidates) {
      const baseline = captureArchitectureBaseline(root);
      writeFileSync(join(root, "src/store.js"), `import { useState } from \"react\";\nexport function Store() { const [feed, setFeed] = useState([]); ${candidate} return feed; }\n`);
      const codes = inspectArchitecture({ root, baseline }).errors.map(({ code }) => code);
      assert.ok(codes.includes("legacy-store-hook"), candidate);
      assert.ok(codes.includes("legacy-store-hook-count"), candidate);
      writeFileSync(join(root, "src/store.js"), "import { useState } from \"react\";\nexport function Store() { const [feed, setFeed] = useState([]); return feed; }\n");
    }
  });
});

test("dependency direction and file naming apply to new code while legacy exceptions remain bounded", () => {
  withFixture({
    "src/domain/legacy-name.mjs": "import { fetchFeed } from \"../lib/api.js\";\nexport { fetchFeed };\n",
  }, (root) => {
    const baseline = captureArchitectureBaseline(root);
    assert.deepEqual(inspectArchitecture({ root, baseline }).errors, []);

    const path = join(root, "src/domain/New-State.mjs");
    writeFileSync(path, "import FeedScreen from \"../screens/FeedScreen.jsx\";\nexport { FeedScreen };\n");
    const codes = inspectArchitecture({ root, baseline }).errors.map(({ code }) => code);
    assert.ok(codes.includes("import-layer"));
    assert.ok(codes.includes("file-name"));
  });
});

test("shared components cannot acquire the legacy Store", () => {
  withFixture({}, (root) => {
    const baseline = captureArchitectureBaseline(root);
    writeFileSync(join(root, "src/components/FeedCard.jsx"), "import { useStore } from \"../store\";\nexport default function FeedCard() { return useStore(); }\n");
    const errors = inspectArchitecture({ root, baseline }).errors;
    assert.ok(errors.some(({ code, path }) => code === "import-layer" && path === "src/components/FeedCard.jsx"));
  });
});

test("feature slices cannot reach back into the legacy Store", () => {
  withFixture({}, (root) => {
    const baseline = captureArchitectureBaseline(root);
    const path = join(root, "src/features/comments/commentState.mjs");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "import { useStore } from \"../../store.js\";\nexport const loadComments = () => useStore();\n");
    const errors = inspectArchitecture({ root, baseline }).errors;
    assert.ok(errors.some(({ code, path: source }) => code === "import-layer" && source === "src/features/comments/commentState.mjs"));
  });
});

test("require and project-alias imports cannot bypass dependency direction", () => {
  withFixture({}, (root) => {
    const baseline = captureArchitectureBaseline(root);
    const feature = join(root, "src/features/comments/commentState.cjs");
    mkdirSync(dirname(feature), { recursive: true });
    writeFileSync(feature, "const { useStore } = require(\"@/store\");\nexports.readComments = () => useStore();\n");
    const errors = inspectArchitecture({ root, baseline }).errors;
    assert.ok(errors.some(({ code, path }) => code === "import-layer" && path === "src/features/comments/commentState.cjs"));
  });
});

test("TypeScript feature files cannot bypass boundaries, naming, or empty-catch checks", () => {
  withFixture({}, (root) => {
    const baseline = captureArchitectureBaseline(root);
    const panel = join(root, "src/features/comments/CommentPanel.tsx");
    const policy = join(root, "src/features/comments/comment-policy.ts");
    mkdirSync(dirname(panel), { recursive: true });
    writeFileSync(panel, "import { useStore } from \"../../store.js\";\nexport function CommentPanel() { try { return useStore(); } catch {} }\n");
    writeFileSync(policy, "export const selectComment = (value: unknown) => value;\n");

    const errors = inspectArchitecture({ root, baseline }).errors;
    assert.ok(errors.some(({ code, path }) => code === "import-layer" && path === "src/features/comments/CommentPanel.tsx"));
    assert.ok(errors.some(({ code, path }) => code === "empty-catch" && path === "src/features/comments/CommentPanel.tsx"));
    assert.ok(errors.some(({ code, path }) => code === "file-name" && path === "src/features/comments/comment-policy.ts"));
  });
});

test("UI cannot call the PIT API directly and feature services cannot use raw fetch", () => {
  withFixture({
    "src/lib/api.js": "export async function api() { return {}; }\n",
  }, (root) => {
    const baseline = captureArchitectureBaseline(root);
    const panel = join(root, "src/features/comments/CommentPanel.tsx");
    const service = join(root, "src/features/comments/commentService.ts");
    mkdirSync(dirname(panel), { recursive: true });
    writeFileSync(panel, "import { api } from \"../../lib/api.js\";\nexport function CommentPanel() { return api(\"/api/comments\"); }\n");
    writeFileSync(service, "export async function fetchComments() { return fetch(\"/api/comments\"); }\n");

    const errors = inspectArchitecture({ root, baseline }).errors;
    assert.ok(errors.some(({ code, path }) => code === "direct-api-boundary" && path === "src/features/comments/CommentPanel.tsx"));
    assert.ok(errors.some(({ code, path }) => code === "raw-fetch-boundary" && path === "src/features/comments/commentService.ts"));
  });
});

test("feature API and service modules are the approved direct-api boundary", () => {
  withFixture({
    "src/lib/api.js": "export async function api() { return {}; }\n",
    "src/features/comments/commentService.ts": "import { api } from \"../../lib/api.js\";\nexport async function fetchComments() { return api(\"/api/comments\"); }\n",
  }, (root) => {
    const baseline = captureArchitectureBaseline(root);
    assert.equal(inspectArchitecture({ root, baseline }).errors.some(({ code }) => code === "direct-api-boundary"), false);
  });
});

test("legacy direct API consumers have exact call-count and route fingerprints", () => {
  withFixture({
    "src/lib/api.js": "export async function api() { return {}; }\n",
    "src/components/FeedCard.jsx": "import { api } from \"../lib/api.js\";\nexport default function FeedCard() { return api(\"/api/feed\"); }\n",
  }, (root) => {
    const baseline = captureArchitectureBaseline(root);
    writeFileSync(join(root, "src/components/FeedCard.jsx"), "import { api } from \"../lib/api.js\";\nexport default function FeedCard() { api(\"/api/feed\"); return api(\"/api/comments\"); }\n");
    assert.ok(inspectArchitecture({ root, baseline }).errors.some(({ code }) => code === "direct-api-boundary"));

    writeFileSync(join(root, "src/components/FeedCard.jsx"), "import { api } from \"../lib/api.js\";\nexport default function FeedCard() { return api(\"/api/comments\"); }\n");
    assert.ok(inspectArchitecture({ root, baseline }).errors.some(({ code }) => code === "direct-api-drift"));
  });
});

test("new client domain code must construct LoadState and CommandResult through canonical helpers", () => {
  withFixture({}, (root) => {
    const baseline = captureArchitectureBaseline(root);
    const parallel = join(root, "src/domain/commentLoad.mjs");
    writeFileSync(parallel, "export const loadingComments = { scope: \"guest\", status: \"loading\", data: [], error: null, updatedAt: null };\nexport const failedCommand = { ok: false, error: new Error(\"nope\") };\n");
    assert.ok(inspectArchitecture({ root, baseline }).errors.some(({ code, path }) => code === "canonical-contract-bypass" && path === "src/domain/commentLoad.mjs"));
  });
});

test("canonical helper calls are accepted, including aliased imports", () => {
  withFixture({
    "src/features/comments/commentState.ts": "import { createLoadState as makeLoadState } from \"../../domain/loadState.mjs\";\nimport { commandSuccess } from \"../../domain/commandResult.mjs\";\nexport const initialComments = makeLoadState({ scope: \"guest\", status: \"idle\", data: [], error: null, updatedAt: null });\nexport const savedComment = (value: unknown) => commandSuccess(value);\n",
  }, (root) => {
    const baseline = captureArchitectureBaseline(root);
    assert.equal(inspectArchitecture({ root, baseline }).errors.some(({ code }) => code === "canonical-contract-bypass"), false);
  });
});

test("canonical modules reject duplicate helpers and unreviewed exports", () => {
  withFixture({}, (root) => {
    const baseline = captureArchitectureBaseline(root);
    writeFileSync(join(root, "src/domain/feedState.mjs"), "export function commandSuccess(value) { return value; }\n");
    assert.ok(inspectArchitecture({ root, baseline }).errors.some(({ code }) => code === "canonical-helper-duplicate"));

    writeFileSync(join(root, "src/domain/feedState.mjs"), "export const selectFeed = (rows) => rows;\n");
    const commandPath = join(root, "src/domain/commandResult.mjs");
    writeFileSync(commandPath, `${fixtureCanonicalCommandResult()}export default () => null;\n`);
    assert.ok(inspectArchitecture({ root, baseline }).errors.some(({ code }) => code === "canonical-contract-exports"));
  });
});

test("the raw api adapter cannot be re-exported through a boundary alias", () => {
  withFixture({
    "src/lib/api.js": "export async function api() { return {}; }\n",
  }, (root) => {
    const baseline = captureArchitectureBaseline(root);
    writeFileSync(join(root, "src/lib/http.js"), "export { api as request } from \"./api.js\";\n");
    assert.ok(inspectArchitecture({ root, baseline }).errors.some(({ code, path }) => code === "api-adapter-reexport" && path === "src/lib/http.js"));
  });
});

test("async catches cannot turn failures into ambiguous success sentinels", () => {
  withFixture({}, (root) => {
    const baseline = captureArchitectureBaseline(root);
    const service = join(root, "src/features/comments/commentService.ts");
    mkdirSync(dirname(service), { recursive: true });
    writeFileSync(service, "export async function fetchComments() { try { throw new Error(\"offline\"); } catch { return []; } }\n");
    assert.ok(inspectArchitecture({ root, baseline }).errors.some(({ code }) => code === "ambiguous-async-result"));

    writeFileSync(service, "export async function fetchComments() { try { throw new Error(\"offline\"); } catch { return []; } // architecture: allow-ambiguous-result -- optional local suggestions may be absent\n}\n");
    assert.equal(inspectArchitecture({ root, baseline }).errors.some(({ code }) => code === "ambiguous-async-result"), false);
  });
});

test("new empty catches need a local explanation", () => {
  withFixture({}, (root) => {
    const baseline = captureArchitectureBaseline(root);
    writeFileSync(join(root, "src/lib/api.js"), "export async function fetchFeed() { try { return []; } catch {} }\n");
    assert.ok(inspectArchitecture({ root, baseline }).errors.some(({ code }) => code === "empty-catch"));

    writeFileSync(join(root, "src/lib/api.js"), "export async function fetchFeed() { try { return []; } catch {} // architecture: allow-empty-catch -- optional cleanup cannot affect the result\n}\n");
    assert.equal(inspectArchitecture({ root, baseline }).errors.some(({ code }) => code === "empty-catch"), false);
  });
});

test("root runtime entrypoints are included in governance scanning", () => {
  withFixture({
    "src/lib/api.js": "export async function api() { return {}; }\n",
    "server/runtime.js": "export const secret = true;\n",
  }, (root) => {
    const baseline = captureArchitectureBaseline(root);
    writeFileSync(join(root, "App.js"), "import { api } from \"./src/lib/api.js\";\nimport { secret } from \"./server/runtime.js\";\nexport function App() { try { boot(); } catch {} fetch(\"/raw\"); return api(\"/api/feed\") || secret; }\n");
    const errors = inspectArchitecture({ root, baseline }).errors;
    assert.ok(errors.some(({ code, path }) => code === "empty-catch" && path === "App.js"));
    assert.ok(errors.some(({ code, path }) => code === "raw-fetch-boundary" && path === "App.js"));
    assert.ok(errors.some(({ code, path }) => code === "direct-api-boundary" && path === "App.js"));
    assert.ok(errors.some(({ code, path }) => code === "import-layer" && path === "App.js"));
  });
});

test("empty catch recognition covers promise and try/catch forms", () => {
  assert.equal(unexplainedEmptyCatchCount("try { work(); } catch {}\nwork().catch(() => {});"), 2);
  assert.equal(unexplainedEmptyCatchCount("try { work(); } catch {} // architecture: allow-empty-catch -- teardown is best effort only"), 0);
});

test("removing debt makes the baseline stale until it is shrunk", () => {
  withFixture({
    "src/lib/api.js": "export async function fetchFeed() { try { return []; } catch {} }\n",
  }, (root) => {
    const baseline = captureArchitectureBaseline(root);
    writeFileSync(join(root, "src/lib/api.js"), "export async function fetchFeed() { return []; }\n");
    assert.ok(inspectArchitecture({ root, baseline }).errors.some(({ code }) => code === "baseline-stale"));
  });
});

test("adopting a dormant canonical export makes its allowance stale", () => {
  withFixture({}, (root) => {
    const baseline = captureArchitectureBaseline(root);
    const service = join(root, "src/features/comments/commentService.ts");
    mkdirSync(dirname(service), { recursive: true });
    writeFileSync(service, "import { commandSuccess } from \"../../domain/commandResult.mjs\";\nexport const saveComment = (value: unknown) => commandSuccess(value);\n");
    const errors = inspectArchitecture({ root, baseline }).errors;
    assert.ok(errors.some(({ code, message }) => code === "baseline-stale" && message.includes("commandResult.mjs#commandSuccess")));
  });
});

test("baseline refresh automation permits shrinkage but refuses to bless new debt", () => {
  withFixture({}, (root) => {
    const baseline = captureArchitectureBaseline(root);
    writeFileSync(join(root, "server/api.js"), "export const routes = { \"GET /api/health\": () => ({}), \"POST /api/comments\": () => ({}) };\n");
    assert.ok(architectureBaselineRefreshBlockers(inspectArchitecture({ root, baseline })).some(({ code }) => code === "legacy-api-route"));

    writeFileSync(join(root, "server/api.js"), "export const routes = {};\n");
    assert.deepEqual(architectureBaselineRefreshBlockers(inspectArchitecture({ root, baseline })), []);
  });
});

test("one-for-one empty catch replacement changes the exact signature", () => {
  withFixture({
    "src/lib/api.js": "export async function fetchFeed() { try { return cleanupFeed(); } catch {} }\n",
  }, (root) => {
    const baseline = captureArchitectureBaseline(root);
    writeFileSync(join(root, "src/lib/api.js"), "export async function fetchFeed() { try { return discardDraft(); } catch {} }\n");
    assert.ok(inspectArchitecture({ root, baseline }).errors.some(({ code }) => code === "empty-catch-drift"));
  });
});
