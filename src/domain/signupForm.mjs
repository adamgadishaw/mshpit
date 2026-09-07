import { cleanEmail, cleanHandle, cleanName, isEmail, isHandle, isName, isPassword } from "./validation.mjs";
import { profileGenreSelection } from "./genrePreferences.mjs";

// Current React Native Web does not project every accessibilityState/value
// field. Keep native props and explicitly mirror only the web ARIA contract.
export function signupAriaProps(platform, state = {}, value = {}) {
  if (platform !== "web") return {};
  const props = {};
  for (const name of ["checked", "disabled", "busy", "expanded"]) {
    if (typeof state[name] === "boolean") props[`aria-${name}`] = state[name];
  }
  for (const [name, attribute] of [["min", "aria-valuemin"], ["max", "aria-valuemax"], ["now", "aria-valuenow"], ["text", "aria-valuetext"]]) {
    if (value[name] !== undefined) props[attribute] = value[name];
  }
  return props;
}

export function signupAccountError({ name, handle, email, password } = {}, availability = null) {
  if (!isName(name)) return { field: "name", message: "Add your name to continue." };
  if (!isHandle(handle)) return { field: "handle", message: "Use 3 to 20 letters, numbers, or underscores for your @username." };
  if (!isEmail(email)) return { field: "email", message: "Enter a valid email address." };
  if (!isPassword(password)) return { field: "password", message: "Use 8 or more characters, including a letter and a number." };
  if (availability?.handle === cleanHandle(handle) && availability.available === false) {
    return { field: "handle", message: "That @username is taken. Try another." };
  }
  return null;
}

export function signupMusicError({ genres, ageBand, agreed } = {}) {
  const selection = profileGenreSelection(genres);
  if (!selection.valid) return { field: "genres", message: selection.error };
  if (!["13_17", "18_plus"].includes(ageBand)) return { field: "ageBand", message: "Choose your age group to continue." };
  if (agreed !== true) return { field: "agreed", message: "Agree to the Terms & Conditions and Privacy policy to create your account." };
  return null;
}

export function signupFormPayload({ name, handle, email, password, city, genres, ageBand, agreed, analyticsConsent } = {}) {
  const error = signupAccountError({ name, handle, email, password }) || signupMusicError({ genres, ageBand, agreed });
  if (error) throw new TypeError(error.message);
  return { name: cleanName(name), handle: cleanHandle(handle), email: cleanEmail(email), password,
    city: city?.city, location: city || null, genres: profileGenreSelection(genres).genres,
    ageBand, agreedToTerms: true, analyticsConsent: analyticsConsent === true };
}

export function signupHandlePresentation(resource, value) {
  const handle = cleanHandle(value);
  if (!handle) return { tone: "muted", message: "3–20 letters, numbers, or underscores." };
  if (!isHandle(handle)) return { tone: "muted", message: "Use at least 3 characters." };
  if (resource?.scope !== handle || ["idle", "loading", "refreshing"].includes(resource.status)) {
    return { tone: "muted", message: "Checking availability…" };
  }
  if (resource.status === "error") {
    const status = Number(resource.error?.status || resource.error?.meta?.status);
    if (status === 400) return { tone: "error", message: String(resource.error?.userMessage || resource.error?.message || "Choose another @username.").slice(0, 280) };
    return { tone: "muted", message: status === 429
      ? "Too many checks. Wait a moment, then try again."
      : "Couldn’t check right now. Your @username will be confirmed after verification." };
  }
  if (resource.data?.handle !== handle || typeof resource.data.available !== "boolean") return { tone: "muted", message: "Not checked yet." };
  return resource.data.available
    ? { tone: "good", message: "Available now. Confirmed after verification." }
    : { tone: "error", message: "That @username is taken. Try another." };
}
