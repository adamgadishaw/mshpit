// Background enrichment is useful, but it must never compete with the web app
// during a hosted cold start. Render exposes RENDER=true to every service. On
// that runtime jobs are therefore opt-in; local development keeps the existing
// opt-out behavior so the schedulers remain easy to exercise.

const DISABLED_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

const isRenderRuntime = (env) => String(env?.RENDER ?? "").trim().toLowerCase() === "true";

export function backgroundJobEnabled(env, key) {
  const value = String(env?.[key] ?? "").trim().toLowerCase();
  if (value) return !DISABLED_VALUES.has(value);
  return !isRenderRuntime(env);
}

