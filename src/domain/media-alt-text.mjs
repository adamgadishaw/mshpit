const clean = (value) => typeof value === "string" ? value.trim() : "";

export function mediaAltTextState(asset) {
  if (!asset || asset.kind !== "image") return "ignored";
  if (asset.decorative === true || asset.altTextRequired === false || clean(asset.id).startsWith("legacy:")) return "optional";
  return clean(asset.altText) ? "complete" : "missing";
}

export function mediaAltTextCompletion(assets) {
  const photos = (Array.isArray(assets) ? assets : []).filter((asset) => asset?.kind === "image");
  const states = photos.map(mediaAltTextState);
  const completed = states.filter((state) => state === "complete").length;
  const missing = states.filter((state) => state === "missing").length;
  const optional = states.filter((state) => state === "optional").length;
  const tracked = completed + missing;
  return {
    photos: photos.length,
    tracked,
    completed,
    missing,
    optional,
    progress: tracked ? completed / tracked : null,
    label: tracked
      ? `${completed} of ${tracked} photo${tracked === 1 ? "" : "s"} described`
      : optional
        ? `${optional} optional photo${optional === 1 ? "" : "s"}`
        : "No photos to describe",
  };
}

export function mediaAltTextGuidance(asset, { photoIndex = 0, photoCount = 0 } = {}) {
  const state = mediaAltTextState(asset);
  const position = photoCount > 0 && photoIndex >= 0
    ? `Photo ${Math.min(photoCount, photoIndex + 1)} of ${photoCount}`
    : "Photo description";
  if (state === "optional") {
    return {
      position,
      state,
      reminder: "A description is optional for this decorative or older photo. Add one when the visual context matters.",
      guidance: "If you add one, describe the useful context a listener cannot get from the caption alone.",
      placeholder: "Describe any useful visual context.",
    };
  }

  const width = Number(asset?.width) || 0;
  const height = Number(asset?.height) || 0;
  const orientation = width > height * 1.15 ? "landscape" : height > width * 1.15 ? "portrait" : "square";
  const guidance = orientation === "portrait"
    ? "Start with the main person or action, then add the setting and any important visible text."
    : orientation === "landscape"
      ? "Describe the overall scene first, then the performers, crowd, or details that carry the moment."
      : "Name the main subject, what is happening, and the setting; skip details already clear from the caption.";
  return {
    position,
    state,
    reminder: state === "complete"
      ? "Description added. Read it once without looking at the photo to check that it carries the moment."
      : "Add a short human-written description so screen-reader listeners can follow this photo.",
    guidance,
    placeholder: orientation === "landscape"
      ? "Example: A wide view of the band under blue lights as the front rows raise their hands."
      : orientation === "portrait"
        ? "Example: The singer leans toward the crowd under amber stage lights."
        : "Example: Two friends smile beside the venue marquee before the show.",
  };
}
