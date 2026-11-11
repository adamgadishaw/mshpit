export function venuePhotoFrameHeight(width, compact = false) {
  return compact ? width >= 900 ? 214 : 180 : width >= 1180 ? 300 : width >= 760 ? 260 : 190;
}
