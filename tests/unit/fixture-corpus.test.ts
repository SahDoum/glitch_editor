import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import manifest from "../fixtures/manifest.json";

describe("synthetic JPEG fixture corpus", () => {
  it("documents the provenance and license of each fixture", () => {
    expect(manifest.license).toBe("CC0-1.0");
    expect(manifest.provenance).toContain("No photographs");
    expect(manifest.fixtures).toHaveLength(2);
  });

  it.each(manifest.fixtures)("$file matches its manifest", async (fixture) => {
    const bytes = await readFile(
      new URL(`../fixtures/${fixture.file}`, import.meta.url),
    );

    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(bytes.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      fixture.sha256,
    );
  });
});
