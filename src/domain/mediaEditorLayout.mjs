// Reserve a real preview slice above the narrow-screen inspector. Keeping the
// calculation pure locks the iPhone SE and modern-phone bounds in tests.
export function mediaEditorNarrowStageHeight(viewportHeight) {
  const parsed = Number(viewportHeight);
  const height = Number.isFinite(parsed) && parsed > 0 ? parsed : 667;
  return Math.max(176, Math.min(300, Math.round(height * 0.35)));
}

// Wide Studio still has fixed chrome above and below the preview (header,
// history, media rail, padding and metadata). Basing the stage on 68% of the
// raw window alone clips it on common 768/900px laptop displays.
export function mediaEditorWideStageHeight(viewportHeight) {
  const parsed = Number(viewportHeight);
  const height = Number.isFinite(parsed) && parsed > 0 ? parsed : 900;
  return Math.max(180, Math.min(720, Math.round(height * 0.68), Math.round(height - 320)));
}
