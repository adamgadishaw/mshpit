import { IMPORT_LIMITS, importError, importText, readImportZip, safeImportPath } from "./newsroomImportArchive.mjs";
export { IMPORT_LIMITS } from "./newsroomImportArchive.mjs";
const categories = new Set(["release", "tour", "festival", "lineup", "awards", "charts", "legal", "death"]);
const types = Object.freeze({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  mov: "video/quicktime", mp4: "video/mp4", zip: "application/zip", pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain" });
const extension = (name) => String(name || "").split(".").at(-1).toLowerCase();
const ascii = (bytes, from, to) => String.fromCharCode(...bytes.subarray(from, to));
const fail = (message) => { throw importError(message); };
function fields(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some((key) => !allowed.includes(key))) fail(`The ${label} has unsupported fields. Use article package version 1.`);
}
function text(value, limit, label, required = true) {
  if (typeof value !== "string" || value.length > limit || (required && !value.trim())
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) fail(`Check the ${label} in the article package.`);
  return value.replace(/\r\n?/gu, "\n").trim();
}
function source(value, kind) {
  fields(value, kind === "article" ? ["kind", "name", "url"] : ["file", "name", "url", "credit"], `${kind} source`);
  if (kind === "article" && value.kind !== "article") fail("Photo and video credits belong in media fields, not article sources.");
  const name = text(value.name, 160, `${kind} source name`), url = text(value.url, 2048, `${kind} source URL`);
  let parsed;
  try { parsed = new URL(url); } catch { fail("Every source needs a valid HTTPS URL."); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) fail("Every source needs a valid HTTPS URL.");
  return { name, url, ...(kind !== "article" ? { credit: text(value.credit || "", 240, `${kind} credit`, false) } : {}) };
}
export function importFileKind(file) {
  const ext = extension(file?.name), expected = types[ext], declared = String(file?.type || "").toLowerCase();
  if (!expected || (declared && declared !== expected && !(ext === "zip" && declared === "application/x-zip-compressed"))) {
    fail("Choose a ZIP article package, DOCX, text PDF, TXT, JPG, PNG, WebP, MOV or MP4 file.");
  }
  const kind = expected.startsWith("image/") ? "image" : expected.startsWith("video/") ? "video" : ext;
  const limit = kind === "image" ? IMPORT_LIMITS.image : kind === "video" ? IMPORT_LIMITS.video
    : kind === "zip" ? IMPORT_LIMITS.archive : IMPORT_LIMITS.document;
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > limit) fail(`That ${kind === "video" ? "video" : "file"} is empty or over the ${limit / 1024 / 1024} MB limit.`);
  return { kind, type: expected };
}
export function verifyImportSignature(bytes, kind, type) {
  let valid = false;
  if (kind === "image") {
    valid = type === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : type === "image/png" ? [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v)
        : ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
  } else if (kind === "video") {
    const brand = ascii(bytes, 8, 12);
    valid = ascii(bytes, 4, 8) === "ftyp" && (type === "video/quicktime" ? brand === "qt  "
      : /^(isom|iso[2-9]|mp4[12]|avc1|M4V |MSNV|dash)$/u.test(brand));
  } else if (kind === "zip" || kind === "docx") valid = [80,75,3,4].every((v, i) => bytes[i] === v);
  else if (kind === "pdf") valid = ascii(bytes, 0, 5) === "%PDF-";
  else if (kind === "txt") valid = true;
  if (!valid) fail("The file contents do not match its type. Export a fresh copy and try again.");
}
function packageArticles(entries) {
  if (!entries.has("manifest.json")) fail("This ZIP needs a version 1 manifest.json. Choose a DOCX, PDF or TXT instead, or export an article package.");
  let manifest;
  try { manifest = JSON.parse(importText(entries.get("manifest.json"), 800000)); } catch { fail("The article package manifest is not valid JSON."); }
  fields(manifest, ["format", "version", "articles"], "manifest");
  if (manifest.format !== "mshpit-newsroom" || manifest.version !== 1 || !Array.isArray(manifest.articles)
      || !manifest.articles.length || manifest.articles.length > IMPORT_LIMITS.articles) fail("Use a version 1 Mshpit article package with 1–10 articles.");
  const used = new Set(["manifest.json"]), ids = new Set();
  const articles = manifest.articles.map((article) => {
    fields(article, ["id", "headline", "summary", "body", "category", "sources", "photo", "video"], "article");
    const id = text(article.id, 80, "article ID");
    if (ids.has(id)) fail("Each article in the package needs a different ID.");
    ids.add(id);
    if (!categories.has(article.category)) fail("Choose a supported article category in the package.");
    if (!Array.isArray(article.sources) || article.sources.length < 1 || article.sources.length > 10) fail("Add 1–10 article sources in the package.");
    const form = { headline: text(article.headline, 180, "headline"), summary: text(article.summary, 700, "summary"),
      body: text(article.body, IMPORT_LIMITS.text, "article body"), category: article.category,
      sources: article.sources.map((item) => source(item, "article")) };
    const media = {};
    for (const slot of ["photo", "video"]) {
      if (slot === "video" && article.video === undefined) continue;
      const attribution = source(article[slot], slot);
      const name = article[slot].file;
      if (!safeImportPath(name) || !entries.has(name)) fail(`The package is missing its ${slot} file.`);
      const bytes = entries.get(name), type = types[extension(name)];
      const file = { name, type, size: bytes.length };
      const { kind } = importFileKind(file);
      if (kind !== (slot === "photo" ? "image" : "video")) fail(`Choose a supported ${slot} file in the package.`);
      verifyImportSignature(bytes, kind, type);
      used.add(name);
      media[slot] = { name: name.split("/").at(-1), type, bytes };
      form[`${slot}Name`] = attribution.name; form[`${slot}Url`] = attribution.url; form[`${slot}Credit`] = attribution.credit;
    }
    return { id, form, media, warnings: ["Review the facts, source links and media rights before saving."] };
  });
  if ([...entries.keys()].some((name) => !used.has(name))) fail("The package contains unlisted files. Include only the manifest and its selected media.");
  return articles;
}
export function inspectDocx(entries) {
  if (!entries.has("[Content_Types].xml") || !entries.has("word/document.xml")) fail("That file is not a readable DOCX document.");
  for (const [name, bytes] of entries) {
    if (!/\.(xml|rels|png|jpe?g|webp)$/iu.test(name) || /(?:vbaProject|embeddings|activeX|altChunk)/iu.test(name)) {
      fail("This DOCX contains embedded or active content. Export a plain DOCX or text PDF.");
    }
    if (/\.(xml|rels)$/u.test(name)) {
      const value = importText(bytes, 4 * 1024 * 1024);
      if (/<!\s*(DOCTYPE|ENTITY)|TargetMode\s*=|macroEnabled|<\w*:?(?:altChunk|object)\b/iu.test(value)) {
        fail("This DOCX contains external links or active content. Export it without external relationships, or use plain text.");
      }
    } else {
      const type = types[extension(name)];
      verifyImportSignature(bytes, "image", type);
    }
  }
}
function documentArticle(value) {
  const body = text(value, IMPORT_LIMITS.text, "extracted text", false);
  if (!body.trim()) fail("No usable article text was found. Scanned PDFs need a text export; OCR is not included.");
  const lines = body.split(/\n/u).map((line) => line.trim()).filter(Boolean);
  return { id: "document", form: { headline: lines[0].length <= 180 ? lines[0] : "", summary: "", body,
    category: "tour", sources: [{ name: "", url: "" }] }, media: {},
  warnings: ["Review the extracted text and category. Add a summary, article sources and media credits before saving."] };
}
// Services contain maintained parsers. No network, saving, or publishing service
// is accepted here; document links and instructions are treated only as text.
export async function parseNewsroomFiles(files, services) {
  if (!Array.isArray(files) || !files.length || files.length > 3) fail("Choose one document or package, plus one photo and one optional video.");
  const selected = files.map((file) => ({ file, ...importFileKind(file) }));
  const documents = selected.filter((item) => !["image", "video"].includes(item.kind));
  if (documents.length > 1 || (documents[0]?.kind === "zip" && files.length !== 1)) fail("Choose one article package on its own, or one document with its media.");
  const media = {};
  for (const { file, kind, type } of selected.filter((item) => ["image", "video"].includes(item.kind))) {
    const slot = kind === "image" ? "photo" : "video";
    if (media[slot]) fail("Choose one cover photo and at most one article video.");
    verifyImportSignature(new Uint8Array(await file.slice(0, 96).arrayBuffer()), kind, type);
    media[slot] = { file, name: file.name, type };
  }
  if (!documents.length) return { articles: [], media };
  const { file, kind, type } = documents[0];
  const bytes = new Uint8Array(await file.arrayBuffer());
  verifyImportSignature(bytes, kind, type);
  if (kind === "zip") return { articles: packageArticles(readImportZip(bytes, await services.zip())), media: {} };
  let value;
  if (kind === "docx") {
    const entries = readImportZip(bytes, await services.zip());
    inspectDocx(entries);
    value = await services.docx(bytes);
  } else if (kind === "pdf") {
    if (/\/Encrypt\b/u.test(new TextDecoder("latin1").decode(bytes))) fail("Encrypted PDFs cannot be imported. Export an unencrypted text document.");
    value = await services.pdf(bytes);
  } else value = importText(bytes);
  const article = documentArticle(value);
  article.media = media;
  return { articles: [article], media: {} };
}
