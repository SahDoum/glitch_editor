import { readFile, readdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = new URL("../", import.meta.url);
const codecDirectory = new URL("public/codec/", root);
const wasmBinary = await readFile(
  new URL("libjpeg-coefficients.wasm", codecDirectory),
);
// The shipped module targets browser workers; provide only its loading surface.
globalThis.self = globalThis;
globalThis.location = { href: codecDirectory.href };
globalThis.WorkerGlobalScope = class {
  static [Symbol.hasInstance]() {
    return true;
  }
};
globalThis.importScripts = () => undefined;
const { default: factory } = await import(
  new URL("libjpeg-coefficients.js", codecDirectory)
);
async function createCodec() {
  const savedProcess = globalThis.process;
  globalThis.process = undefined;
  try {
    return await factory({ wasmBinary });
  } finally {
    globalThis.process = savedProcess;
  }
}
function geometry(bytes) {
  for (let offset = 2; offset < bytes.length;) {
    const marker = bytes[offset + 1];
    const size = bytes[offset + 2] * 256 + bytes[offset + 3];
    if (marker === 0xc0 || marker === 0xc2) {
      const height = bytes[offset + 5] * 256 + bytes[offset + 6];
      const width = bytes[offset + 7] * 256 + bytes[offset + 8];
      const factors = Array.from({ length: bytes[offset + 9] }, (_, i) => {
        const sampling = bytes[offset + 11 + 3 * i];
        return { h: sampling >> 4, v: sampling & 15 };
      });
      const maxH = Math.max(...factors.map(({ h }) => h));
      const maxV = Math.max(...factors.map(({ v }) => v));
      return {
        width,
        height,
        components: factors.map(({ h, v }) => ({
          columns: Math.ceil((width * h) / maxH / 8),
          rows: Math.ceil((height * v) / maxV / 8),
        })),
      };
    }
    offset += size + 2;
  }
  throw new Error("No DCT frame found.");
}
function run(codec, bytes, count, mode, earlyFree = true, smallMask = false) {
  const grid = geometry(bytes);
  const { columns, rows } = grid.components[0];
  let input = codec._malloc(bytes.length);
  codec.HEAPU8.set(bytes, input);
  const opened = performance.now();
  assert.equal(codec._coefficient_open(input, bytes.length), 0);
  const readMs = performance.now() - opened;
  if (earlyFree) {
    codec._free(input);
    input = 0;
  }
  const mask = codec._malloc(columns * rows);
  codec.HEAPU8.fill(0, mask, mask + columns * rows);
  for (let y = 0; y < (smallMask ? Math.min(rows, 30) : rows); y++) {
    codec.HEAPU8.fill(
      1,
      mask + y * columns,
      mask + y * columns + (smallMask ? Math.min(columns, 40) : columns),
    );
  }
  try {
    const applying = performance.now();
    for (let i = 0; i < count; i++) {
      // AC inversion preserves deterministic traversal and is non-idempotent.
      assert.equal(
        codec._coefficient_apply(0, 4, 0, 3, mask, columns * rows, 0, 1),
        0,
      );
    }
    const applyMs = performance.now() - applying;
    const encoding = performance.now();
    assert.equal(codec._coefficient_encode(mode), 0);
    const encodeMs = performance.now() - encoding;
    const start = codec._coefficient_output_pointer();
    const output = codec.HEAPU8.slice(
      start,
      start + codec._coefficient_output_size(),
    );
    return {
      output,
      readMs,
      applyMs,
      encodeMs,
      wasmHeapBytes: codec.HEAPU8.byteLength,
    };
  } finally {
    codec._free(mask);
    if (input) codec._free(input);
    codec._coefficient_close();
  }
}
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const codec = await createCodec();
const fixtureDirectory = new URL("tests/fixtures/", root);
const fixtureFiles = (await readdir(fixtureDirectory)).filter(
  (name) =>
    name.endsWith(".jpg") &&
    name.startsWith("synthetic-") &&
    !name.includes("damaged"),
);
let parityCases = 0;
for (const file of fixtureFiles) {
  const bytes = new Uint8Array(await readFile(new URL(file, fixtureDirectory)));
  // Reject intentionally unsupported processes before comparing encodes.
  try {
    geometry(bytes);
  } catch {
    continue;
  }
  for (const mode of [0, 1]) {
    const retained = run(codec, bytes, 1, mode, false);
    const released = run(codec, bytes, 1, mode, true);
    assert.deepEqual(released.output, retained.output, `${file}, mode ${mode}`);
    parityCases++;
  }
}
const file = process.argv[2]
  ? fileURLToPath(new URL(process.argv[2], `file://${process.cwd()}/`))
  : fileURLToPath(new URL("synthetic-texture-420.jpg", fixtureDirectory));
const bytes = new Uint8Array(await readFile(file));
const measurements = [];
for (const count of [1, 24]) {
  for (const smallMask of [true, false]) {
    for (const lifetime of ["fresh-module", "reused-module"]) {
      const samples = [];
      // Warm up compilation and the operation path before seven measurements.
      run(codec, bytes, count, 0, true, smallMask);
      for (let i = 0; i < 7; i++) {
        const start = performance.now();
        const module =
          lifetime === "fresh-module" ? await createCodec() : codec;
        const loaded = performance.now();
        const result = run(module, bytes, count, 0, true, smallMask);
        samples.push({
          totalMs: performance.now() - start,
          loadMs: loaded - start,
          ...result,
        });
      }
      const keys = [
        "totalMs",
        "loadMs",
        "readMs",
        "applyMs",
        "encodeMs",
        "wasmHeapBytes",
      ];
      measurements.push({
        count,
        mask: smallMask ? "320x240 maximum" : "full",
        lifetime,
        ...Object.fromEntries(
          keys.map((key) => [
            key,
            Number(median(samples.map((sample) => sample[key])).toFixed(3)),
          ]),
        ),
      });
    }
  }
}
// Feasibility probe: current bridge finalizes the decompressor after a write.
const pointer = codec._malloc(bytes.length);
codec.HEAPU8.set(bytes, pointer);
assert.equal(codec._coefficient_open(pointer, bytes.length), 0);
codec._free(pointer);
const firstEncodeStatus = codec._coefficient_encode(0);
const secondEncodeStatus = codec._coefficient_encode(1);
codec._coefficient_close();
console.log(
  JSON.stringify(
    {
      node: process.version,
      file,
      geometry: geometry(bytes),
      parityCases,
      temporaryBytesReleasedBeforeApply: bytes.length,
      measurements,
      checkpointProbe: {
        firstEncodeStatus,
        secondEncodeStatus,
        directCoefficientCheckpointSupported: false,
        reason:
          "jpeg_finish_decompress releases image pools; no snapshot/restore ABI. Reusing a loaded module still requires open and replay.",
      },
      memory: {
        coefficientStorageEstimateBytes: geometry(bytes).components.reduce(
          (sum, { columns, rows }) => sum + columns * rows * 128,
          0,
        ),
        coefficientLimitBytes: 256 * 1024 * 1024,
        wasmHeapLimitBytes: 512 * 1024 * 1024,
      },
    },
    null,
    2,
  ),
);
