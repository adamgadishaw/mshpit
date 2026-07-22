// Public Expo variables are embedded into the client bundle at build time.
// Demo content therefore requires both a development build and an explicit opt-in;
// setting the flag on a production build can never enable prototype accounts/data.
export function demoDataEnabled(isDevelopment, publicFlag) {
  return isDevelopment === true && publicFlag === "true";
}

const IS_DEVELOPMENT = typeof __DEV__ !== "undefined"
  ? __DEV__
  : process.env.NODE_ENV === "development";

export const ENABLE_DEMO_DATA = demoDataEnabled(
  IS_DEVELOPMENT,
  process.env.EXPO_PUBLIC_ENABLE_DEMO_DATA,
);

// Clips remains in the source tree and API contract for a later media-pipeline
// pass, but is deliberately absent from navigation during ALPHA. Keeping this a
// named gate avoids deleting the work or scattering temporary booleans in UI.
export const ENABLE_CLIPS = false;
