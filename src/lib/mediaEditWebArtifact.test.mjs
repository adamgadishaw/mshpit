import test from "node:test";
import assert from "node:assert/strict";
import { createWebMediaArtifact } from "./mediaEditWebArtifact.mjs";

test("browser image renditions retain a File-like upload body beside their object URL", () => {
  class FakeFile {
    constructor(parts, name, options) {
      this.parts = parts;
      this.name = name;
      this.type = options.type;
      this.size = parts.reduce((sum, part) => sum + part.size, 0);
    }
  }
  const blob = { size: 321, type: "image/jpeg" };
  const result = createWebMediaArtifact(
    blob,
    { fileName: "crowd-pit-edit.jpg", mimeType: "image/jpeg", lastModified: 123 },
    { FileConstructor: FakeFile, createObjectURL: (file) => `blob:test/${file.name}` },
  );
  assert.equal(result.uri, "blob:test/crowd-pit-edit.jpg");
  assert.equal(result.file.name, "crowd-pit-edit.jpg");
  assert.equal(result.file.size, 321);
  assert.equal(result.file.type, "image/jpeg");
});

test("browser rendition artifacts fail closed when the encoder returned no bytes", () => {
  assert.throws(() => createWebMediaArtifact({ size: 0 }), /empty browser rendition/i);
});
