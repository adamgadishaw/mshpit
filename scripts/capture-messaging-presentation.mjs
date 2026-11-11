#!/usr/bin/env node
// Screenshot the local synthetic renders, with an exact mobile viewport.
// Isolated headless profile, no live application or external network traffic.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const directory = process.env.PIT_MESSAGING_EVIDENCE || "/tmp/mshpit-messaging-presentation-evidence";
const chromePath = process.env.PIT_CHROME_BINARY || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = mkdtempSync(join(tmpdir(), "messaging-render-chrome-"));
const chrome = spawn(chromePath, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
  "--host-resolver-rules=MAP * ~NOTFOUND", `--user-data-dir=${profile}`, "--remote-debugging-pipe"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
let sequence = 0, buffer = "";
const pending = new Map();
chrome.stdio[4].on("data", chunk => {
  buffer += chunk.toString(); let boundary;
  while ((boundary = buffer.indexOf("\0")) >= 0) {
    const message = JSON.parse(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 1);
    if (pending.has(message.id)) {
      const request = pending.get(message.id); pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
    }
  }
});
function command(method, params = {}, sessionId) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer }); chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
  });
}
const results = [];
try {
  const { targetId } = await command("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await command("Target.attachToTarget", { targetId, flatten: true });
  await command("Page.enable", {}, sessionId);
  for (const scenario of JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")).scenarios) {
    await command("Emulation.setDeviceMetricsOverride", { width: scenario.width, height: 844, deviceScaleFactor: 2, mobile: true }, sessionId);
    await command("Page.navigate", { url: pathToFileURL(join(directory, `${scenario.name}.html`)).href }, sessionId);
    let layout;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const state = await command("Runtime.evaluate", { expression: "document.readyState === 'complete' && document.body?.dataset.layout", returnByValue: true }, sessionId);
      if (state.result.value) { layout = JSON.parse(state.result.value); break; }
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.ok(layout, `Layout did not settle: ${scenario.name}`);
    assert.equal(layout.width, scenario.width, "Viewport must match the claimed evidence width");
    assert.equal(layout.overflow, false, `${scenario.name} must not overflow horizontally`);
    for (const button of layout.buttons) {
      assert.ok(button.left >= -1 && button.right <= scenario.width + 1, `${scenario.name}: clipped control ${button.label}`);
      assert.ok(button.height >= 43, `${scenario.name}: undersized touch target ${button.label}`);
    }
    if (scenario.name === "after-inbox-large-text") {
      const heading = layout.heading.find(item => item.text === "Messages");
      assert.ok(heading && heading.height < parseFloat(heading.fontSize) * 1.6, "Large Messages heading must fit without an orphan line");
    }
    await command("Runtime.evaluate", { expression: "Promise.all([...document.images].map(i=>i.decode().catch(()=>{})))", awaitPromise: true }, sessionId);
    const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, sessionId);
    writeFileSync(join(directory, `${scenario.name}.png`), Buffer.from(screenshot.data, "base64"));
    results.push({ name: scenario.name, ...layout });
    console.log(`${scenario.name}: ${layout.rows.length} rows, ${scenario.width}px, no horizontal overflow`);
  }
  writeFileSync(join(directory, "measurements.json"), JSON.stringify(results, null, 2));
} finally {
  await command("Browser.close").catch(() => {});
  if (chrome.exitCode == null) {
    chrome.kill();
    await new Promise(resolve => { chrome.once("exit", resolve); setTimeout(resolve, 1000); });
  }
  for (const request of pending.values()) clearTimeout(request.timer);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
