import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import golden from "../fixtures/scan-corruption-golden.json";
import { ScanCorruptionHistory } from "../../src/application/scan-corruption";
import { inspectJpeg } from "../../src/jpeg/inspect";
import {
  encodeOpened,
  readCoefficients,
  withOpenCodec,
} from "../helpers/codec-harness";
import {
  corruptEntropyScan,
  MAX_SCAN_CORRUPTION_BYTES,
  MAX_SCAN_CORRUPTION_STAGES,
  type ScanCorruptionParameters,
} from "../../src/jpeg/scan-corruption";

import {
  decodeIndependently,
  independentDecoder,
} from "../helpers/independent-decoder";

async function fixtureBytes(fileName = "synthetic-color-420.jpg") {
  return new Uint8Array(
    await readFile(new URL(`../fixtures/${fileName}`, import.meta.url)),
  );
}

function insertBytes(
  source: Uint8Array,
  offset: number,
  inserted: Uint8Array,
): Uint8Array {
  const result = new Uint8Array(source.byteLength + inserted.byteLength);
  result.set(source.subarray(0, offset));
  result.set(inserted, offset);
  result.set(source.subarray(offset), offset + inserted.byteLength);
  return result;
}

function expectInspected(bytes: Uint8Array) {
  const result = inspectJpeg(bytes);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const baseParameters: ScanCorruptionParameters = {
  mode: "bit-flip",
  count: 2,
  rangeStart: 0,
  rangeEnd: 1,
  seed: 12,
};

describe("entropy-coded scan corruption", () => {
  it.each(["synthetic-color-420.jpg", "synthetic-color-420-progressive.jpg"])(
    "corrupts a baseline encoding of %s without prior coefficient edits",
    async (fileName) => {
      const source = await fixtureBytes(fileName);
      const original = source.slice();
      const encoded = await withOpenCodec(source, (session) => ({
        coefficients: readCoefficients(session),
        bytes: encodeOpened(session, "baseline"),
      }));
      expect(encoded.status).toBe(0);
      if (!encoded.value) throw new Error("Baseline encoding failed.");
      const clean = encoded.value.bytes;
      const inspection = expectInspected(clean);
      expect(inspection.process).toBe("Baseline sequential DCT Huffman");
      expect(inspection.scans).toHaveLength(1);
      const reopened = await withOpenCodec(clean, readCoefficients);
      expect(reopened.status).toBe(0);
      expect(reopened.value).toEqual(encoded.value.coefficients);
      const result = corruptEntropyScan(clean, [baseParameters]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.bytes).not.toEqual(clean);
      expect(result.value.reports[0]?.changedBytes).toBe(baseParameters.count);
      expect(source).toEqual(original);
    },
  );

  it("rejects Progressive JPEG input with an explanatory error", async () => {
    const source = await fixtureBytes("synthetic-color-420-progressive.jpg");
    const before = source.slice();
    const result = corruptEntropyScan(source, [baseParameters]);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "UNSUPPORTED_FORMAT",
        message: expect.stringContaining("does not support Progressive JPEG"),
      },
    });
    expect(source).toEqual(before);
  });

  it.skipIf(!independentDecoder)(
    "keeps the clean JPEG decodable and retains corrupted bytes across differing decoder recovery",
    async () => {
      const cleanBytes = await fixtureBytes();
      const original = cleanBytes.slice();
      const decode = (bytes: Uint8Array) =>
        decodeIndependently(bytes, ["-outfile", "/dev/null", "/dev/stdin"]);
      const cleanDecode = decode(cleanBytes);
      expect(cleanDecode.error).toBeUndefined();
      expect(cleanDecode.status, cleanDecode.stderr.toString()).toBe(0);

      const corruption = {
        ...baseParameters,
        mode: "byte-replacement" as const,
        count: 8,
        seed: 0,
      };
      const history = new ScanCorruptionHistory();
      expect(history.record(corruption).ok).toBe(true);
      const result = corruptEntropyScan(cleanBytes, history.activeStages);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const retainedCorruptBytes = result.value.bytes;
      const expectedCorruptBytes = retainedCorruptBytes.slice();
      const corruptedDecode = decode(retainedCorruptBytes);
      expect(corruptedDecode.error).toBeUndefined();
      // Recovery is decoder-specific. djpeg exits 0 on success, 1 on a
      // decoding error and 2 for warnings; adapters use the same exit contract.
      // Process launch errors, signals and unrelated exit codes remain failures.
      expect(corruptedDecode.signal).toBeNull();
      expect([0, 1, 2], corruptedDecode.stderr.toString()).toContain(
        corruptedDecode.status,
      );
      expect(retainedCorruptBytes).toEqual(expectedCorruptBytes);
      expect(cleanBytes).toEqual(original);
      expect(retainedCorruptBytes).not.toEqual(cleanBytes);
      expect(retainedCorruptBytes).toHaveLength(cleanBytes.byteLength);
      expect(
        cleanDecode.status,
        "The clean encoded bytes remain available",
      ).toBe(0);

      expect(history.canUndo).toBe(true);
      expect(history.commitUndo()).toBe(true);
      expect(history.activeStages).toEqual([]);
      const undoBytes = cleanBytes.slice();
      const undoDecode = decode(undoBytes);
      expect(undoDecode.error).toBeUndefined();
      expect(undoDecode.status, undoDecode.stderr.toString()).toBe(0);
      expect(undoBytes).toEqual(cleanBytes);
      expect(history.canRedo).toBe(true);
      expect(history.commitRedo()).toBe(true);
      const redoBytes = corruptEntropyScan(cleanBytes, history.activeStages);
      expect(redoBytes.ok).toBe(true);
      if (!redoBytes.ok) return;
      expect(redoBytes.value.bytes).toEqual(expectedCorruptBytes);
      expect(cleanBytes).toEqual(original);
      console.info(
        `Independent decoder: clean fixture decoded; Scan Corrupt seed ${corruption.seed} retained ${retainedCorruptBytes.byteLength} exact corrupted bytes; recovery exit status ${corruptedDecode.status}.`,
      );
    },
  );

  it("is deterministic, changes only bounded entropy bytes, and preserves the source", async () => {
    const source = await fixtureBytes();
    const original = source.slice();
    const inspection = expectInspected(source);
    const scan = inspection.scans[0]!;
    const changed = corruptEntropyScan(source, [baseParameters]);
    const repeated = corruptEntropyScan(source, [baseParameters]);

    expect(changed.ok).toBe(true);
    expect(repeated.ok).toBe(true);
    if (!changed.ok || !repeated.ok) return;
    expect(changed.value.bytes).toEqual(repeated.value.bytes);
    expect(changed.value.bytes.byteLength).toBe(source.byteLength);
    expect(source).toEqual(original);

    const report = changed.value.reports[0]!;
    expect(report.changedBytes).toBe(baseParameters.count);
    expect(report.changedBits).toBe(baseParameters.count);
    expect(report.scanStartOffset).toBe(scan.entropyRanges[0]!.startOffset);
    expect(report.scanEndOffset).toBe(scan.entropyRanges.at(-1)!.endOffset);
    for (let offset = 0; offset < source.byteLength; offset += 1) {
      if (source[offset] === changed.value.bytes[offset]) continue;
      expect(
        scan.entropyRanges.some(
          (range) => offset >= range.startOffset && offset < range.endOffset,
        ),
      ).toBe(true);
      expect(source[offset]).not.toBe(0xff);
      expect(source[offset - 1]).not.toBe(0xff);
    }
    expectInspected(changed.value.bytes);
  });

  it("replaces bytes without introducing marker boundaries and counts changed bits", async () => {
    const source = await fixtureBytes("synthetic-grayscale.jpg");
    const original = source.slice();
    const changed = corruptEntropyScan(source, [
      { ...baseParameters, mode: "byte-replacement", count: 3, seed: 8 },
    ]);

    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.value.bytes.byteLength).toBe(source.byteLength);
    expect(source).toEqual(original);
    expect(changed.value.reports[0]?.changedBytes).toBe(3);
    expect(changed.value.reports[0]?.changedBits).toBeGreaterThanOrEqual(3);
    expect(changed.value.reports[0]?.changedBits).toBeLessThanOrEqual(24);
    for (let offset = 0; offset < source.length; offset += 1) {
      if (source[offset] === changed.value.bytes[offset]) continue;
      expect(changed.value.bytes[offset]).not.toBe(0xff);
    }
    expectInspected(changed.value.bytes);
  });

  it("uses the selected normalized scan range and protects restart markers and stuffing", async () => {
    const source = await fixtureBytes("synthetic-color-420.jpg");
    const parsed = expectInspected(source);
    const sos = parsed.markers.find((marker) => marker.name === "SOS")!;
    const withRestartInterval = insertBytes(
      source,
      sos.startOffset,
      Uint8Array.of(0xff, 0xdd, 0x00, 0x04, 0x00, 0x01),
    );
    const parsedWithInterval = expectInspected(withRestartInterval);
    const scanStart = parsedWithInterval.scans[0]!.dataStartOffset;
    const withRestart = insertBytes(
      withRestartInterval,
      scanStart + 1,
      Uint8Array.of(0xff, 0xd0),
    );
    const withStuffing = insertBytes(
      withRestart,
      withRestart.length - 2,
      Uint8Array.of(0xff, 0x00),
    );
    const before = expectInspected(withStuffing);
    expect(before.scans[0]?.entropyRanges).toHaveLength(2);
    const changed = corruptEntropyScan(withStuffing, [
      { ...baseParameters, count: 1, rangeStart: 0.5, rangeEnd: 1 },
    ]);

    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.value.bytes.byteLength).toBe(withStuffing.byteLength);
    expectInspected(changed.value.bytes);
    for (const marker of before.markers.filter(
      (entry) => entry.kind === "restart",
    )) {
      expect(
        changed.value.bytes.subarray(marker.startOffset, marker.endOffset),
      ).toEqual(withStuffing.subarray(marker.startOffset, marker.endOffset));
    }
    for (let offset = 0; offset < withStuffing.length - 1; offset += 1) {
      if (withStuffing[offset] === 0xff && withStuffing[offset + 1] === 0x00) {
        expect(changed.value.bytes[offset]).toBe(0xff);
        expect(changed.value.bytes[offset + 1]).toBe(0x00);
      }
    }
    const report = changed.value.reports[0]!;
    const min =
      report.scanStartOffset +
      Math.floor(
        report.rangeStart * (report.scanEndOffset - report.scanStartOffset),
      );
    const max =
      report.scanStartOffset +
      Math.ceil(
        report.rangeEnd * (report.scanEndOffset - report.scanStartOffset),
      );
    for (let offset = 0; offset < withStuffing.length; offset += 1) {
      if (withStuffing[offset] === changed.value.bytes[offset]) continue;
      expect(offset).toBeGreaterThanOrEqual(min);
      expect(offset).toBeLessThan(max);
    }
  });

  it("replays stacked stages in order from a clean encoded buffer", async () => {
    const source = await fixtureBytes();
    const stages = [
      baseParameters,
      { ...baseParameters, mode: "byte-replacement" as const, seed: 77 },
    ];
    const first = corruptEntropyScan(source, stages);
    const second = corruptEntropyScan(source, stages);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.reports).toHaveLength(2);
    expect(first.value.bytes).toEqual(second.value.bytes);
    expect(first.value.reports.map(({ seed }) => seed)).toEqual([12, 77]);
    expectInspected(first.value.bytes);
  });

  it.each(golden.cases)(
    "matches legacy bytes and reports: $fixture, $stages.length stages",
    async ({ fixture, stages, bytesBase64, reports }) => {
      const source = await fixtureBytes(fixture);
      const original = source.slice();
      expect(
        stages.every(
          (stage) =>
            stage.mode === "bit-flip" || stage.mode === "byte-replacement",
        ),
      ).toBe(true);
      const result = corruptEntropyScan(
        source,
        stages as ScanCorruptionParameters[],
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.bytes).toEqual(
        new Uint8Array(Buffer.from(bytesBase64, "base64")),
      );
      expect(result.value.reports).toEqual(reports);
      expect(source).toEqual(original);
    },
  );

  it("does not publish partial mutations when a later stage has too few eligible bytes", async () => {
    const source = await fixtureBytes();
    const original = source.slice();
    const result = corruptEntropyScan(source, [
      baseParameters,
      {
        ...baseParameters,
        count: 256,
        rangeStart: 0.99,
      },
    ]);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    expect(result).not.toHaveProperty("value");
    expect(source).toEqual(original);
    expect(corruptEntropyScan(source, [baseParameters])).toEqual(
      corruptEntropyScan(original, [baseParameters]),
    );
  });

  it("rejects malformed, trailing, unsupported, or invalid corruption requests", async () => {
    const source = await fixtureBytes();
    const truncated = source.subarray(0, source.byteLength - 2);
    const trailing = new Uint8Array([...source, 0x00]);
    const invalidCases: unknown[] = [
      { ...baseParameters, count: 0 },
      { ...baseParameters, count: MAX_SCAN_CORRUPTION_BYTES + 1 },
      { ...baseParameters, rangeStart: Number.NaN },
      { ...baseParameters, rangeStart: 0.8, rangeEnd: 0.2 },
      { ...baseParameters, seed: -1 },
      { ...baseParameters, seed: 0x1_0000_0000 },
    ];

    expect(corruptEntropyScan(truncated, [baseParameters]).ok).toBe(false);
    expect(corruptEntropyScan(trailing, [baseParameters]).ok).toBe(false);
    for (const parameters of invalidCases) {
      expect(
        corruptEntropyScan(source, [parameters as ScanCorruptionParameters]).ok,
      ).toBe(false);
    }
    expect(
      corruptEntropyScan(
        source,
        Array.from(
          { length: MAX_SCAN_CORRUPTION_STAGES + 1 },
          () => baseParameters,
        ),
      ).ok,
    ).toBe(false);
    expect(corruptEntropyScan(source, []).ok).toBe(false);
  });
});
