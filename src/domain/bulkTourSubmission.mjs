import { toIsoDate } from "./dates.mjs";

export function scheduledTourRelease(value, { now = Date.now() } = {}) {
  const iso = toIsoDate(value);
  const releaseAt = iso ? Date.parse(`${iso}T00:00:00`) : Number.NaN;
  if (!iso || !Number.isFinite(releaseAt) || releaseAt <= now) {
    return { ok: false, releaseAt: 0, error: "Choose a future release date." };
  }
  return { ok: true, releaseAt, iso };
}

export function createBulkTourSubmissionLifecycle() {
  let mounted = true;
  let revision = 0;
  return {
    mount() {
      mounted = true;
      revision += 1;
    },
    begin() {
      return { revision: ++revision };
    },
    invalidate() {
      revision += 1;
    },
    isCurrent(token) {
      return mounted && token?.revision === revision;
    },
    unmount() {
      mounted = false;
      revision += 1;
    },
  };
}
