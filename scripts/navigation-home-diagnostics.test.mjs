import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHomeDiagnostics } from "./navigation-home-diagnostics.mjs";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "pit-home-diagnostics-"));
  const folder = join(directory, "home-link-member-390");
  const context = { tracing: {
    async start() {}, async stop({ path }) { writeFileSync(path, "trace fixture"); },
  } };
  const page = (url) => {
    let closed = false, onClose;
    return {
      url: () => url, isClosed: () => closed, title: async () => "Synthetic page",
      on: (_event, handler) => { onClose = handler; },
      async screenshot({ path, timeout }) {
        assert.equal(timeout, 12_000);
        writeFileSync(path, "screenshot fixture"); return Buffer.from("screenshot fixture");
      },
      close() { closed = true; onClose?.(); },
    };
  };
  return { directory, folder, context, page,
    read: () => JSON.parse(readFileSync(join(folder, "diagnostics.json"), "utf8")),
    cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test("diagnostics are inert for every case except the synthetic mobile member Home case", async () => {
  const diagnostic = createHomeDiagnostics({ name: "home-link-member-1280" });
  await diagnostic.start(); diagnostic.phase("ignored"); await diagnostic.rememberPopup();
  assert.equal(await diagnostic.finish("original failure"), null);
});

for (const failedPhase of ["popup landing", "original landing"]) {
  test(`${failedPhase} failure retains both page identities, screenshots and trace before context teardown`, async () => {
    const f = fixture();
    try {
      const original = f.page("http://127.0.0.1/post/fixture"), popup = f.page("http://127.0.0.1/");
      const diagnostic = createHomeDiagnostics({ ...f, name: "home-link-member-390", timeoutMs: 12_000 });
      mkdirSync(f.folder); writeFileSync(join(f.folder, "trace.zip"), "old run");
      await diagnostic.start();
      assert.equal(existsSync(join(f.folder, "trace.zip")), false, "an old trace cannot masquerade as this run");
      diagnostic.phase("initial post", original);
      diagnostic.phase("popup landing", popup, "popup");
      assert.equal(f.read().phase, "popup landing", "phase survives even before a failure handler runs");
      if (failedPhase === "original landing") {
        await diagnostic.rememberPopup(popup); popup.close();
        diagnostic.phase("original landing", original);
      }
      await diagnostic.finish("Timeout waiting for Browse concerts");
      const report = f.read();
      assert.equal(report.phase, failedPhase); assert.equal(report.status, "failed");
      assert.equal(report.failure, "Timeout waiting for Browse concerts");
      assert.equal(report.pages.original.url, "http://127.0.0.1/post/fixture");
      assert.equal(report.pages.popup.url, "http://127.0.0.1/");
      assert.equal(report.pages.popup.closed, failedPhase === "original landing");
      assert.equal(report.pages.popup.closedAtFinish, failedPhase === "original landing");
      for (const file of ["original.png", "popup.png", "trace.zip"]) assert.ok(existsSync(join(f.folder, file)), file);
    } finally { f.cleanup(); }
  });
}

test("a screenshot or trace failure is reported without replacing the original test failure", async () => {
  const f = fixture();
  try {
    f.context.tracing.stop = async () => { throw new Error("trace unavailable"); };
    const page = f.page("about:blank"); page.screenshot = async () => { throw new Error("screenshot unavailable"); };
    const diagnostic = createHomeDiagnostics({ ...f, name: "home-link-member-390", timeoutMs: 12_000 });
    await diagnostic.start(); diagnostic.phase("popup landing", page, "popup");
    const result = await diagnostic.finish("original assertion");
    assert.equal(result.status, "failed"); assert.equal(f.read().failure, "original assertion");
    assert.deepEqual(result.errors, ["screenshot unavailable", "trace unavailable"]);
  } finally { f.cleanup(); }
});
