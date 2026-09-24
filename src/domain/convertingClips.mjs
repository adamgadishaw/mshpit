// What the author reads under a post whose clips are still converting or could
// not be converted. Plain copy, no jargon; empty when there is nothing to say.
export function convertingClipSummary({ converting = 0, failed = 0 } = {}) {
  const waiting = Math.max(0, Math.trunc(Number(converting) || 0));
  const stuck = Math.max(0, Math.trunc(Number(failed) || 0));
  if (!waiting && !stuck) return "";
  const parts = [];
  if (waiting === 1) parts.push("Your clip is still converting. It shows up on this post by itself when it's ready.");
  else if (waiting > 1) parts.push(`${waiting} clips are still converting. They show up on this post by themselves when they're ready.`);
  if (stuck === 1) parts.push("One clip couldn't be converted.");
  else if (stuck > 1) parts.push(`${stuck} clips couldn't be converted.`);
  return parts.join(" ");
}
