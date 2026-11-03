const DIMENSIONS = ['performance', 'setlist', 'sound', 'venue', 'crowd', 'experience'];
const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0.5 && value <= 5;
// Read original category evidence. Never reconstruct performance from overall.
export function artistPerformanceRating(dims, band) {
  const source = dims && typeof dims === 'object' && !Array.isArray(dims) ? dims : {};
  if (!DIMENSIONS.some(key => Object.hasOwn(source, key))) return valid(band) ? band : null;
  const values = [source.performance, source.setlist].filter(valid);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
