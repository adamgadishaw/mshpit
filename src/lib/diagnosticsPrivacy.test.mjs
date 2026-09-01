import test from "node:test";
import assert from "node:assert/strict";

import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./persist" && context.parentURL?.endsWith("/src/lib/diagnostics.js")) {
      return nextResolve(new URL("./persist.js", context.parentURL).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  captureAppError,
  clearDiagnostics,
  configureDiagnosticsIdentity,
  diagnosticRouteTemplate,
  diagnosticsIdentity,
  getDiagnostics,
  purgeLegacyDiagnosticsStorage,
  supportReferenceFor,
} = await import("./diagnostics.js");
import { load, remove, save } from "./persist.js";
import {
  LEGACY_DIAGNOSTICS_STORAGE_KEY,
  diagnosticsStorageKey,
  purgeAccountLocalPrivacy,
} from "../domain/accountLocalPrivacy.mjs";

test("diagnostic routes remove query values and every opaque path identifier", () => {
  assert.equal(
    diagnosticRouteTemplate("/api/media/assets/550e8400-e29b-41d4-a716-446655440000/finalize?token=private"),
    "/api/media/assets/:id/finalize",
  );
  assert.equal(
    diagnosticRouteTemplate("/api/admin/content/post/p_private-123/restore"),
    "/api/admin/content/:id/:id/restore",
  );
  assert.equal(
    diagnosticRouteTemplate("/api/admin/email/templates/welcome"),
    "/api/admin/email/templates/:id",
  );
  assert.equal(
    diagnosticRouteTemplate("/api/admin/artists/enrich"),
    "/api/admin/artists/enrich",
  );
  assert.equal(
    diagnosticRouteTemplate("/api/admin/artists/private-artist-key"),
    "/api/admin/artists/:id",
  );
  assert.equal(diagnosticRouteTemplate("/api/discover/chart"), "/api/discover/chart");
});

test("ordinary error feedback projects one sanitized support reference", () => {
  assert.equal(supportReferenceFor({
    id: "pit-local",
    meta: { requestId: "request-123/private value" },
  }), "request-123privatevalue");
  assert.equal(supportReferenceFor({ id: "pit-local", meta: {} }), "pit-local");
  assert.equal(supportReferenceFor(null), null);
});

test("diagnostic histories rotate by account and logout removes the departing account", () => {
  const accountA = "diagnostic-account-a";
  const accountB = "diagnostic-account-b";

  configureDiagnosticsIdentity(accountB);
  clearDiagnostics();
  configureDiagnosticsIdentity(accountA);
  clearDiagnostics();
  captureAppError(new Error("raw private implementation detail"), {
    code: "PIT-UPLOAD-004",
    context: "Uploading a profile photo",
    force: true,
    meta: {
      method: "POST",
      path: "/api/media/assets/550e8400-e29b-41d4-a716-446655440000/finalize?token=private",
      requestId: "request-account-a",
    },
  });

  assert.equal(diagnosticsIdentity(), accountA);
  assert.equal(getDiagnostics().length, 1);
  assert.equal(getDiagnostics()[0].meta.route, "/api/media/assets/:id/finalize");
  assert.equal(load(diagnosticsStorageKey(accountA), []).length, 1);

  configureDiagnosticsIdentity(accountB);
  assert.deepEqual(getDiagnostics(), [], "account B never receives account A's history");

  purgeAccountLocalPrivacy({
    accountId: accountA,
    load,
    save,
    remove,
  });

  configureDiagnosticsIdentity(accountA);
  assert.deepEqual(getDiagnostics(), [], "returning to account A cannot revive its logged-out history");
  configureDiagnosticsIdentity(null);
  configureDiagnosticsIdentity(accountB);
  assert.deepEqual(getDiagnostics(), []);
});

test("legacy device-global diagnostic history is retired instead of adopted", () => {
  save(LEGACY_DIAGNOSTICS_STORAGE_KEY, [{ code: "PIT-UPLOAD-004", meta: { requestId: "old-account" } }]);
  purgeLegacyDiagnosticsStorage();
  assert.equal(load(LEGACY_DIAGNOSTICS_STORAGE_KEY, null), null);
});
