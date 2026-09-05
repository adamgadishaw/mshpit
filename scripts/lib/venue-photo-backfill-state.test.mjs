import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  readVenuePhotoBackfillState,
  resolveVenuePhotoBackfillStatePath,
  writeVenuePhotoBackfillState,
} from "./venue-photo-backfill-state.mjs";

test("venue-photo progress state is durable, atomic, and fails closed when corrupt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pit-venue-photo-state-"));
  try {
    const databasePath = join(directory, "pit.db");
    const statePath = resolveVenuePhotoBackfillStatePath(databasePath);
    assert.equal(statePath, join(directory, "venue-photo-backfill.state.json"));
    assert.deepEqual(await readVenuePhotoBackfillState(statePath), { version: 1, cursor: null });

    await writeVenuePhotoBackfillState(statePath, "provider:ticketmaster:safe-id");
    assert.deepEqual(await readVenuePhotoBackfillState(statePath), {
      version: 1,
      cursor: "provider:ticketmaster:safe-id",
    });
    assert.match(await readFile(statePath, "utf8"), /"version": 1/u);

    await writeFile(statePath, "{not-json", "utf8");
    await assert.rejects(
      readVenuePhotoBackfillState(statePath),
      /refusing to discard it automatically/u,
    );
    assert.equal(await readFile(statePath, "utf8"), "{not-json");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("venue-photo progress state rejects unsafe cursor values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pit-venue-photo-state-"));
  try {
    const statePath = join(directory, "state.json");
    await assert.rejects(writeVenuePhotoBackfillState(statePath, "bad\ncursor"), /cursor is invalid/u);
    await assert.rejects(writeVenuePhotoBackfillState(statePath, ""), /cursor is invalid/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
