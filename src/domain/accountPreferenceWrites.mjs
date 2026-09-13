// Order changes to one preference without serializing unrelated controls. A
// bounded, Store-owned queue is deliberately not persisted or retried: an old
// login must never dispatch work after the user has changed accounts.
export function createAccountPreferenceWrites({ maxPending = 16 } = {}) {
  const queues = new Map();
  let pending = 0;
  const run = (key, isCurrent, write) => {
    if (pending >= maxPending) return Promise.reject(new Error("Please wait for your current settings to finish saving."));
    pending += 1;
    const previous = queues.get(key);
    const execute = () => {
      if (!isCurrent()) throw new Error("Your account changed before this setting could be saved.");
      return write();
    };
    let operation;
    try { operation = previous ? previous.then(execute, execute) : Promise.resolve(execute()); }
    catch (error) { operation = Promise.reject(error); }
    // This settled tail only schedules the next explicit user intent. The
    // caller still receives the original rejection and can show its error.
    const tail = operation.then(() => undefined, () => undefined).finally(() => {
      pending -= 1;
      if (queues.get(key) === tail) queues.delete(key);
    });
    queues.set(key, tail);
    return operation;
  };
  return { run, get pending() { return pending; } };
}
