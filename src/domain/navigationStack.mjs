// Frames are already validated/prepared by the navigation caller. The empty
// frame is the tab surface, and must remain below the first overlay so Back
// always has somewhere to go. This helper never mutates existing frames.
export function replaceNavigationFrame(stack, frame) {
  const previous = Array.isArray(stack) && stack.length ? stack : [{}];

  // An explicit root destination is a return to the tabs, not another overlay.
  if (Object.keys(frame).length === 0) return [frame];

  if (previous.length === 1) {
    const base = previous[0];
    const root = base && Object.keys(base).length === 0 ? base : {};
    return [root, frame];
  }

  return [...previous.slice(0, -1), frame];
}
