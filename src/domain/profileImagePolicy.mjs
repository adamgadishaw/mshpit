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

export function profileImageSelectionHint(purpose) {
  const contract = profileImageContract(purpose);
  if (!contract) throw new TypeError("Profile image purpose must be avatar or banner.");
  const dimensions = `${contract.outputWidth} \u00d7 ${contract.outputHeight}`;
  return contract.purpose === "avatar"
    ? `Square photo \u00b7 centered crop \u00b7 ${dimensions}`
    : `Wide 3:1 image \u00b7 centered crop \u00b7 ${dimensions}`;
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
