import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dockerfile = await readFile(new URL("../Dockerfile.video-verifier", import.meta.url), "utf8");
const blueprint = (await readFile(new URL("../render.yaml", import.meta.url), "utf8")).replace(/\r\n/g, "\n");

function serviceBlock(name, nextName) {
  const start = blueprint.indexOf(`  - type: pserv\n    name: ${name}\n`);
  assert.ok(start >= 0, `${name} private service must be declared`);
  const end = nextName ? blueprint.indexOf(`  - type: web\n    name: ${nextName}\n`, start) : blueprint.length;
  assert.ok(end > start, `${name} service block must be bounded`);
  return blueprint.slice(start, end);
}

test("video verifier container pins its runtime and drops root privileges", () => {
  assert.match(dockerfile, /^ARG NODE_IMAGE=node:24\.19\.0-bookworm-slim@sha256:[a-f0-9]{64}$/m);
  assert.match(dockerfile, /^ARG FFMPEG_VERSION=9\.0\.1$/m);
  assert.match(dockerfile, /^ARG FFMPEG_SHA256=[a-f0-9]{64}$/m);
  assert.match(dockerfile, /--disable-network/);
  assert.match(dockerfile, /--enable-libx264/);
  assert.match(dockerfile, /sha256sum --check --strict/);
  assert.match(dockerfile, /^\s*make install; \\$/m);
  assert.doesNotMatch(dockerfile, /install-strip/);
  assert.match(dockerfile, /verifier-smoke\.mp4/);
  assert.match(dockerfile, /PIT_FFMPEG_PATH=\/opt\/ffmpeg\/bin\/ffmpeg/);
  assert.match(dockerfile, /PIT_FFPROBE_PATH=\/opt\/ffmpeg\/bin\/ffprobe/);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^CMD \["node", "server\/videoVerifierService\.js"\]$/m);
});

test("production verifier is private, automatically wired, and credential-free", () => {
  const verifier = serviceBlock("pit-video-verifier", "mshpit-staging");
  assert.match(verifier, /runtime: docker/);
  assert.match(verifier, /region: oregon/);
  assert.match(verifier, /dockerfilePath: \.\/Dockerfile\.video-verifier/);
  assert.match(verifier, /PIT_VIDEO_VERIFIER_SECRET\n        generateValue: true/);
  assert.match(verifier, /PIT_VIDEO_SOURCE_ORIGIN[\s\S]*?name: mshpit[\s\S]*?envVarKey: MEDIA_ENDPOINT/);
  assert.match(verifier, /PIT_VIDEO_SOURCE_BUCKET[\s\S]*?name: mshpit[\s\S]*?envVarKey: MEDIA_SOURCE_BUCKET/);
  assert.match(verifier, /PIT_VIDEO_OUTPUT_BUCKET[\s\S]*?name: mshpit[\s\S]*?envVarKey: MEDIA_BUCKET/);
  assert.doesNotMatch(verifier, /^\s+- key: (?:MEDIA_ACCESS_KEY_ID|MEDIA_SECRET_ACCESS_KEY|PIT_DATA_DIR|ADMIN_PASSWORD|BACKUP_S3_)/m);

  const productionWeb = blueprint.slice(0, blueprint.indexOf("  - type: pserv\n    name: pit-video-verifier\n"));
  assert.match(productionWeb, /PIT_VIDEO_PUBLISHING_ENABLED\n        value: "true"/,
    "production must keep verified media publishing enabled after the gated rollout");
  assert.match(productionWeb, /PIT_VIDEO_VERIFIER_HOSTPORT[\s\S]*?name: pit-video-verifier[\s\S]*?property: hostport/);
  assert.match(productionWeb, /PIT_VIDEO_VERIFIER_SECRET[\s\S]*?name: pit-video-verifier[\s\S]*?envVarKey: PIT_VIDEO_VERIFIER_SECRET/);
});
