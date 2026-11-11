export function pageTranslation(dx, width, offset = 0) {
  'worklet';
  return Math.max(-width, Math.min(width, dx)) + offset * width;
}
export function pageSettleDuration(dx, width, direction, velocityX = 0) {
  'worklet';
  const target = direction === 'negative' ? -width : width;
  return Math.max(110, Math.min(260, Math.abs(target - dx) / Math.max(850, Math.abs(velocityX)) * 1000));
}
