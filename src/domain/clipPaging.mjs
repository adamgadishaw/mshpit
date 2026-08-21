export function clipPageIndex(offsetY, pageHeight, pageCount) {
  const height = Math.max(1, Number(pageHeight) || 1);
  const count = Math.max(0, Math.trunc(Number(pageCount) || 0));
  if (!count) return 0;
  return Math.min(count - 1, Math.max(0, Math.round((Number(offsetY) || 0) / height)));
}

export function clipPageNeedsMore(index, pageCount, threshold = 2) {
  const count = Math.max(0, Math.trunc(Number(pageCount) || 0));
  if (!count) return false;
  return Math.max(0, Math.trunc(Number(index) || 0)) >= Math.max(0, count - Math.max(1, Math.trunc(Number(threshold) || 2)));
}

export function clipRenderWindow(activeIndex, pageCount, radius = 4) {
  const count = Math.max(0, Math.trunc(Number(pageCount) || 0));
  if (!count) return { start: 0, end: 0 };
  const active = clipPageIndex(activeIndex, 1, count);
  const boundedRadius = Math.max(1, Math.min(8, Math.trunc(Number(radius) || 4)));
  return {
    start: Math.max(0, active - boundedRadius),
    end: Math.min(count, active + boundedRadius + 1),
  };
}

export function clipKeyboardTarget({ key, activeIndex = 0, pageCount = 0, tagName = "", isContentEditable = false } = {}) {
  const count = Math.max(0, Math.trunc(Number(pageCount) || 0));
  if (!count) return null;
  const interactive = isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "VIDEO", "AUDIO"].includes(String(tagName).toUpperCase());
  if (interactive) return null;
  const active = clipPageIndex(activeIndex, 1, count);
  if (key === "ArrowDown" || key === "PageDown") return Math.min(count - 1, active + 1);
  if (key === "ArrowUp" || key === "PageUp") return Math.max(0, active - 1);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
