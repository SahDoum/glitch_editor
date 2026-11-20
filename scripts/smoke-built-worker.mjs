import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { build } from "vite";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const useExistingBuild = process.argv.includes("--built");
const baseIndex = process.argv.indexOf("--base");
const base = baseIndex < 0 ? "/worker-smoke/" : process.argv[baseIndex + 1];
if (!base?.startsWith("/") || !base.endsWith("/")) {
  throw new Error("--base must be an absolute publication path ending in /.");
}
const temporary = await mkdtemp(join(tmpdir(), "jpeg-worker-smoke-"));
const outputDirectory = useExistingBuild
  ? join(root, "dist")
  : join(temporary, "dist");
const profile = join(temporary, "chrome");
let browser;
let server;
try {
  if (!useExistingBuild) {
    await build({
      root,
      base,
      logLevel: "warn",
      build: { outDir: outputDirectory, emptyOutDir: true },
    });
  }
  const workerFile = (await readdir(join(outputDirectory, "assets"))).find(
    (name) => /^coefficient\.worker-.*\.js$/.test(name),
  );
  assert.ok(workerFile, "Build must contain the actual coefficient worker.");
  const requestedAssets = new Set();
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      requestedAssets.add(url.pathname + url.search);
      if (!url.pathname.startsWith(base)) {
        response.writeHead(404).end();
        return;
      }
      const relative = url.pathname.slice(base.length);
      if (relative === "smoke.html") {
        response.setHeader("Content-Type", "text/html");
        response.end("<!doctype html><title>Built JPEG worker smoke</title>");
        return;
      }
      const file =
        relative === "fixture.jpg"
          ? join(root, "tests/fixtures/synthetic-texture-420.jpg")
          : resolve(outputDirectory, relative);
      if (
        !file.startsWith(outputDirectory + "/") &&
        relative !== "fixture.jpg"
      ) {
        response.writeHead(404).end();
        return;
      }
      const contentTypes = {
        ".js": "text/javascript",
        ".wasm": "application/wasm",
        ".jpg": "image/jpeg",
      };
      response.setHeader(
        "Content-Type",
        contentTypes[extname(file)] ?? "application/octet-stream",
      );
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = spawn(
    process.env.CHROMIUM || "chromium",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--remote-debugging-pipe",
      `--user-data-dir=${profile}`,
    ],
    { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
  );
  let nextId = 0;
  let incoming = "";
  const pending = new Map();
  const fail = (error) => {
    for (const { reject, timeout } of pending.values()) {
      clearTimeout(timeout);
      reject(error);
    }
    pending.clear();
  };
  browser.on("error", fail);
  browser.on("exit", (code) => fail(new Error(`Chromium exited: ${code}`)));
  browser.stdio[4].on("data", (data) => {
    incoming += data.toString();
    let end;
    while ((end = incoming.indexOf("\0")) >= 0) {
      const raw = incoming.slice(0, end);
      incoming = incoming.slice(end + 1);
      if (!raw) continue;
      const message = JSON.parse(raw);
      const callback = pending.get(message.id);
      if (!callback) continue;
      pending.delete(message.id);
      clearTimeout(callback.timeout);
      if (message.error)
        callback.reject(new Error(JSON.stringify(message.error)));
      else callback.resolve(message.result);
    }
  });
  const cdp = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Chromium command timed out: ${method}`));
      }, 30000);
      pending.set(id, { resolve, reject, timeout });
      browser.stdio[3].write(
        JSON.stringify({ id, method, params, sessionId }) + "\0",
      );
    });
  await cdp("Browser.getVersion");
  const { targetId } = await cdp("Target.createTarget", {
    url: `${origin}${base}smoke.html`,
  });
  const { sessionId } = await cdp("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  // Navigation is explicit so evaluation never races the initial about:blank.
  await cdp("Page.enable", {}, sessionId);
  await cdp("Page.navigate", { url: `${origin}${base}smoke.html` }, sessionId);
  const expression = `(${async function smoke(workerUrl, fixtureUrl) {
    // Use absolute URLs so this also works while the minimal page is loading.
    const input = await (await fetch(fixtureUrl)).arrayBuffer();
    const worker = new globalThis.Worker(workerUrl, { type: "module" });
    let id = 0;
    const request = (payload) =>
      new Promise((resolve, reject) => {
        const requestId = ++id;
        worker.onmessage = ({ data }) => {
          if (data.id !== requestId) return;
          if (!data.result.ok)
            reject(new Error(JSON.stringify(data.result.error)));
          else resolve(data.result.value);
        };
        worker.onerror = ({ message }) => reject(new Error(message));
        worker.postMessage({ id: requestId, ...payload });
      });
    try {
      // Geometry is supplied by the same fixture inspector used by the app test.
      const bytes = new Uint8Array(input);
      let width, height, components;
      for (let offset = 2; offset < bytes.length;) {
        const marker = bytes[offset + 1];
        const size = bytes[offset + 2] * 256 + bytes[offset + 3];
        if (marker === 0xc0) {
          height = bytes[offset + 5] * 256 + bytes[offset + 6];
          width = bytes[offset + 7] * 256 + bytes[offset + 8];
          components = Array.from({ length: bytes[offset + 9] }, (_, i) => {
            const position = offset + 10 + 3 * i;
            return {
              id: bytes[position],
              horizontalSampling: bytes[position + 1] >> 4,
              verticalSampling: bytes[position + 1] & 15,
              quantizationTable: bytes[position + 2],
            };
          });
          break;
        }
        offset += 2 + size;
      }
      const geometry = { width, height, components };
      await request({ type: "open", bytes: input });
      const read = () =>
        request({
          type: "read-block",
          componentIndex: 0,
          blockX: 1,
          blockY: 0,
        });
      const source = await request({
        type: "read-block",
        componentIndex: 0,
        blockX: 0,
        blockY: 0,
      });
      const originalDestination = await read();
      if (
        JSON.stringify(source.values) ===
        JSON.stringify(originalDestination.values)
      )
        throw new Error("Fixture blocks must differ");
      const operation = {
        kind: "block-transfer",
        componentIndex: 0,
        sourceX: 0,
        sourceY: 0,
        width: 1,
        height: 1,
        destinationX: 1,
        destinationY: 0,
        mode: "all",
        action: "copy",
      };
      const results = [];
      let previousBaseline;
      for (const mode of ["baseline", "baseline", "progressive"]) {
        const started = performance.now();
        const encoded = await request({
          type: "encode",
          bytes: input,
          geometry,
          operations: [operation],
          options: { mode },
        });
        const encodeMs = performance.now() - started;
        if (mode === "baseline") {
          const values = [...new Uint8Array(encoded.bytes)];
          if (
            previousBaseline &&
            JSON.stringify(previousBaseline) !== JSON.stringify(values)
          )
            throw new Error(
              "Persistent worker changed identical baseline output",
            );
          previousBaseline = values;
        }
        await request({ type: "open", bytes: encoded.bytes });
        const destination = await read();
        if (
          JSON.stringify(source.values) !== JSON.stringify(destination.values)
        )
          throw new Error(
            "Block Transfer did not copy all quantized coefficients",
          );
        results.push({
          mode,
          encodeMs,
          bytes: encoded.bytes.byteLength,
          coefficients: destination.values.length,
        });
      }
      return results;
    } finally {
      worker.terminate();
    }
  }.toString()})(${JSON.stringify(`${origin}${base}assets/${workerFile}`)}, ${JSON.stringify(`${origin}${base}fixture.jpg`)})`;
  const result = await cdp(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  assert.equal(
    result.exceptionDetails,
    undefined,
    JSON.stringify(result.exceptionDetails),
  );
  assert.equal(result.result.type, "object", JSON.stringify(result));
  for (const name of ["libjpeg-coefficients.js", "libjpeg-coefficients.wasm"]) {
    assert.ok(
      [...requestedAssets].some((url) =>
        url.startsWith(`${base}codec/${name}?v=`),
      ),
      `Versioned ${name} must load below ${base}`,
    );
    assert.ok(
      ![...requestedAssets].some((url) => url === `${base}codec/${name}`),
      "Unversioned codec requests are forbidden",
    );
  }
  console.log(
    JSON.stringify(
      {
        base,
        worker: workerFile,
        results: result.result.value,
        assets: [...requestedAssets].filter((url) => url.includes("/codec/")),
      },
      null,
      2,
    ),
  );
} finally {
  if (
    browser?.pid &&
    browser.exitCode === null &&
    browser.signalCode === null
  ) {
    const closed = new Promise((resolve) => browser.once("exit", resolve));
    browser.kill();
    await closed;
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(temporary, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
