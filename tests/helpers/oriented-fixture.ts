import { readFile } from "node:fs/promises";

export async function fixtureWithExif(
  orientation: number,
  littleEndian = true,
): Promise<Uint8Array<ArrayBuffer>> {
  const source = await readFile(
    new URL("../fixtures/synthetic-color-odd-420.jpg", import.meta.url),
  );
  const exif = new Uint8Array(36);
  exif.set([0xff, 0xe1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  const tiff = new DataView(exif.buffer, 10);
  tiff.setUint16(0, littleEndian ? 0x4949 : 0x4d4d);
  tiff.setUint16(2, 42, littleEndian);
  tiff.setUint32(4, 8, littleEndian);
  tiff.setUint16(8, 1, littleEndian);
  tiff.setUint16(10, 0x0112, littleEndian);
  tiff.setUint16(12, 3, littleEndian);
  tiff.setUint32(14, 1, littleEndian);
  tiff.setUint16(18, orientation, littleEndian);
  const output = new Uint8Array(source.length + exif.length);
  output.set(source.subarray(0, 2));
  output.set(exif, 2);
  output.set(source.subarray(2), 2 + exif.length);
  return output;
}
