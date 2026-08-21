import test from "node:test";
import assert from "node:assert/strict";
import { mediaPutStatusAccepted } from "./mediaUploadPolicy.mjs";

test("create-only media PUT treats only success and an existing immutable key as resumable", () => {
  assert.equal(mediaPutStatusAccepted(200), true);
  assert.equal(mediaPutStatusAccepted(204), true);
  assert.equal(mediaPutStatusAccepted(412), true);
  assert.equal(mediaPutStatusAccepted(400), false);
  assert.equal(mediaPutStatusAccepted(409), false);
  assert.equal(mediaPutStatusAccepted(500), false);
});
