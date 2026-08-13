// Background enrichment is useful, but it must never compete with the web app
// during a hosted cold start. Render exposes RENDER=true to every service. On
// that runtime jobs are therefore opt-in; local development keeps the existing
// opt-out behavior so the schedulers remain easy to exercise.

const ENABLED_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);

const isRenderRuntime = (env) => String(env?.RENDER ?? "").trim().toLowerCase() === "true";

export function backgroundJobEnabled(env, key) {
  const value = String(env?.[key] ?? "").trim().toLowerCase();
  // An explicit value is an opt-in switch, so typos must fail closed. Treating
  // any unknown text as true can turn a misspelled "false" into provider fan-out
  // during a cold start.
  if (value) return ENABLED_VALUES.has(value);
  return !isRenderRuntime(env);
}

