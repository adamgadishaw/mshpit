import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("shared post surfaces retire descriptive tags but retain concert companion tags", () => {
  const payload = source("./post-payload.mjs");
  const ticket = source("../components/TicketStub.jsx");
  const memory = source("../components/ConcertMemoryModal.jsx");
  const composer = source("../screens/LogScreen.jsx");

  assert.equal(payload.split("tags: [],").length - 1 >= 2, true);
  assert.equal(ticket.includes("function TagRow"), false);
  assert.equal(ticket.includes("log.tags"), false);
  assert.equal(memory.includes("log.tags"), false);

  assert.match(ticket, /function TaggedPeopleRow/);
  assert.match(ticket, /went with/);
  assert.match(composer, /People with you/);
  assert.match(composer, /Tag the people who went to this show with you/);
});
