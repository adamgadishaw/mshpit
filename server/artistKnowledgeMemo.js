// Tiny, process-local checkpoints of already validated public facts. Never raw
// provider payloads, image bytes, member data, or an unbounded catalogue mirror.
// Cloning at the boundary prevents a consumer from poisoning another lookup.
export function createArtistKnowledgeMemo({ maxEntries = 128, ttlMs = 60 * 60_000 } = {}) {
  const entries = new Map();
  return {
    get(key, at) {
      const record = entries.get(key);
      if (!record) return null;
      if (at < record.at || at - record.at >= ttlMs) { entries.delete(key); return null; }
      entries.delete(key); entries.set(key, record);
      return JSON.parse(record.text);
    },
    set(key, value, at) {
      const text = JSON.stringify(value);
      if (!Number.isSafeInteger(at) || at < 0 || Buffer.byteLength(text, "utf8") > 8192) return;
      entries.delete(key);
      entries.set(key, { at, text });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    },
  };
}
