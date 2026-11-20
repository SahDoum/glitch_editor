import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modes = new Set([
  "zero",
  "scale",
  "randomize",
  "offset",
  "invert",
  "isolate",
  "dc-steps",
  "low-pass",
  "ringing-boost",
  "engrave-horizontal",
  "engrave-vertical",
]);
const domains = new Set(["ac", "dc"]);
const bands = new Set(["low", "mid", "high", "all"]);
const modeCode = {
  zero: 0,
  scale: 1,
  randomize: 2,
  offset: 3,
  invert: 4,
  isolate: 5,
  "dc-steps": 6,
  "low-pass": 7,
  "ringing-boost": 8,
  "engrave-horizontal": 9,
  "engrave-vertical": 10,
};
const domainCode = { ac: 0, dc: 1 };
const bandCode = { low: 0, mid: 1, high: 2, all: 3 };

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

function usage() {
  console.log(
    "Usage: node scripts/generate-example-assets.mjs --input photo.jpg " +
      "[--output-dir public/examples] [--config scripts/example-assets.config.json]",
  );
}

const inputPath = option("input");
if (process.argv.includes("--help") || !inputPath) {
  usage();
  if (!inputPath) process.exitCode = 1;
  process.exit();
}

const outputDirectory = resolve(
  root,
  option("output-dir") ?? "public/examples",
);
const configPath = resolve(
  root,
  option("config") ?? "scripts/example-assets.config.json",
);
const config = JSON.parse(await readFile(configPath, "utf8"));
const inputBytes = new Uint8Array(
  await readFile(resolve(process.cwd(), inputPath)),
);
await mkdir(outputDirectory, { recursive: true });

function frameGeometry(bytes) {
  for (let offset = 2; offset + 9 < bytes.length;) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3
    ) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      const count = bytes[offset + 9];
      const factors = [];
      let maxH = 0;
      let maxV = 0;
      for (let index = 0; index < count; index++) {
        const sampling = bytes[offset + 11 + index * 3];
        const h = sampling >> 4;
        const v = sampling & 15;
        factors.push({ h, v });
        maxH = Math.max(maxH, h);
        maxV = Math.max(maxV, v);
      }
      return factors.map(({ h, v }) => ({
        columns: Math.ceil((width * h) / maxH / 8),
        rows: Math.ceil((height * v) / maxV / 8),
      }));
    }
    if (length < 2) break;
    offset += length + 2;
  }
  throw new Error(
    "Input does not contain a supported baseline/progressive JPEG frame.",
  );
}

function validateEffect(effect, componentCount) {
  if (!effect || typeof effect !== "object")
    throw new Error("Each effect must be an object.");
  for (const [key, values] of [
    ["mode", modes],
    ["domain", domains],
    ["frequencyBand", bands],
  ]) {
    if (!values.has(effect[key]))
      throw new Error(
        `Invalid ${key} in effect ${effect.name ?? "<unnamed>"}.`,
      );
  }
  if (
    !Number.isInteger(effect.component) ||
    effect.component < 0 ||
    effect.component >= componentCount
  ) {
    throw new Error(
      `Invalid component in effect ${effect.name ?? "<unnamed>"}.`,
    );
  }
  if (
    !Number.isFinite(effect.strength) ||
    !Number.isInteger(effect.seed) ||
    effect.seed < 0
  ) {
    throw new Error(
      `Invalid strength or seed in effect ${effect.name ?? "<unnamed>"}.`,
    );
  }
  if (
    typeof effect.output !== "string" ||
    effect.output.includes("..") ||
    effect.output.includes("/")
  ) {
    throw new Error(
      `Invalid output filename in effect ${effect.name ?? "<unnamed>"}.`,
    );
  }
}

const codecDirectory = new URL("../public/codec/", import.meta.url);
globalThis.self = globalThis;
globalThis.location = { href: codecDirectory.href };
globalThis.WorkerGlobalScope = class {
  static [Symbol.hasInstance]() {
    return true;
  }
};
globalThis.importScripts = () => undefined;
const { default: createCodec } = await import(
  new URL("libjpeg-coefficients.js", codecDirectory)
);
const wasmBinary = await readFile(
  new URL("libjpeg-coefficients.wasm", codecDirectory),
);
const savedProcess = globalThis.process;
globalThis.process = undefined;
const codec = await createCodec({ wasmBinary });
globalThis.process = savedProcess;

const components = frameGeometry(inputBytes);
const inputPointer = codec._malloc(inputBytes.byteLength);
if (!inputPointer) throw new Error("Could not allocate input buffer.");
codec.HEAPU8.set(inputBytes, inputPointer);
if (codec._coefficient_open(inputPointer, inputBytes.byteLength) !== 0) {
  codec._free(inputPointer);
  throw new Error("The input JPEG could not be opened by libjpeg.");
}

await writeFile(
  resolve(outputDirectory, config.original ?? "original.jpg"),
  inputBytes,
);
for (const effect of config.effects ?? []) {
  validateEffect(effect, components.length);
  const { columns, rows } = components[effect.component];
  const maskPointer = codec._malloc(columns * rows);
  if (!maskPointer)
    throw new Error(`Could not allocate mask for ${effect.name}.`);
  codec.HEAPU8.fill(1, maskPointer, maskPointer + columns * rows);
  const status = codec._coefficient_apply(
    effect.component,
    modeCode[effect.mode],
    domainCode[effect.domain],
    bandCode[effect.frequencyBand],
    maskPointer,
    columns * rows,
    effect.strength,
    effect.seed,
  );
  codec._free(maskPointer);
  if (status !== 0 || codec._coefficient_encode(0) !== 0) {
    throw new Error(
      `Could not render effect ${effect.name}. Codec status: ${status}.`,
    );
  }
  const start = codec._coefficient_output_pointer();
  const size = codec._coefficient_output_size();
  await writeFile(
    resolve(outputDirectory, effect.output),
    codec.HEAPU8.slice(start, start + size),
  );
  console.log(`${effect.name}: ${effect.output} (${size} bytes)`);
  // Re-open the original before the next effect; each preset is independent.
  codec._coefficient_close();
  codec.HEAPU8.set(inputBytes, inputPointer);
  if (codec._coefficient_open(inputPointer, inputBytes.byteLength) !== 0) {
    throw new Error("Could not reset codec for the next effect.");
  }
}
codec._coefficient_close();
console.log(
  `Wrote ${config.effects?.length ?? 0} effect asset(s) and ${config.original ?? "original.jpg"}.`,
);
