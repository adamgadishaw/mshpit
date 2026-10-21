/** Server authority is separate from Expo's public, build-time renderer flag. */
export function mapLibreServerEnabled(env = process.env) {
  return (env?.NODE_ENV === "development" && env?.MSHPIT_WEB_MAPLIBRE_PREVIEW === "1")
    || (env?.NODE_ENV === "production" && env?.MSHPIT_WEB_MAPLIBRE_ENABLED === "1");
}
