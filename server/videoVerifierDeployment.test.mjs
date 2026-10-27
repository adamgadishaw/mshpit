import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseDocument } from "yaml";

const dockerfile = await readFile(new URL("../Dockerfile.video-verifier", import.meta.url), "utf8");
const blueprint = (await readFile(new URL("../render.yaml", import.meta.url), "utf8")).replace(/\r\n/g, "\n");

test("proposed image CI is scoped, uses the exact Dockerfile, and bounds offline execution without publication", async () => {
  const text = await readFile(new URL("../.github/workflows/video-converter.yml", import.meta.url), "utf8");
  const yaml = parseDocument(text); assert.deepEqual(yaml.errors, []);
  const workflow = yaml.toJS();
  assert.equal(workflow.permissions.contents, "read");
  assert.ok(workflow.on.pull_request.paths.includes("Dockerfile.video-verifier"));
  assert.equal(workflow.on.push, undefined);
  const commands = workflow.jobs["exact-image"].steps.map((step) => step.run || "").join("\n");
  assert.match(commands, /--file Dockerfile\.video-verifier/);
  assert.match(commands, /--driver-opt memory=2g,memory-swap=2g,cpu-period=100000,cpu-quota=100000,cpuset-cpus=0/);
  const onlineSteps = workflow.jobs["exact-image"].steps.filter((step) => step.run?.includes("--network=bridge"));
  assert.equal(onlineSteps.length, 1, "only the dedicated public certificate check needs networking");
  assert.equal(onlineSteps[0].name, "Check public certificate rejection with a valid-chain control");
  assert.equal(onlineSteps[0]["timeout-minutes"], 3);
  assert.match(onlineSteps[0].run, /node scripts\/verify-video-verifier-security\.mjs --network/);
  assert.match(commands, /node scripts\/verify-video-verifier-security\.mjs --inventory/);
  for (const step of workflow.jobs["exact-image"].steps) {
    for (const command of (step.run || "").split("docker run ").slice(1)) {
      const run = command.split("\n").slice(0, 7).join("\n");
      assert.match(run, /--cpus=1 --memory=2g --memory-swap=2g --pids-limit=128/);
      assert.match(run, step === onlineSteps[0] ? /--network=bridge --read-only/ : /--network=none --read-only/);
      assert.match(run, /--cap-drop=ALL --security-opt=no-new-privileges/);
      assert.match(run, /--tmpfs \/tmp:rw,nosuid,nodev,size=768m/);
    }
  }
  assert.match(commands, /docker stats --no-stream/);
  assert.match(commands, /node --test server\/videoVerifierService\.test\.mjs/);
  assert.doesNotMatch(commands, /--push|docker login|render deploy|secrets\.|--privileged|--env-file/);
});

function serviceBlock(name, nextName) {
  const start = blueprint.indexOf(`  - type: pserv\n    name: ${name}\n`);
  assert.ok(start >= 0, `${name} private service must be declared`);
  const end = nextName ? blueprint.indexOf(`  - type: web\n    name: ${nextName}\n`, start) : blueprint.length;
  assert.ok(end > start, `${name} service block must be bounded`);
  return blueprint.slice(start, end);
}

test("video verifier container pins its runtime and drops root privileges", () => {
  assert.match(dockerfile, /^ARG NODE_IMAGE=node:24\.22\.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205$/m);
  assert.deepEqual(dockerfile.match(/^FROM .+$/gm), [
    "FROM ${NODE_IMAGE} AS ffmpeg-build", "FROM ${NODE_IMAGE}",
  ], "build and runtime must use the same patched official image");
  assert.match(dockerfile, /^ARG FFMPEG_VERSION=9\.0\.1$/m);
  assert.match(dockerfile, /^ARG FFMPEG_SHA256=[a-f0-9]{64}$/m);
  assert.match(dockerfile, /--disable-network/);
  assert.match(dockerfile, /--enable-libx264/);
  assert.match(dockerfile, /--enable-libzimg/);
  assert.match(dockerfile, /libzimg-dev="\$\{ZIMG_VERSION\}"/);
  assert.match(dockerfile, /libzimg2="\$\{ZIMG_VERSION\}"/);
  assert.match(dockerfile, /sha256sum --check --strict/);
  assert.match(dockerfile, /^\s*make install; \\$/m);
  assert.doesNotMatch(dockerfile, /install-strip/);
  assert.match(dockerfile, /verifier-smoke\.mp4/);
  assert.match(dockerfile, /PIT_FFMPEG_PATH=\/opt\/ffmpeg\/bin\/ffmpeg/);
  assert.match(dockerfile, /PIT_FFPROBE_PATH=\/opt\/ffmpeg\/bin\/ffprobe/);
  assert.match(dockerfile,
    /COPY --chown=node:node src\/domain\/mediaMime\.mjs src\/domain\/mediaUploadPolicy\.mjs \.\/src\/domain\//,
    "the runtime image must include every non-server module imported by the verifier");
  assert.match(dockerfile, /^RUN node server\/videoVerifierService\.js --self-test$/m,
    "the build converts real AVI, Matroska and interlaced MPEG clips before the image can ship");
  assert.ok(dockerfile.indexOf("--self-test") > dockerfile.indexOf("USER node"), "the self-test runs without root");
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^CMD \["node", "server\/videoVerifierService\.js"\]$/m);
});

test("production verifier is private, automatically wired, and credential-free", () => {
  const verifier = serviceBlock("pit-video-verifier");
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
