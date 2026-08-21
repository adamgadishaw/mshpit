import { mediaPreviewTransformPlan, normalizeMediaEdit } from "./mediaEdit.mjs";

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function touchCentroid(touches = []) {
  const points = Array.from(touches || []).filter((touch) => Number.isFinite(Number(touch?.pageX)) && Number.isFinite(Number(touch?.pageY)));
  if (!points.length) return null;
  return {
    x: points.reduce((sum, touch) => sum + Number(touch.pageX), 0) / points.length,
    y: points.reduce((sum, touch) => sum + Number(touch.pageY), 0) / points.length,
  };
}

export function touchDistance(touches = []) {
  const points = Array.from(touches || []);
  if (points.length < 2) return null;
  const dx = finite(points[1]?.pageX) - finite(points[0]?.pageX);
  const dy = finite(points[1]?.pageY) - finite(points[0]?.pageY);
  const distance = Math.hypot(dx, dy);
  return distance > 0 ? distance : null;
}

// Convert a direct manipulation in screen pixels back into PIT's normalized
// rotated-source focal coordinates. This uses the same crop/scale plan as the
// authoritative export preview, so dragging the performer right means moving
// the source crop left by the exact corresponding amount.
export function mediaEditorGesturePatch({
  edit,
  sourceWidth,
  sourceHeight,
  viewportWidth,
  viewportHeight,
  deltaX = 0,
  deltaY = 0,
  scale = 1,
} = {}) {
  const base = normalizeMediaEdit(edit, { kind: "image" });
  const plan = mediaPreviewTransformPlan({
    width: sourceWidth,
    height: sourceHeight,
    edit: base,
    viewportWidth,
    viewportHeight,
  });
  return {
    zoom: clamp(base.zoom * Math.max(0.1, finite(scale, 1)), 1, 3),
    focalX: clamp(base.focalX - finite(deltaX) / Math.max(1, plan.scaleX * plan.rotated.width), 0, 1),
    focalY: clamp(base.focalY - finite(deltaY) / Math.max(1, plan.scaleY * plan.rotated.height), 0, 1),
  };
}
