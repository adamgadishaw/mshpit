const PROFILE_IMAGE_CONTRACTS = Object.freeze({
  avatar: Object.freeze({
    purpose: "avatar",
    aspect: Object.freeze([1, 1]),
    outputWidth: 1024,
    outputHeight: 1024,
  }),
  banner: Object.freeze({
    purpose: "banner",
    aspect: Object.freeze([3, 1]),
    outputWidth: 1800,
    outputHeight: 600,
  }),
});

export function profileImageContract(purpose) {
  return PROFILE_IMAGE_CONTRACTS[String(purpose || "").trim().toLowerCase()] || null;
}

export function profileImagePickerOptions(purpose, { platform } = {}) {
  const contract = profileImageContract(purpose);
  if (!contract) throw new TypeError("Profile image purpose must be avatar or banner.");
  const nativeCrop = platform === "android" || (platform === "ios" && contract.purpose === "avatar");
  return {
    mediaTypes: ["images"],
    allowsEditing: nativeCrop,
    quality: 0.85,
    ...(platform === "ios" ? { shouldDownloadFromNetwork: true } : {}),
    ...(platform === "android" ? { aspect: [...contract.aspect] } : {}),
  };
}

export function profileImageSelectionHint(purpose, { platform } = {}) {
  const contract = profileImageContract(purpose);
  if (!contract) throw new TypeError("Profile image purpose must be avatar or banner.");
  const dimensions = `${contract.outputWidth} \u00d7 ${contract.outputHeight}`;
  if (platform === "web") return contract.purpose === "avatar"
    ? "Square photo · drag and zoom to adjust"
    : "Wide 3:1 image · drag and zoom to adjust";
  return contract.purpose === "avatar"
    ? `Square photo \u00b7 centered crop \u00b7 ${dimensions}`
    : `Wide 3:1 image \u00b7 centered crop \u00b7 ${dimensions}`;
}

export function profileImageCropRectangle(crop, width, height, purpose) {
  const contract = profileImageContract(purpose);
  const values = [crop?.x, crop?.y, crop?.width, crop?.height];
  if (!contract || ![width,height].every(value => Number.isFinite(value) && value > 0) || !values.every(Number.isFinite) || crop.x < 0 || crop.y < 0
    || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1.000001 || crop.y + crop.height > 1.000001) {
    throw new TypeError("The selected photo crop is invalid.");
  }
  const rect = { x: crop.x * width, y: crop.y * height, width: crop.width * width, height: crop.height * height };
  if (Math.abs(rect.width / rect.height - contract.outputWidth / contract.outputHeight) > 0.001) {
    throw new TypeError("The photo crop must match its profile shape.");
  }
  return rect;
}

export function changedProfileImageFields({
  avatarUri,
  banner,
  avatarChanged = false,
  bannerChanged = false,
} = {}) {
  return {
    ...(avatarChanged ? { avatarUri: avatarUri || null } : {}),
    ...(bannerChanged ? { banner: banner || null } : {}),
  };
}
