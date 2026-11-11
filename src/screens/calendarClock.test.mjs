import assert from "node:assert/strict";
import test from "node:test";
import { createCalendarClock } from "./calendarClock.mjs";
import { localCalendarIso } from "../domain/dates.mjs";

function fixture() {
  let time = new Date(2028, 0, 31, 23, 59, 59).getTime(), active = true, current = true, sequence = 0;
  const timers = new Map(), reads = [], dates = [];
  const clock = createCalendarClock({
    readTime: () => new Promise((resolve, reject) => reads.push({ resolve, reject })),
    onChange: date => dates.push(date), isCurrent: () => current, isActive: () => active, now: () => time,
    schedule: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
    cancel: id => timers.delete(id),
  });
  return { clock, timers, reads, dates, now: () => time,
    fire() { const [id, timer] = timers.entries().next().value; timers.delete(id); time += timer.delay; timer.callback(); },
    active(value) { active = value; }, current(value) { current = value; },
  };
}

test("server and device date disagreement accepts once and schedules the accepted midnight", async () => {
  const f = fixture(); const work = f.clock.refresh();
  const server = new Date(2028, 1, 2, 12, 30).getTime();
  f.reads[0].resolve({ now: new Date(server).toISOString() });
  assert.equal(await work, true);
  assert.equal(f.reads.length, 1); assert.equal(f.timers.size, 1);
  assert.equal(localCalendarIso(f.dates.at(-1)), "2028-02-02");
  assert.equal([...f.timers.values()][0].delay, 11.5 * 60 * 60 * 1000 + 25);
});

test("each midnight rearms the next day even when server reads fail", async () => {
  const f = fixture(); const work = f.clock.refresh();
  f.reads[0].resolve({ now: new Date(f.now()).toISOString() }); await work;
  f.fire(); assert.equal(localCalendarIso(f.dates.at(-1)), "2028-02-01");
  f.reads[1].reject(new Error("offline")); await Promise.resolve();
  assert.equal(f.timers.size, 1);
  f.fire(); assert.equal(localCalendarIso(f.dates.at(-1)), "2028-02-02");
  f.reads[2].resolve({ now: "invalid" }); await Promise.resolve();
  assert.equal(f.timers.size, 1); assert.equal(f.reads.length, 3);
});

test("a newer refresh wins over a late older server response", async () => {
  const f = fixture(), old = f.clock.refresh(), fresh = f.clock.refresh();
  f.reads[1].resolve({ now: new Date(2028, 2, 1, 12).toISOString() }); assert.equal(await fresh, true);
  f.reads[0].resolve({ now: new Date(2028, 1, 1, 12).toISOString() }); assert.equal(await old, false);
  assert.equal(localCalendarIso(f.dates.at(-1)), "2028-03-01"); assert.equal(f.timers.size, 1);
});

test("background pause revokes pending work and foreground starts one fresh schedule", async () => {
  const f = fixture(), old = f.clock.refresh();
  f.active(false); f.clock.pause(); assert.equal(f.timers.size, 0);
  assert.equal(await f.clock.refresh(), false); assert.equal(f.reads.length, 1);
  f.active(true); const fresh = f.clock.refresh();
  f.reads[1].resolve({ now: new Date(f.now()).toISOString() }); await fresh;
  const accepted = f.dates.at(-1);
  f.reads[0].resolve({ now: new Date(2030, 0, 1).toISOString() }); assert.equal(await old, false);
  assert.equal(f.dates.at(-1), accepted); assert.equal(f.timers.size, 1);
});

for (const reason of ["retire", "covered"]) test(`clock rejects late completion and new reads after ${reason}`, async () => {
  const f = fixture(), old = f.clock.refresh(), before = f.dates.length;
  if (reason === "retire") f.clock.retire(); else f.current(false);
  f.reads[0].resolve({ now: new Date(2030, 0, 1).toISOString() }); assert.equal(await old, false);
  if (reason === "covered") f.fire();
  assert.equal(await f.clock.refresh(), false);
  assert.equal(f.dates.length, before); assert.equal(f.reads.length, 1); assert.equal(f.timers.size, 0);
});

test("offline refresh advances the accepted server day without reverting to the device day", async () => {
  const f = fixture(), first = f.clock.refresh();
  f.reads[0].resolve({ now: new Date(2028, 1, 2, 23, 59, 59).toISOString() }); await first;
  f.fire(); f.reads[1].reject(new Error("offline")); await Promise.resolve();
  assert.equal(localCalendarIso(f.dates.at(-1)), "2028-02-03");
});
