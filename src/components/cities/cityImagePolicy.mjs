export function isHostedCityImage(uri) {
  if (typeof uri !== "string") return false;
  try {
    const url = new URL(uri, "https://mshpit.invalid");
    return /^\/images\/cities\/[a-zA-Z0-9_.-]+$/.test(url.pathname);
  } catch { return false; }
}
