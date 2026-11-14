import { mediaProjectPublishedMedia, moveMediaProjectAsset } from "./mediaProject.mjs";

// Move by identity against the latest project, including server-converting clips.
// Keep the compatibility URL projection in lockstep with canonical ordering.
export function moveComposerMedia(project, id, direction, busy = false) {
  if (busy || ![-1, 1].includes(direction)) return null;
  const index = project.assets.findIndex((asset) => asset.id === id);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= project.assets.length) return null;
  const next = moveMediaProjectAsset(project, id, destination);
  return { project: next, photos: mediaProjectPublishedMedia(next).map((item) => item.url) };
}
