import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { inspectJpeg } from "../../src/jpeg/inspect";
import type { JpegOutputMode } from "../../src/jpeg/encode-options";
import {
  applyToAllBlocks,
  encodeOpened,
  readCoefficients,
  setQuantization,
  withOpenCodec,
  type CodecSession,
} from "../helpers/codec-harness";

async function fixture(file: string): Promise<Uint8Array> {
  return new Uint8Array(
    await readFile(new URL(`../fixtures/${file}`, import.meta.url)),
  );
}

const FIXTURES = [
  "synthetic-color-420",
  "synthetic-color-444",
  "synthetic-grayscale",
  "synthetic-color-odd-420",
  "synthetic-texture-420",
] as const;

// Mode/domain/band indices from the codec bridge (see coefficient.worker.ts).
const ZERO = 0;
const SCALE = 1;
const ISOLATE = 5;
const AC = 0;
const DC = 1;
const BAND_LOW = 0;
const BAND_ALL = 3;

async function reencode(
  source: Uint8Array,
  mode: JpegOutputMode,
  edit?: (session: CodecSession) => void,
): Promise<Uint8Array> {
  const result = await withOpenCodec(source, (session) => {
    edit?.(session);
    return encodeOpened(session, mode);
  });
  expect(result.status).toBe(0);
  return result.value!;
}

async function coefficientsOf(bytes: Uint8Array): Promise<Int16Array[]> {
  const result = await withOpenCodec(bytes, readCoefficients);
  expect(result.status).toBe(0);
  return result.value!;
}

