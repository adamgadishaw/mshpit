const COMPATIBLE_IMAGE_PATH = /\.(?:jpe?g|png|webp)$/i;

function safeHttpsImage(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2000) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password && COMPATIBLE_IMAGE_PATH.test(url.pathname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export const isLandingCompatibleImage = (value) => !!safeHttpsImage(value);
export const hasLandingCompatibleImage = (value) => Array.isArray(value) && value.some(isLandingCompatibleImage);
