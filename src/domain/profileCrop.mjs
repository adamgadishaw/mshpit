const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

// A cover crop in source-image coordinates. The center is clamped so dragging
// and zooming can never expose an empty edge, including extreme panoramas.
export function profileCropPlan({ imageWidth, imageHeight, frameWidth, frameHeight, zoom = 1, centerX = 0.5, centerY = 0.5 }) {
  for (const value of [imageWidth, imageHeight, frameWidth, frameHeight]) {
    if (!Number.isFinite(value) || value <= 0) throw new TypeError("A crop needs readable image and frame dimensions.");
  }
  const level = clamp(finite(zoom, 1), 1, 4);
  const scale = Math.max(frameWidth / imageWidth, frameHeight / imageHeight) * level;
  const width = Math.min(imageWidth, frameWidth / scale), height = Math.min(imageHeight, frameHeight / scale);
  const x = clamp(finite(centerX, 0.5) * imageWidth - width / 2, 0, imageWidth - width);
  const y = clamp(finite(centerY, 0.5) * imageHeight - height / 2, 0, imageHeight - height);
  return {
    zoom: level, scale, x, y, width, height,
    centerX: (x + width / 2) / imageWidth, centerY: (y + height / 2) / imageHeight,
    left: -x * scale, top: -y * scale,
    renderedWidth: imageWidth * scale, renderedHeight: imageHeight * scale,
    selection: { x: x / imageWidth, y: y / imageHeight, width: width / imageWidth, height: height / imageHeight },
  };
}

export function profileCropAfterDrag(plan, { deltaX = 0, deltaY = 0, imageWidth, imageHeight }) {
  return {
    zoom: plan.zoom,
    centerX: plan.centerX - finite(deltaX, 0) / (plan.scale * imageWidth),
    centerY: plan.centerY - finite(deltaY, 0) / (plan.scale * imageHeight),
  };
}
