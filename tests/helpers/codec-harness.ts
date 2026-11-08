import { readFileSync } from "node:fs";
import { inspectJpeg } from "../../src/jpeg/inspect";
import type { JpegOutputMode } from "../../src/jpeg/encode-options";

interface CodecModule {
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _coefficient_open(pointer: number, size: number): number;
  _coefficient_read_block(
    component: number,
    x: number,
    y: number,
    output: number,
  ): number;
  _coefficient_apply(
    component: number,
    mode: number,
    domain: number,
    band: number,
    mask: number,
    maskSize: number,
    strength: number,
    seed: number,
  ): number;
  _coefficient_set_quantization(
    tableId: number,
    semantics: number,
    values: number,
    size: number,
  ): number;
  _coefficient_encode(progressive: number): number;
  _coefficient_output_pointer(): number;
  _coefficient_output_size(): number;
  _coefficient_close(): void;
}

const CODEC_DIRECTORY = new URL("../../public/codec/", import.meta.url);
let codecPromise: Promise<CodecModule> | null = null;

// The generated module targets web workers; emulate just enough of one to
// load the same WebAssembly bridge the application ships.
export function loadCodec(): Promise<CodecModule> {
  codecPromise ??= (async () => {
    const globals = globalThis as Record<string, unknown>;
    const savedProcess = globals.process;
    globals.self = globalThis;
    globals.location = { href: CODEC_DIRECTORY.href };
    globals.WorkerGlobalScope = class {
      static [Symbol.hasInstance]() {
        return true;
      }
    };
    globals.importScripts = () => undefined;
    const moduleUrl = new URL("libjpeg-coefficients.js", CODEC_DIRECTORY);
    const create = (
      (await import(/* @vite-ignore */ moduleUrl.href)) as {
        default: (options: { wasmBinary: Buffer }) => Promise<CodecModule>;
      }
    ).default;
    const wasmBinary = readFileSync(
      new URL("libjpeg-coefficients.wasm", CODEC_DIRECTORY),
    );
    globals.process = undefined;
    try {
      return await create({ wasmBinary });
    } finally {
      globals.process = savedProcess;
    }
  })();
  return codecPromise;
}

export interface CodecSession {
  codec: CodecModule;
  /** Real (non-padded) block dimensions of each component. */
  componentBlocks: Array<{ columns: number; rows: number }>;
}

export async function withOpenCodec<T>(
  bytes: Uint8Array,
  action: (session: CodecSession) => T,
): Promise<{ status: number; value?: T }> {
  const codec = await loadCodec();
  const pointer = codec._malloc(bytes.byteLength);
  codec.HEAPU8.set(bytes, pointer);
  try {
    const status = codec._coefficient_open(pointer, bytes.byteLength);
    if (status !== 0) return { status };
    const inspection = inspectJpeg(bytes);
    if (!inspection.ok) throw new Error(inspection.error.message);
    const { width, height, components } = inspection.value;
    const maxH = Math.max(...components.map((c) => c.horizontalSampling));
    const maxV = Math.max(...components.map((c) => c.verticalSampling));
    const componentBlocks = components.map((component) => ({
      columns: Math.ceil(
        Math.ceil((width * component.horizontalSampling) / maxH) / 8,
      ),
      rows: Math.ceil(
        Math.ceil((height * component.verticalSampling) / maxV) / 8,
      ),
    }));
    return { status, value: action({ codec, componentBlocks }) };
  } finally {
    codec._coefficient_close();
    codec._free(pointer);
  }
}

export function readCoefficients(session: CodecSession): Int16Array[] {
  const { codec, componentBlocks } = session;
  const output = codec._malloc(64 * 2);
  try {
    return componentBlocks.map(({ columns, rows }, component) => {
      const values = new Int16Array(columns * rows * 64);
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < columns; x += 1) {
          const status = codec._coefficient_read_block(component, x, y, output);
          if (status !== 0) throw new Error(`read_block failed: ${status}`);
          values.set(
            new Int16Array(codec.HEAPU8.buffer.slice(output, output + 128)),
            (y * columns + x) * 64,
          );
        }
      }
      return values;
    });
  } finally {
    codec._free(output);
  }
}

export function applyToAllBlocks(
  session: CodecSession,
  component: number,
  mode: number,
  domain: number,
  band: number,
  strength: number,
  seed: number,
): number {
  const { codec, componentBlocks } = session;
  const { columns, rows } = componentBlocks[component]!;
  const maskSize = columns * rows;
  const mask = codec._malloc(maskSize);
  codec.HEAPU8.fill(1, mask, mask + maskSize);
  try {
    return codec._coefficient_apply(
      component,
      mode,
      domain,
      band,
      mask,
      maskSize,
      strength,
      seed,
    );
  } finally {
    codec._free(mask);
  }
}

export function setQuantization(
  session: CodecSession,
  tableId: number,
  semantics: number,
  values: readonly number[],
): number {
  const { codec } = session;
  const pointer = codec._malloc(values.length);
  codec.HEAPU8.set(values, pointer);
  try {
    return codec._coefficient_set_quantization(
      tableId,
      semantics,
      pointer,
      values.length,
    );
  } finally {
    codec._free(pointer);
  }
}

export function encodeOpened(
  session: CodecSession,
  mode: JpegOutputMode,
): Uint8Array {
  const { codec } = session;
  const status = codec._coefficient_encode(mode === "progressive" ? 1 : 0);
  if (status !== 0) throw new Error(`encode failed: ${status}`);
  const pointer = codec._coefficient_output_pointer();
  return codec.HEAPU8.slice(
    pointer,
    pointer + codec._coefficient_output_size(),
  );
}
