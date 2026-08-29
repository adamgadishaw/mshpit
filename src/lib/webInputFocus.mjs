export const WEB_INPUT_FOCUS_ATTRIBUTE = "data-pit-input-focus-visible";

const INPUT_SELECTOR = "input, textarea, select";
const MAX_PARENT_DEPTH = 3;

const cssNumber = (value) => {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const largestCssNumber = (style, names) => Math.max(0, ...names.map((name) => cssNumber(style?.[name])));

const hasPaintedBackground = (value) => {
  const normalized = String(value || "").replace(/\s+/g, "").toLowerCase();
  return !!normalized
    && normalized !== "transparent"
    && normalized !== "rgba(0,0,0,0)"
    && normalized !== "hsla(0,0%,0%,0)";
};

export function hasVisibleInputBoundary(style) {
  const radius = largestCssNumber(style, [
    "borderRadius",
    "borderTopLeftRadius",
    "borderTopRightRadius",
    "borderBottomRightRadius",
    "borderBottomLeftRadius",
  ]);
  const border = largestCssNumber(style, [
    "borderWidth",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
  ]);
  return radius > 0 && (border > 0 || hasPaintedBackground(style?.backgroundColor));
}

const readableRect = (node) => {
  if (typeof node?.getBoundingClientRect !== "function") return null;
  const rect = node.getBoundingClientRect();
  const width = Number(rect?.width);
  const height = Number(rect?.height);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : null;
};

const boundaryFitsControl = (controlRect, boundaryRect) => {
  if (!controlRect || !boundaryRect) return true;
  const wideEnough = boundaryRect.width + 1 >= controlRect.width;
  const tallEnough = boundaryRect.height + 1 >= controlRect.height;
  const closeEnough = boundaryRect.width <= controlRect.width + 192
    && boundaryRect.height <= Math.max(controlRect.height + 48, 96);
  return wideEnough && tallEnough && closeEnough;
};

export function isWebInputControl(node) {
  return typeof node?.matches === "function" && node.matches(INPUT_SELECTOR);
}

export function findWebInputFocusBoundary(control, getStyle) {
  const readStyle = typeof getStyle === "function"
    ? getStyle
    : (node) => globalThis.getComputedStyle?.(node);
  if (!isWebInputControl(control) || typeof globalThis.getComputedStyle !== "function" && !getStyle) return control || null;
  const controlRect = readableRect(control);
  let candidate = control;
  for (let depth = 0; candidate && depth <= MAX_PARENT_DEPTH; depth += 1) {
    const style = readStyle(candidate);
    if (hasVisibleInputBoundary(style) && boundaryFitsControl(controlRect, readableRect(candidate))) return candidate;
    candidate = candidate.parentElement;
  }
  return control;
}

export function isWebFocusVisible(control) {
  if (typeof control?.matches !== "function") return false;
  try {
    return control.matches(":focus-visible");
  } catch {
    // Older embedded browsers may not understand :focus-visible. Keeping a
    // visible ring is safer than silently removing keyboard focus feedback.
    return true;
  }
}
