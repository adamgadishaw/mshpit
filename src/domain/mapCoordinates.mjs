// Missing coordinates are not zero. Validate before coercing provider/database
// values so empty fields never become a real point in the Gulf of Guinea.
const coordinateNumber = (value, limit) => {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
};

export function mapCoordinate(point) {
  if (!point || typeof point !== "object" || Array.isArray(point)) return null;
  const lat = coordinateNumber(point.lat, 90), lng = coordinateNumber(point.lng, 180);
  return lat == null || lng == null ? null : { lat, lng };
}

// Map renderers retain the venue identity, actions, and display metadata while
// sharing the same strict coordinate boundary as city/distance calculations.
export function mapPoint(point) {
  const coord = mapCoordinate(point);
  return coord ? { ...point, ...coord } : null;
}
