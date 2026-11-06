import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { inspectJpeg } from "../../src/jpeg/inspect";
import {
  corruptEntropyScan,
  MAX_SCAN_CORRUPTION_BYTES,
  MAX_SCAN_CORRUPTION_STAGES,
  type ScanCorruptionParameters,
} from "../../src/jpeg/scan-corruption";

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
