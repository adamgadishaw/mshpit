import { parsePath, postPath } from "./urls.mjs";

const VERSION = "mshpit-navigation-v1";
const validState = (state) => state?.pit === VERSION && typeof state.key === "string"
  && Number.isSafeInteger(state.index) && state.index >= 0;

// A public post URL can display the concert summary or the original discussion.
// Persist only that allowlisted view choice; derive its ID from the current URL
// and always re-fetch content under the current account after a reload.
export function publicPresentationHintFromHistory(state, path) {
  if (!validState(state) || state.presentation !== "post") return null;
  const parsed = parsePath(path);
  const id = parsed?.type === "show" ? parsed.value : null;
  return typeof id === "string" && id.length <= 200 && postPath(id) === path ? { postId: id } : null;
}

const positionOnly = (state, path) => ({ pit: VERSION, key: state.key, index: state.index,
  ...(publicPresentationHintFromHistory(state, path) ? { presentation: "post" } : {}),
});
const withPresentation = (state, snapshot, path) => {
  const postId = snapshot?.stack?.at(-1)?.post?.id;
  const presentation = typeof postId === "string" && postId.length > 0 && postId.length <= 200 && postPath(postId) === path;
  return { pit: VERSION, key: state.key, index: state.index, ...(presentation ? { presentation: "post" } : {}) };
};

// Only opaque positions and the optional public view enum enter browser history.
// Drafts and member data stay in bounded visit-local memory, cleared when the
// account changes. No object from history can grant access to a post.
export function createBrowserHistory({ history, location, limit = 80 }) {
  const capacity = Math.min(80, Math.max(1, Number.isSafeInteger(limit) ? limit : 80));
  const records = new Map();
  let sequence = 0;
  const visit = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let current = null;
  let currentPath = location.pathname || "/";
  let generation = 0;
  let restoringKey = null;
  const remember = (state, snapshot, path) => {
    records.delete(state.key);
    records.set(state.key, { snapshot, path });
    while (records.size > capacity) records.delete(records.keys().next().value);
  };
  const fresh = (index) => ({ pit: VERSION, key: `${visit}-${++sequence}`, index });
  const initialize = (snapshot) => {
    current = validState(history.state) ? positionOnly(history.state, location.pathname) : fresh(0);
    currentPath = location.pathname || "/";
    history.replaceState(current, "", location.href || currentPath);
    remember(current, snapshot, currentPath);
  };
  const capture = (snapshot) => {
    if (!current) return;
    if (location.pathname === currentPath && !snapshot?.stack?.at(-1)?.routeLoading) {
      const next = withPresentation(current, snapshot, currentPath);
      if (next.presentation !== current.presentation) {
        history.replaceState(next, "", location.href || currentPath);
        current = next;
      }
    }
    remember(current, snapshot, currentPath);
  };
  const write = (snapshot, path = currentPath, mode = "push") => {
    if (!current) initialize(snapshot);
    generation++;
    restoringKey = null;
    const destination = path || currentPath;
    const replace = mode === "replace";
    const next = withPresentation(fresh(current.index + (replace ? 0 : 1)), snapshot, destination);
    history[replace ? "replaceState" : "pushState"](next, "", destination);
    current = next;
    currentPath = destination;
    remember(next, snapshot, destination);
  };
  const preparePop = (state) => {
    if (restoringKey && state?.key === restoringKey) { restoringKey = null; return null; }
    const token = ++generation;
    const previous = current;
    const previousPath = currentPath;
    const path = location.pathname || "/";
    const target = validState(state) ? positionOnly(state, path) : fresh(0);
    const cached = records.get(target.key);
    return {
      path,
      publicFrameHint: publicPresentationHintFromHistory(target, path),
      snapshot: cached?.path === path ? cached.snapshot : null,
      accept() {
        if (generation !== token) return false;
        current = target;
        currentPath = path;
        if (!validState(state)) history.replaceState(target, "", location.href || path);
        return true;
      },
      cancel() {
        if (generation !== token || !previous) return;
        const delta = validState(state) ? previous.index - state.index : 0;
        if (delta) {
          restoringKey = previous.key;
          history.go(delta);
        } else {
          // Old unmanaged entries have no comparable position.
          history.pushState(previous, "", previousPath);
        }
      },
    };
  };
  return {
    initialize, capture, write, preparePop,
    canGoBack: () => !!current && current.index > 0,
    clear: () => { records.clear(); restoringKey = null; generation++; },
    get path() { return currentPath; },
    get size() { return records.size; },
  };
}
