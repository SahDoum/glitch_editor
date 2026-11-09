import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  previewDimensions,
  previewOrientationTransform,
  previewPointToFrame,
  readJpegOrientation,
} from "../../src/application/preview-orientation";
import { inspectJpeg } from "../../src/jpeg/inspect";
import { encodeOpened, withOpenCodec } from "../helpers/codec-harness";
import { fixtureWithExif } from "../helpers/oriented-fixture";

function orientationOf(bytes: Uint8Array) {
  const inspection = inspectJpeg(bytes);
  expect(inspection.ok).toBe(true);
  if (!inspection.ok) throw new Error(inspection.error.message);
  return readJpegOrientation(bytes, inspection.value);
}

describe("JPEG preview orientation", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8] as const)(
    "reads orientation %i in either TIFF byte order",
    async (orientation) => {
      for (const littleEndian of [true, false]) {
        expect(
          orientationOf(await fixtureWithExif(orientation, littleEndian)),
        ).toEqual({ ok: true, value: orientation });
      }
    },
  );

  it("uses the frame orientation when EXIF is absent", async () => {
    const bytes = await readFile(
      new URL("../fixtures/synthetic-color-odd-420.jpg", import.meta.url),
    );
    expect(orientationOf(bytes)).toEqual({ ok: true, value: 1 });
  });

  it("rejects malformed or ambiguous EXIF instead of guessing coordinates", async () => {
    const invalidValue = await fixtureWithExif(9);
    expect(orientationOf(invalidValue)).toMatchObject({
      ok: false,
      error: { code: "MALFORMED_JPEG" },
    });
    const truncatedIfd = await fixtureWithExif(6);
    truncatedIfd[20] = 0xff;
    expect(orientationOf(truncatedIfd)).toMatchObject({ ok: false });
    const wrongType = await fixtureWithExif(6);
    wrongType[24] = 4;
    expect(orientationOf(wrongType)).toMatchObject({ ok: false });
    const twice = await fixtureWithExif(6);
    const duplicate = new Uint8Array(twice.length + 36);
    duplicate.set(twice.subarray(0, 38));
    duplicate.set(twice.subarray(2, 38), 38);
    duplicate.set(twice.subarray(38), 74);
    expect(orientationOf(duplicate)).toMatchObject({ ok: false });
  });

  it.each([
    [1, [2, 3], [17, 9]],
    [2, [15, 3], [17, 9]],
    [3, [15, 6], [17, 9]],
    [4, [2, 6], [17, 9]],
    [5, [3, 2], [9, 17]],
    [6, [6, 2], [9, 17]],
    [7, [6, 15], [9, 17]],
    [8, [3, 15], [9, 17]],
  ] as const)(
    "maps orientation %i overlays and pointer back to the same frame point",
    (orientation, displayPoint, dimensions) => {
      const expected = previewDimensions({ width: 17, height: 9 }, orientation);
      expect([expected.width, expected.height]).toEqual(dimensions);
      expect(
        previewPointToFrame(
          displayPoint[0],
          displayPoint[1],
          17,
          9,
          orientation,
        ),
      ).toEqual({
        x: 2,
        y: 3,
      });
      const values = previewOrientationTransform(17, 9, orientation)
        .slice(7, -1)
        .split(" ")
        .map(Number);
      const [a, b, c, d, e, f] = values as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      expect([a * 2 + c * 3 + e, b * 2 + d * 3 + f]).toEqual(displayPoint);
    },
  );

  it.each(["baseline", "progressive"] as const)(
    "preserves orientation through %s coefficient encoding",
    async (mode) => {
      const source = await fixtureWithExif(6);
      const encoded = await withOpenCodec(source, (session) =>
        encodeOpened(session, mode),
      );
      expect(encoded.status).toBe(0);
      expect(orientationOf(encoded.value!)).toEqual({ ok: true, value: 6 });
    },
  );
});
