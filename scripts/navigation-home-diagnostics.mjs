import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Only the isolated synthetic Home fixture opts in. Diagnostics must never
// replace its original assertion failure or change the navigation sequence.
export function createHomeDiagnostics({ context, name, directory, timeoutMs }) {
  if (name !== "home-link-member-390") return {
    phase() {}, async start() {}, async rememberPopup() {}, async finish() { return null; },
  };
  const folder = join(directory, name);
  const report = { name, phase: "setup", phases: [], pages: {}, errors: [] };
  const pages = new Map();
  let tracing = false;
  const attempt = async (action) => {
    try { return await action(); }
    catch (error) { report.errors.push(String(error?.message || error)); return null; }
  };
  const persist = () => {
    try {
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "diagnostics.json"), JSON.stringify(report, null, 2));
    } catch (error) { report.errors.push(String(error?.message || error)); }
  };
  const update = (page, role) => {
    report.pages[role] = { ...report.pages[role], url: page.url(), closed: page.isClosed() };
  };
  const capture = async (page, role) => {
    update(page, role);
    if (page.isClosed()) return;
    const screenshot = join(folder, `${role}.png`);
    const saved = await attempt(() => page.screenshot({ path: screenshot, fullPage: true, timeout: timeoutMs }));
    report.pages[role].screenshot = saved ? `${role}.png` : null;
    report.pages[role].title = await attempt(() => page.title());
  };
  return {
    async start() {
      // Repeated local runs must not mislabel an older trace as current evidence.
      await attempt(() => {
        for (const file of ["diagnostics.json", "original.png", "popup.png", "trace.zip"]) rmSync(join(folder, file), { force: true });
      });
      persist();
      tracing = (await attempt(async () => {
        await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
        return true;
      })) === true;
      persist();
    },
    phase(label, page, role = "original") {
      report.phase = label;
      report.phases.push({ phase: label, at: new Date().toISOString() });
      if (page) {
        if (!pages.has(page)) {
          pages.set(page, role);
          page.on("close", () => { update(page, role); persist(); });
        }
        update(page, role);
      }
      persist();
    },
    // Preserve the popup even if a later same-page assertion fails after close.
    async rememberPopup(page) {
      await attempt(() => capture(page, "popup"));
      persist();
    },
    async finish(failure) {
      report.status = failure ? "failed" : "passed";
      report.failure = failure || null;
      for (const [page, role] of pages) report.pages[role].closedAtFinish = page.isClosed();
      persist();
      for (const [page, role] of pages) await attempt(() => capture(page, role));
      if (tracing) await attempt(() => context.tracing.stop({ path: join(folder, "trace.zip") }));
      persist();
      return { directory: folder, phase: report.phase, status: report.status, errors: report.errors };
    },
  };
}
