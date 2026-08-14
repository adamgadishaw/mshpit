// Pure playback milestones shared by the reel and full-screen viewer. Keeping
// this separate from expo-video makes boundary behavior executable without a
// decoder, network request, or platform-specific player mock.
export function pendingVideoMilestones({ currentTime = 0, duration = 0, seen = [], ended = false } = {}) {
  const total = Number(duration);
  const current = Math.max(0, Number(currentTime) || 0);
  const recorded = seen instanceof Set ? seen : new Set(Array.isArray(seen) ? seen : []);
  const pending = [];
  if (Number.isFinite(total) && total > 0) {
    const progress = current / total;
    for (const [threshold, milestone] of [[0.25, "25"], [0.5, "50"], [0.75, "75"]]) {
      if (progress >= threshold && !recorded.has(milestone)) pending.push(milestone);
    }
  }
  // Completion comes from the player's authoritative end event. A time update
  // near the end can still be followed by seeking or a decode failure.
  if (ended && !recorded.has("100")) pending.push("100");
  return pending;
}
