// Product engagement only, never an advertising/billing receipt. Only a
// plausible, visible, playing interval is credited; seeking is not watching.
export function createPlaybackMeasurement() {
  let previous = null;
  let ranges = [];
  let watchedSeconds = 0;
  let lastDuration = 0;
  const sent = new Set();
  const coverage = () => ranges.reduce((sum, [start, end]) => sum + end - start, 0);
  function addRange(start, end) {
    const merged = [];
    for (const range of [...ranges, [start, end]].sort((a, b) => a[0] - b[0])) {
      const tail = merged[merged.length - 1];
      if (tail && range[0] <= tail[1]) tail[1] = Math.max(tail[1], range[1]);
      else merged.push([...range]);
    }
    // Bound pathological scrub patterns. Dropping a small isolated segment can
    // only undercount; it must never manufacture coverage between segments.
    ranges = merged.length <= 256 ? merged : merged.sort((a,b) => (b[1]-b[0])-(a[1]-a[0])).slice(0,256).sort((a,b) => a[0]-b[0]);
  }
  function sample({ currentTime, duration, playing = false, visible = false, playbackRate = 1, at = Date.now(), ended = false } = {}) {
    const position = Number(currentTime), total = Number(duration), instant = Number(at);
    if (!Number.isFinite(position) || position < 0 || !Number.isFinite(total) || total <= 0 || !Number.isFinite(instant)) {
      previous = null;
      return [];
    }
    lastDuration = total;
    const rate = Math.max(0.25, Math.min(4, Number(playbackRate) || 1));
    const eligible = playing === true && visible === true;
    if (eligible && previous?.eligible) {
      const wall = (instant - previous.at) / 1000;
      const movement = position - previous.position;
      const maxMovement = wall * Math.max(rate, previous.rate);
      if (wall > 0 && wall <= 3 && movement > 0 && movement <= maxMovement + 0.35) {
        const credited = Math.min(movement, maxMovement);
        addRange(Math.max(0, Math.min(total, position) - credited), Math.min(total, position));
        watchedSeconds += Math.min(wall, movement / rate);
      }
    }
    previous = { position, at: instant, rate, eligible };
    const fraction = Math.min(1, coverage() / total);
    const pending = [];
    for (const [threshold, milestone] of [[0.25, "25"], [0.5, "50"], [0.75, "75"], [0.95, "100"]]) {
      if (fraction >= threshold && eligible && (milestone !== "100" || ended) && !sent.has(milestone)) {
        sent.add(milestone); pending.push(milestone);
      }
    }
    return pending;
  }
  return { sample, interrupt: () => { previous = null; },
    metrics: () => ({ watchedSeconds, coveredSeconds: coverage(), duration: lastDuration }) };
}
