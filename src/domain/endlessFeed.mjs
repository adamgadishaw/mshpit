// One measured viewport owns one pagination demand. Native end-reached can fire
// repeatedly; it is a hint, never permission for concurrent requests.
export function createEndlessFeed({ changed = () => {}, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let options = {}, mounted = true, timer = null, scheduled = null, pending = null, error = false;
  let height = 0, content = null, offset = 0, demand = false, measuredRows = 0;
  let waiting = null, epoch = 0, emptyPages = 0;
  const valid = () => mounted && options.current?.() && options.enabled && options.ready && !options.loading;
  const nearEnd = () => height > 0 && content != null && content - height - offset <= height * 0.6;
  const clearTimer = () => { if (timer != null) cancel(timer); timer = null; scheduled = null; };
  const work = async (retry = false) => {
    clearTimer();
    if (!valid() || pending || (!retry && (error || options.sourceError)) || (!retry && !demand && !nearEnd())) return;
    if (options.visibleCount >= options.loadedCount && !options.hasMore && !(retry && options.sourceError)) return;
    const ticket = { current: options.current, rows: options.rowsCount, epoch };
    pending = ticket;
    error = false;
    changed();
    try {
      if (options.visibleCount < options.loadedCount && !(retry && options.sourceError)) {
        options.reveal();
        // React must commit the newly revealed rows before another reveal.
        waiting = ticket;
      } else {
        const success = await options.load();
        if (!mounted || ticket.epoch !== epoch || !ticket.current()) return;
        if (!success) error = true;
        else waiting = ticket;
      }
    } catch {
      if (mounted && ticket.epoch === epoch && ticket.current()) error = true;
    } finally {
      if (pending === ticket) pending = null;
      if (mounted) changed();
    }
  };
  const pump = () => {
    if (!valid() || pending || error || options.sourceError) { clearTimer(); return; }
    if (waiting) {
      // Pages with no visible matches produce no native content-size event.
      // Keep their demand alive; pages adding rows must be measured first.
      if (options.rowsCount > waiting.rows && measuredRows < options.rowsCount) { clearTimer(); return; }
      emptyPages = options.rowsCount > waiting.rows ? 0 : Math.min(4, emptyPages + 1);
      waiting = null;
      demand = nearEnd();
    }
    if ((demand || nearEnd()) && (options.visibleCount < options.loadedCount || options.hasMore)) {
      // Pace empty/duplicate-only pages without a tight network/render loop.
      if (timer == null) {
        const ticket = { epoch, current: options.current };
        scheduled = ticket;
        timer = schedule(() => {
          if (scheduled !== ticket || ticket.epoch !== epoch || !ticket.current()) return;
          timer = null; scheduled = null; void work();
        }, 250 * (2 ** emptyPages));
      }
    } else clearTimer();
  };
  return {
    update(next) { options = next; pump(); },
    end() { if (!valid()) return; demand = true; pump(); },
    layout(value) { if (!options.current?.()) return; height = value; pump(); },
    content(value, rows = options.rowsCount) { if (!options.current?.()) return; content = value; measuredRows = rows; demand = nearEnd(); pump(); },
    scroll(value) { if (!options.current?.()) return; offset = Math.max(0, value); demand = nearEnd(); pump(); },
    interact() { emptyPages = 0; clearTimer(); pump(); },
    retry() { if (!valid()) return; emptyPages = 0; error = false; demand = true; waiting = null; void work(true); },
    reset() { clearTimer(); epoch++; pending = null; emptyPages = 0; error = false; demand = false; waiting = null; changed(); },
    connect() { mounted = true; },
    get error() { return error; },
    get loading() { return !!pending; },
    dispose() { mounted = false; epoch++; pending = null; clearTimer(); },
  };
}
