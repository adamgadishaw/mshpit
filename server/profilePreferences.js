// Legacy accounts remain visible by default. This preference is separate from
// profile audience: hiding the map never removes the underlying concert list.
export function concertMapVisibleFor(user) {
  let extras;
  try { extras = JSON.parse(user?.extras || "{}"); }
  catch { extras = null; }
  return !extras || typeof extras !== "object" || Array.isArray(extras)
    || extras.concertMapVisible !== false;
}
