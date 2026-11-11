// A bounded set of actual mounted detail occurrences, separate from logical
// history. Eviction never changes navigation and never invents an old view.
export const IOS_RETAINED_DETAIL_LIMIT = 6;
const families = { artistName: new Set(["artistName"]), profileId: new Set(["profileId", "profileHandle", "profileSection"]),
  openLog: new Set(["openLog"]), post: new Set(["post"]) };
export function iosDetailCanRetain(frame) {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return false;
  const family = Object.keys(families).filter(key => !!frame[key]);
  return family.length === 1 && Object.keys(frame).every(key => families[family[0]].has(key));
}
const empty = () => ({ scope: null, history: [], entries: [], elements: new Map(), top: null });
export function createIOSDetailRetention({ limit = IOS_RETAINED_DETAIL_LIMIT } = {}) {
  const capacity = Math.max(1, Math.min(12, Math.floor(Number(limit)) || IOS_RETAINED_DETAIL_LIMIT));
  let committed = empty(), sequence = 0;
  const plan = ({ frames, scope, privacyRevision, element, enabled = true }) => {
    const previous = committed.scope === scope ? committed : empty();
    const nextFrames = Array.isArray(frames) ? frames : [];
    let prefix = 0;
    while (prefix < previous.history.length && prefix < nextFrames.length
      && previous.history[prefix].frame === nextFrames[prefix]) prefix++;
    const history = [...previous.history.slice(0, prefix), ...nextFrames.slice(prefix)
      .map((frame, index) => ({ frame, index: prefix + index, id: ++sequence }))];
    const top = history.at(-1) || null;
    if (!enabled || !top || !iosDetailCanRetain(top.frame)) return { scope, history, entries: [], elements: new Map(), top, previous: null };
    let barrier = -1;
    for (const occurrence of history) {
      if (!iosDetailCanRetain(occurrence.frame)) barrier = occurrence.index;
    }
    const occurrences = new Set(history);
    const entries = previous.entries.filter(entry => occurrences.has(entry.occurrence)
      && entry.occurrence.index > barrier
      && (entry.occurrence === top || entry.presented && entry.ready && previous.elements.has(entry))
      && (entry.privacyRevision === privacyRevision || entry.occurrence === top));
    let active = entries.find(entry => entry.occurrence === top);
    if (!active) {
      active = { occurrence: top, privacyRevision, ready: false, presented: false, connected: false, layoutEpoch: 0 };
      entries.push(active);
    }
    entries.sort((a, b) => a.occurrence.index - b.occurrence.index);
    while (entries.length > capacity) entries.shift();
    const predecessor = entries.find(entry => entry.occurrence === history.at(-2));
    const previousEntry = predecessor?.presented && predecessor.ready
      && predecessor.privacyRevision === privacyRevision ? predecessor : null;
    const elements = new Map(entries.map(entry => [entry, entry === active ? element : previous.elements.get(entry)]));
    return { scope, history, entries, elements, top, previous: previousEntry };
  };
  return {
    plan,
    // Planning is pure relative to committed state. A discarded concurrent
    // render cannot evict the mounted history or manufacture presentation proof.
    commit(next) { committed = next; },
    current(entry) { return committed.entries.includes(entry) && committed.top === entry.occurrence; },
    contains(entry) { return committed.entries.includes(entry); },
    ready(entry, ready, { active = false, privacyRevision } = {}) {
      const before = entry.ready, shown = entry.presented;
      entry.ready = !!ready;
      if (ready && active && this.current(entry) && entry.privacyRevision === privacyRevision) entry.presented = true;
      return before !== entry.ready || shown !== entry.presented;
    },
  };
}
