import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { zipSync, strToU8 } from "fflate";
import "./prepare-newsroom-import.mjs";
import { textPdf as pdf } from "./newsroomImportFixtures.mjs";
const workerUrl = new URL("../public/newsroom-import/worker.mjs", import.meta.url).href;
const workerBody = `const {parentPort, workerData}=require('node:worker_threads');
globalThis.self=globalThis; self.postMessage=(data)=>parentPort.postMessage(data);
delete globalThis.module; delete globalThis.exports;
globalThis.fetch=()=>{throw new Error('Document network access forbidden')};
import(workerData.url).then(()=>self.onmessage({data:{files:[new File([workerData.bytes],workerData.name)]}}));`;
const extract = (bytes, name) => new Promise((resolve, reject) => {
  const worker = new Worker(workerBody, { eval: true, workerData: { url: workerUrl, bytes, name } });
  const timer = setTimeout(() => { void worker.terminate(); reject(new Error("Parser test timed out")); }, 20000);
  worker.once("message", (result) => { clearTimeout(timer); void worker.terminate(); resolve(result); });
  worker.once("error", (error) => { clearTimeout(timer); void worker.terminate(); reject(error); });
});
test("shipped worker extracts ordinary DOCX paragraphs with maintained parser and no document network", async () => {
  const bytes = zipSync({
    "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    "_rels/.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    "word/document.xml": strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Fixture band announces a tour</w:t></w:r></w:p><w:p><w:r><w:t>Synthetic reporting stays unpublished.</w:t></w:r></w:p></w:body></w:document>'),
  });
  const result = await extract(bytes, "article.docx");
  assert.equal(result.type, "preview", result.message);
  assert.match(result.result.articles[0].form.body, /Fixture band announces a tour\n\nSynthetic reporting/u);
});
test("shipped worker extracts text PDF and rejects a PDF without usable text", async () => {
  const result = await extract(pdf("Synthetic tour reporting remains unpublished."), "article.pdf");
  assert.equal(result.type, "preview", result.message);
  assert.match(result.result.articles[0].form.body, /Synthetic tour reporting/u);
  const scan = await extract(pdf(""), "scan.pdf");
  assert.equal(scan.type, "error"); assert.match(scan.message, /text|Scans/u);
});
