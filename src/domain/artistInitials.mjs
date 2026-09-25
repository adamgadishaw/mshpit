// One way to draw an artist's initials everywhere: the first letters of the
// first two words ("Little River Band" -> "LR"), or the first two letters of a
// one-word name ("Drake" -> "DR"). A leading "The" is skipped ("The Weeknd" ->
// "WE"), so the hero, the avatar and the picker always agree.
export function artistInitials(name, fallback = "?") {
  const words = String(name || "").trim().split(/\s+/u).filter(Boolean);
  const meaningful = words.length > 1 && /^the$/iu.test(words[0]) ? words.slice(1) : words;
  if (!meaningful.length) return fallback;
  const letters = meaningful.length > 1
    ? meaningful.slice(0, 2).map((word) => Array.from(word)[0]).join("")
    : Array.from(meaningful[0]).slice(0, 2).join("");
  return letters.toLocaleUpperCase("en") || fallback;
}