function decodeToPixels(bytes: Uint8Array): Buffer | null {
  const result = spawnSync("djpeg", ["-pnm"], {
    input: bytes,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) return null;
  expect(result.status, result.stderr?.toString()).toBe(0);
  return result.stdout;
}

describe("progressive JPEG import", () => {
  it.each(FIXTURES)(
    "%s: progressive and baseline files expose identical coefficients",
    async (name) => {
      const baseline = await coefficientsOf(await fixture(`${name}.jpg`));
      const progressive = await coefficientsOf(
        await fixture(`${name}-progressive.jpg`),
      );
      expect(progressive).toHaveLength(baseline.length);
      progressive.forEach((component, index) => {
        expect(component).toEqual(baseline[index]);
      });
      // Guard against an all-zero comparison.
      expect(progressive[0]!.some((value) => value !== 0)).toBe(true);
    },
  );

  it("rejects a progressive JPEG whose scan data was damaged", async () => {
    const bytes = await fixture("synthetic-color-420-progressive.jpg");
    const inspection = inspectJpeg(bytes);
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;
    const damaged = bytes.slice();
    const scan = inspection.value.scans[3]!;
    damaged.fill(0xff, scan.dataStartOffset, scan.dataStartOffset + 1);
    damaged[scan.dataStartOffset + 1] = 0xd0;
    const result = await withOpenCodec(damaged, () => undefined);
    expect(result.status).not.toBe(0);
  });
});

describe("progressive JPEG export", () => {
  const combinations = FIXTURES.flatMap((name) =>
    (["baseline", "progressive"] as const).flatMap((input) =>
      (["baseline", "progressive"] as const).map(
        (output) => [name, input, output] as const,
      ),
    ),
  );

  it.each(combinations)(
    "%s: %s input to %s output keeps coefficients, geometry and tables",
    async (name, input, output) => {
      const source = await fixture(
        input === "baseline" ? `${name}.jpg` : `${name}-progressive.jpg`,
      );
      const original = inspectJpeg(source);
      const encoded = await reencode(source, output);
      const inspection = inspectJpeg(encoded);
      expect(original.ok && inspection.ok).toBe(true);
      if (!original.ok || !inspection.ok) return;

      const sofNames = inspection.value.markers
        .filter(({ name: marker }) => marker.startsWith("SOF"))
        .map(({ name: marker }) => marker);
      if (output === "progressive") {
        expect(sofNames).toEqual(["SOF2"]);
        expect(inspection.value.process).toBe("Progressive DCT Huffman");
        expect(inspection.value.scans.length).toBeGreaterThan(1);
      } else {
        expect(sofNames).toEqual(["SOF0"]);
        expect(inspection.value.scans).toHaveLength(1);
      }

      expect(inspection.value.width).toBe(original.value.width);
      expect(inspection.value.height).toBe(original.value.height);
      expect(
        inspection.value.components.map((component) => [
          component.id,
          component.horizontalSampling,
          component.verticalSampling,
          component.quantizationTable,
        ]),
      ).toEqual(
        original.value.components.map((component) => [
          component.id,
          component.horizontalSampling,
          component.verticalSampling,
          component.quantizationTable,
        ]),
      );
      expect(inspection.value.quantizationTables).toEqual(
        original.value.quantizationTables,
      );

      expect(await coefficientsOf(encoded)).toEqual(
        await coefficientsOf(source),
      );
    },
  );

  it.each(FIXTURES)(
    "%s: an independent decoder renders identical pixels for both output modes",
    async (name) => {
      const source = await fixture(`${name}-progressive.jpg`);
      const baseline = decodeToPixels(await reencode(source, "baseline"));
      const progressive = decodeToPixels(await reencode(source, "progressive"));
      if (baseline === null || progressive === null) return;
      expect(progressive.length).toBeGreaterThan(0);
      expect(progressive.equals(baseline)).toBe(true);
    },
  );

  it("is deterministic for repeated progressive encodes", async () => {
    const source = await fixture("synthetic-color-420-progressive.jpg");
    const first = await reencode(source, "progressive");
    const second = await reencode(source, "progressive");
    expect(second).toEqual(first);
  });
});

describe("operations on progressive inputs", () => {
  type Edit = (session: CodecSession) => void;
  const operations: Array<[string, Edit]> = [
    [
      "DC modification",
      (session) =>
        expect(applyToAllBlocks(session, 0, SCALE, DC, BAND_ALL, 2, 1)).toBe(0),
    ],
    [
      "AC modification",
      (session) =>
        expect(applyToAllBlocks(session, 0, ZERO, AC, BAND_ALL, 1, 1)).toBe(0),
    ],
    [
      "frequency isolation",
      (session) =>
        expect(applyToAllBlocks(session, 0, ISOLATE, AC, BAND_LOW, 0, 1)).toBe(
          0,
        ),
    ],
    [
      "component-specific operation",
      (session) =>
        expect(
          applyToAllBlocks(
            session,
            session.componentBlocks.length - 1,
            SCALE,
            AC,
            BAND_ALL,
            0,
            3,
          ),
        ).toBe(0),
    ],
    [
      "DQT editing",
      (session) =>
        expect(
          setQuantization(
            session,
            0,
            1,
            Array.from({ length: 64 }, (_, index) => 4 + (index % 9)),
          ),
        ).toBe(0),
    ],
  ];

  it.each(operations)(
    "%s yields identical results for baseline and progressive sources and outputs",
    async (_label, edit) => {
      const baselineSource = await fixture("synthetic-texture-420.jpg");
      const progressiveSource = await fixture(
        "synthetic-texture-420-progressive.jpg",
      );
      const reference = await reencode(baselineSource, "baseline", edit);
      const referenceCoefficients = await coefficientsOf(reference);
      expect(referenceCoefficients).not.toEqual(
        await coefficientsOf(baselineSource),
      );

      for (const source of [baselineSource, progressiveSource]) {
        for (const mode of ["baseline", "progressive"] as const) {
          const output = await reencode(source, mode, edit);
          expect(await coefficientsOf(output)).toEqual(referenceCoefficients);
          expect(inspectJpeg(output).ok).toBe(true);
        }
      }

      const pixelsBaseline = decodeToPixels(reference);
      const pixelsProgressive = decodeToPixels(
        await reencode(progressiveSource, "progressive", edit),
      );
      if (pixelsBaseline && pixelsProgressive) {
        expect(pixelsProgressive.equals(pixelsBaseline)).toBe(true);
      }
    },
  );
});
