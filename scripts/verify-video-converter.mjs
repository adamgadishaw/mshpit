// Offline acceptance harness. Uses generated media only; no storage or API.
// Run with ffmpeg/ffprobe on PATH. Evidence and media stay in a fresh temp dir.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { createSanitizedDelivery, probeUniversalVideo, runVideoVerifierSelfTest, runVerifierProcess } from "../server/videoVerifierService.js";

const directory = await mkdtemp(join(tmpdir(), "pit-video-acceptance-"));
const config = { ffmpeg: process.env.PIT_FFMPEG_PATH || "ffmpeg", ffprobe: process.env.PIT_FFPROBE_PATH || "ffprobe" };
const commands = [];
async function runProcess(executable, args, { cwd = directory, signal } = {}) {
  const started = performance.now();
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, signal, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    // Windows resource observations are scoped to this owned decoder PID.
    // They are desktop measurements, not a 1 CPU container benchmark.
    let resources = Promise.resolve(null);
    if (process.platform === "win32" && process.env.PIT_MEASURE_VIDEO_RESOURCES === "1" && executable === config.ffmpeg) {
      resources = new Promise((done) => {
        const monitor = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
          `$peak=0; $cpu=0; while($p=Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue){ $peak=[Math]::Max($peak,$p.PeakWorkingSet64); $cpu=$p.TotalProcessorTime.TotalSeconds; Start-Sleep -Milliseconds 50 }; @{peakWorkingSetBytes=$peak;cpuSeconds=$cpu}|ConvertTo-Json -Compress`],
        { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
        let text = ""; monitor.stdout.on("data", (part) => { text += part; });
        monitor.on("error", () => done(null));
        monitor.on("close", () => { try { const value = JSON.parse(text); done(value.peakWorkingSetBytes > 0 ? value : null); } catch { done(null); } });
      });
    }
    const stdout = [], stderr = [];
    child.stdout.on("data", (part) => stdout.push(part));
    child.stderr.on("data", (part) => stderr.push(part));
    child.on("error", reject);
    child.on("close", async (code) => {
      const result = { stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
      const elapsedMs = Math.round(performance.now() - started);
      commands.push({ executable, elapsedMs, exitCode: code, resources: await resources,
        operation: args.at(-1)?.endsWith(".delivery.mp4") ? "conversion" : "probe_or_fixture" });
      if (code) reject(Object.assign(new Error(result.stderr), { code: "decode_failed", status: 422 }));
      else resolve(result);
    });
  });
}
async function metadata(path) {
  return JSON.parse((await runProcess(config.ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", path])).stdout);
}
function faststart(bytes) {
  const atoms = [];
  for (let offset = 0; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    assert.ok(size >= 8 && offset + size <= bytes.length);
    atoms.push(bytes.toString("ascii", offset + 4, offset + 8));
    offset += size;
  }
  assert.ok(atoms.indexOf("moov") >= 0 && atoms.indexOf("moov") < atoms.indexOf("mdat"), "faststart atom order");
}
async function firstPixels(path, suffix, filters = []) {
  const output = join(directory, suffix + ".rgb");
  await runProcess(config.ffmpeg, ["-nostdin", "-v", "error", ...filters, "-i", path,
    "-frames:v", "1", "-vf", "scale=64:64", "-pix_fmt", "rgb24", "-f", "rawvideo", "-y", output]);
  return await readFile(output);
}
const results = [];
try {
  const imageSelfTest = await runVideoVerifierSelfTest({ config, runProcess });
  const version = (await runProcess(config.ffmpeg, ["-version"])).stdout.split(/\r?\n/)[0];
  for (const sample of [
    { name: "rational", size: "1920x1080", rate: "30000/1001", seconds: 10, audio: true },
    { name: "silent", size: "640x360", rate: "24000/1001", seconds: 4, audio: false },
    { name: "vfr-downmix", size: "1280x720", rate: "60000/1001", seconds: 10, audio: true,
      filter: "select='if(lt(t,5),not(mod(n,2)),1)'", channels: 6, multipleAudio: true },
    { name: "selected-timeline", size: "320x240", rate: "30", seconds: 5, audio: true, longUnselectedAudio: true },
    { name: "rotated-hevc-hlg", fixture: "hevc-hlg-rotated.mov", audio: true, hdr: true },
  ]) {
    const sourcePath = join(directory, sample.name + (sample.fixture ? ".mov" : ".mp4"));
    if (sample.fixture) await copyFile(new URL("../server/fixtures/" + sample.fixture, import.meta.url), sourcePath);
    else await runProcess(config.ffmpeg, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", `testsrc2=size=${sample.size}:rate=${sample.rate}:duration=${sample.seconds}`,
      ...(sample.audio ? ["-f", "lavfi", "-i", `sine=frequency=${sample.multipleAudio ? 500 : 1000}:sample_rate=48000:duration=${sample.seconds}`] : []),
      ...(sample.multipleAudio ? ["-itsoffset", "0.15", "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000",
        "-map", "0:v", "-map", "1:a", "-map", "2:a", "-disposition:a:0", "0", "-disposition:a:1", "default"] : []),
      ...(sample.longUnselectedAudio ? ["-f", "lavfi", "-i", "sine=frequency=500:sample_rate=48000:duration=10",
        "-map", "0:v", "-map", "1:a", "-map", "2:a", "-disposition:a:0", "default", "-disposition:a:1", "0"] : []),
      ...(sample.longUnselectedAudio ? [] : ["-t", String(sample.seconds)]), ...(sample.filter ? ["-vf", sample.filter, "-fps_mode", "vfr"] : []),
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-pix_fmt", "yuv420p",
      ...(sample.audio ? ["-c:a", "aac", "-ac", String(sample.channels || 2)] : []), "-y", sourcePath]);
    const source = await probeUniversalVideo(sourcePath, sample.fixture ? "video/quicktime" : "video/mp4", config, { runProcess, directory });
    if (sample.longUnselectedAudio) {
      assert.equal(source.resourceDurationMs, 10000); assert.equal(source.durationMs, 5000); assert.equal(source.audioIndex, 1);
    }
    const output = join(directory, sample.name + ".delivery.mp4");
    const start = performance.now();
    const delivery = await createSanitizedDelivery(sourcePath, output, source, null, config, { runProcess, directory });
    const elapsedMs = Math.round(performance.now() - start);
    const repeated = join(directory, sample.name + ".repeat.mp4");
    await createSanitizedDelivery(sourcePath, repeated, source, null, config, { runProcess, directory });
    assert.deepEqual(await readFile(output), await readFile(repeated), "repeated processing is deterministic");
    const meta = await metadata(output), video = meta.streams.find((stream) => stream.codec_type === "video");
    const audio = meta.streams.find((stream) => stream.codec_type === "audio");
    assert.equal(video.codec_name, "h264"); assert.equal(video.pix_fmt, "yuv420p");
    assert.equal(video.field_order, "progressive"); assert.equal(video.sample_aspect_ratio, "1:1");
    assert.equal(!!audio, sample.audio); if (audio) { assert.equal(audio.profile, "LC"); assert.ok(audio.channels <= 2); }
    const expectedWidth = source.rotation % 180 ? source.height : source.width;
    const expectedHeight = source.rotation % 180 ? source.width : source.height;
    assert.equal(video.width, expectedWidth); assert.equal(video.height, expectedHeight);
    faststart(await readFile(output));
    // Compare decoded first-frame pictures. FFmpeg's display transform is read
    // once on the source and the cleared delivery must have the same orientation.
    const sourcePixels = await firstPixels(sourcePath, sample.name + "-source");
    const outputPixels = await firstPixels(output, sample.name + "-output");
    const pictureMae = sourcePixels.reduce((sum, pixel, index) => sum + Math.abs(pixel - outputPixels[index]), 0) / sourcePixels.length;
    const mean = (bytes) => bytes.reduce((sum, value) => sum + value, 0) / bytes.length;
    const meanSource = mean(sourcePixels), meanOutput = mean(outputPixels);
    let covariance = 0, varianceSource = 0, varianceOutput = 0;
    for (let index = 0; index < sourcePixels.length; index++) {
      const a = sourcePixels[index] - meanSource, b = outputPixels[index] - meanOutput;
      covariance += a * b; varianceSource += a * a; varianceOutput += b * b;
    }
    const pictureCorrelation = covariance / Math.sqrt(varianceSource * varianceOutput);
    assert.ok(pictureCorrelation > 0.9, `decoded spatial/color correlation ${pictureCorrelation}`);
    if (!sample.hdr) assert.ok(pictureMae < 8, `decoded picture MAE ${pictureMae}`);
    else assert.equal(video.color_transfer, "bt709");
    let audioFrequency = null;
    if (audio) {
      const pcm = join(directory, sample.name + ".pcm");
      await runProcess(config.ffmpeg, ["-nostdin", "-v", "error", "-i", output, "-ss", "0.5", "-map", "0:a:0", "-t", "1",
        "-ac", "1", "-ar", "48000", "-f", "s16le", "-y", pcm]);
      const bytes = await readFile(pcm); let crossings = 0, prior = 0;
      for (let offset = 0; offset + 1 < bytes.length; offset += 2) {
        const value = bytes.readInt16LE(offset); if (prior <= 0 && value > 0) crossings++; prior = value;
      }
      audioFrequency = crossings / (bytes.length / 2 / 48000);
      assert.ok(Math.abs(audioFrequency - 1000) < 15, `selected audio tone ${audioFrequency}`);
    }
    results.push({ name: sample.name, elapsedMs, inputBytes: (await readFile(sourcePath)).length,
      outputBytes: delivery.file.size, strategy: delivery.strategy, width: video.width, height: video.height,
      sourceDurationMs: source.durationMs, deliveryDurationMs: delivery.video.durationMs,
      resourceDurationMs: source.resourceDurationMs,
      sourceAvOffset: source.audioStart - source.videoStart, deliveryAvOffset: delivery.video.audioStart - delivery.video.videoStart,
      pictureMae, pictureCorrelation, audioFrequency, colorTransfer: video.color_transfer, fullDecode: true, faststart: true });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try {
    await assert.rejects(runVerifierProcess(config.ffmpeg, ["-nostdin", "-v", "error", "-re", "-f", "lavfi",
      "-i", "testsrc2=size=320x240:rate=30", "-f", "null", "-"], { cwd: directory, signal: controller.signal }),
    (error) => error.code === "job_cancelled");
  } finally { clearTimeout(timer); }
  let browserResults = [];
  if (process.argv.includes("--browser")) {
    const require = createRequire(import.meta.url);
    const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || "playwright");
    const media = new Map();
    for (const result of results) media.set(`/${result.name}.mp4`, await readFile(join(directory, result.name + ".delivery.mp4")));
    const server = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/") return void res.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><title>Local converter acceptance</title>");
      const bytes = media.get(req.url);
      if (req.method !== "GET" || !bytes) return void res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": bytes.length }); res.end(bytes);
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    let browser;
    try {
      browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"],
        ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
      const page = await browser.newPage();
      for (const result of results) {
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        const playback = await page.evaluate(async (url) => {
          const video = document.createElement("video"); document.body.appendChild(video); video.src = url;
          return await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("playback timeout")), 30000);
            video.onerror = () => { clearTimeout(timeout); reject(new Error(`browser media error ${video.error?.code}`)); };
            video.onended = () => { clearTimeout(timeout); resolve({ ended: true, duration: video.duration,
              width: video.videoWidth, height: video.videoHeight, frames: video.getVideoPlaybackQuality().totalVideoFrames,
              droppedFrames: video.getVideoPlaybackQuality().droppedVideoFrames }); };
            video.play().catch(reject);
          });
        }, `http://127.0.0.1:${server.address().port}/${result.name}.mp4`);
        assert.equal(playback.width, result.width); assert.equal(playback.height, result.height);
        browserResults.push({ name: result.name, ...playback });
      }
    } finally { await browser?.close(); await new Promise((done) => server.close(done)); }
  }
  await writeFile(join(directory, "evidence.json"), JSON.stringify({ version, imageSelfTest, results, commands, browserResults }, null, 2));
  console.log(JSON.stringify({ directory, version, results, interruptedProcess: "passed", repeatedProcessing: "passed",
    resourceObservations: commands.filter((item) => item.operation === "conversion").map((item) => item.resources), browserResults }, null, 2));
} catch (error) { console.error(`Evidence directory: ${directory}`); throw error; }
