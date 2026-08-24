import { runImageProcessorWorkerOperation } from "./imageProcessorWorkerOperation.js";

function safeError(error) {
  const code = /^[a-z0-9_]{1,64}$/i.test(String(error?.code || ""))
    ? String(error.code)
    : "decode";
  const message = typeof error?.message === "string" && error.message
    ? error.message.slice(0, 400)
    : "Image processing failed safely.";
  return { code, message };
}

async function respond(payload) {
  if (typeof process.send !== "function") {
    process.exitCode = 1;
    return;
  }
  try {
    const result = await runImageProcessorWorkerOperation(payload);
    process.send({ ok: true, result }, undefined, undefined, () => process.disconnect());
  } catch (error) {
    process.send({ ok: false, error: safeError(error) }, undefined, undefined, () => process.disconnect());
  }
}

process.once("message", (payload) => { void respond(payload); });
