// Parse metadata before inflating anything. Archives remain in memory: no paths
// are written to disk and no entry is interpreted as executable content.
export const IMPORT_LIMITS = Object.freeze({ document: 10 * 1024 * 1024, archive: 25 * 1024 * 1024,
  expanded: 40 * 1024 * 1024, entries: 256, ratio: 100, text: 60000, timeout: 20000,
  image: 20 * 1024 * 1024, video: 512 * 1024 * 1024, articles: 10 });
export function importError(message) {
  const error = new Error(message);
  error.code = "PIT-REQ-001";
  return error;
}
const reject = () => { throw importError("This ZIP is damaged or unsafe. Use a fresh article package or a plain document."); };
const decoder = new TextDecoder("utf-8", { fatal: true });
export function importText(bytes, max = IMPORT_LIMITS.text) {
  if (bytes.length > max * 4) throw importError("The article text is too long. Import a shorter document.");
  let value;
  try { value = decoder.decode(bytes); } catch { throw importError("Save the text as UTF-8 and try again."); }
  if (value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
    throw importError("The document contains unsupported text or exceeds the text limit.");
  }
  return value.replace(/\r\n?/gu, "\n");
}
export function safeImportPath(name) {
  return typeof name === "string" && name.length > 0 && name.length <= 200
    && /^[A-Za-z0-9_[\] .()/-]+$/u.test(name) && !name.startsWith("/")
    && name.split("/").every((part, index, all) => (part || index === all.length - 1)
      && part !== "." && part !== ".." && !/[. ]$/u.test(part));
}
export function inspectImportZip(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 22 || bytes.length > IMPORT_LIMITS.archive) reject();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at) => view.getUint16(at, true);
  const u32 = (at) => view.getUint32(at, true);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at -= 1) {
    if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === bytes.length) { end = at; break; }
  }
  if (end < 0 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) reject();
  const count = u16(end + 10), start = u32(end + 16), size = u32(end + 12);
  if (!count || count > IMPORT_LIMITS.entries || start + size !== end) reject();
  let at = start, expanded = 0;
  const names = new Set(), entries = [], spans = [];
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > end || u32(at) !== 0x02014b50) reject();
    const flags = u16(at + 8), method = u16(at + 10), crc = u32(at + 16);
    const compressed = u32(at + 20), length = u32(at + 24), nameLength = u16(at + 28);
    const extraLength = u16(at + 30), commentLength = u16(at + 32), local = u32(at + 42);
    const next = at + 46 + nameLength + extraLength + commentLength;
    if (next > end || u16(at + 34) || (flags & ~0x080e) || ![0, 8].includes(method)
        || [compressed, length, local].includes(0xffffffff)) reject();
    let name;
    try { name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)); } catch { reject(); }
    const mode = u32(at + 38) >>> 16;
    if (!safeImportPath(name) || names.has(name.toLowerCase()) || ((mode & 0xf000) && ![0x4000, 0x8000].includes(mode & 0xf000))) reject();
    // Also reject ZIP64, Unicode path overrides and encrypted metadata extras.
    for (let extra = at + 46 + nameLength; extra < at + 46 + nameLength + extraLength;) {
      if (extra + 4 > at + 46 + nameLength + extraLength) reject();
      const id = u16(extra), n = u16(extra + 2);
      if ([1, 0x7075, 0x9901, 0x0017].includes(id)) reject();
      extra += 4 + n;
      if (extra > at + 46 + nameLength + extraLength) reject();
    }
    expanded += length;
    if (expanded > IMPORT_LIMITS.expanded || length > Math.max(1024, compressed * IMPORT_LIMITS.ratio)
        || (name.endsWith("/") && length) || (method === 0 && compressed !== length)) reject();
    if (local + 30 > start || u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method) reject();
    const localNameLength = u16(local + 26), localExtra = u16(local + 28);
    const dataAt = local + 30 + localNameLength + localExtra;
    if (dataAt + compressed > start || localNameLength !== nameLength) reject();
    for (let n = 0; n < nameLength; n += 1) if (bytes[local + 30 + n] !== bytes[at + 46 + n]) reject();
    if (!(flags & 8) && (u32(local + 14) !== crc || u32(local + 18) !== compressed || u32(local + 22) !== length)) reject();
    spans.push([local, dataAt + compressed]);
    names.add(name.toLowerCase());
    entries.push({ name, length, compressed, method, crc, dataAt });
    at = next;
  }
  if (at !== end) reject();
  spans.sort((a, b) => a[0] - b[0]);
  if (spans[0][0] !== 0 || spans.some((span, index) => index && span[0] < spans[index - 1][1])) reject();
  return entries;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
const crc32 = (bytes) => {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};
export function readImportZip(bytes, { Inflate }) {
  const entries = inspectImportZip(bytes), result = new Map();
  for (const entry of entries) {
    if (entry.name.endsWith("/")) continue;
    const compressed = bytes.subarray(entry.dataAt, entry.dataAt + entry.compressed);
    let output;
    if (entry.method === 0) output = compressed.slice();
    else {
      // Streaming verifies actual expansion, not only attacker-supplied sizes.
      output = new Uint8Array(entry.length);
      let written = 0;
      const stream = new Inflate((chunk) => {
        if (written + chunk.length > entry.length) reject();
        output.set(chunk, written); written += chunk.length;
      });
      try {
        for (let offset = 0; offset < compressed.length; offset += 1024) {
          stream.push(compressed.subarray(offset, offset + 1024), offset + 1024 >= compressed.length);
        }
      } catch { reject(); }
      if (written !== entry.length) reject();
    }
    if (crc32(output) !== entry.crc) reject();
    result.set(entry.name, output);
  }
  return result;
}
