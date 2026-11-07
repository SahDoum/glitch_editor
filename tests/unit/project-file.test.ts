import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  createJgeProjectFile,
  JGE_PROJECT_FORMAT,
  JGE_PROJECT_SCHEMA_VERSION,
  readJgeProjectText,
} from "../../src/project/project-file";
import { createBrushMask } from "../../src/document/masks";

async function loadFixture(): Promise<Uint8Array> {
  return new Uint8Array(
    await readFile(
      new URL("../fixtures/synthetic-grayscale.jpg", import.meta.url),
    ),
  );
}

async function digestBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
}

describe("project file persistence", () => {
  it("embeds and restores the exact original JPEG bytes and operation data", async () => {
    const bytes = await loadFixture();
    const draftMask = createBrushMask([{ x: 4, y: 4 }], 3, 16, 16);
    if (!draftMask.ok) throw new Error(draftMask.error.message);
    const digest = await digestBytes(bytes);
    const sha256 = Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const operation = {
      id: "operation-1",
      type: "jpeg/glitch/coefficients",
      version: 1,
      parameters: {
        kind: "coefficients",
        seed: 42,
        mask: null,
      },
      enabled: false,
      inputRevision: 3,
      status: "queued" as const,
      seed: 42,
    };

    const serialized = await createJgeProjectFile(
      {
        source: { fileName: "original.jpg", sha256, bytes },
        operations: [operation],
        draftMask: draftMask.value,
        scanCorruptionStages: [],
      },
      { application: "0.1.0", codec: "libjpeg-turbo 3.2.0" },
    );
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;

    const project = await readJgeProjectText(await serialized.value.text());
    expect(project.ok).toBe(true);
    if (!project.ok) return;
    expect(project.value.source.fileName).toBe("original.jpg");
    expect(project.value.source.sha256).toBe(sha256);
    expect(project.value.source.bytes).toEqual(bytes);
    expect(project.value.operations).toEqual([operation]);
    expect(project.value.draftMask).toEqual(draftMask.value);
    expect(project.value.applicationVersion).toBe("0.1.0");
    expect(project.value.codecVersion).toBe("libjpeg-turbo 3.2.0");
  });

  it("rejects a project whose embedded JPEG fails the integrity check", async () => {
    const bytes = await loadFixture();
    const digest = await digestBytes(bytes);
    const sha256 = Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const saved = await createJgeProjectFile(
      {
        source: { fileName: "source.jpg", sha256, bytes },
        operations: [],
        draftMask: null,
        scanCorruptionStages: [],
      },
      { application: "0.1.0", codec: "libjpeg-turbo 3.2.0" },
    );
    if (!saved.ok) throw new Error(saved.error.message);

    const payload: unknown = JSON.parse(await saved.value.text());
    if (typeof payload !== "object" || payload === null) {
      throw new Error("Expected project JSON.");
    }
    const source = Reflect.get(payload, "source");
    if (typeof source !== "object" || source === null) {
      throw new Error("Expected embedded source data.");
    }
    const tampered = JSON.stringify(payload).replace(
      /"sha256":"[\da-f]{64}"/,
      `"sha256":"${"0".repeat(64)}"`,
    );

    expect(await readJgeProjectText(tampered)).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });

  it("rejects malformed embedded Base64 before decoding the source", async () => {
    const bytes = await loadFixture();
    const digest = await digestBytes(bytes);
    const sha256 = Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const saved = await createJgeProjectFile(
      {
        source: { fileName: "source.jpg", sha256, bytes },
        operations: [],
        draftMask: null,
        scanCorruptionStages: [],
      },
      { application: "0.1.0", codec: "libjpeg-turbo 3.2.0" },
    );
    if (!saved.ok) throw new Error(saved.error.message);

    const payload: unknown = JSON.parse(await saved.value.text());
    if (typeof payload !== "object" || payload === null) {
      throw new Error("Expected project JSON.");
    }
    const source = Reflect.get(payload, "source");
    if (typeof source !== "object" || source === null) {
      throw new Error("Expected embedded source data.");
    }
    const encoded = Reflect.get(source, "jpegBase64");
    if (typeof encoded !== "string" || encoded.length === 0) {
      throw new Error("Expected embedded JPEG data.");
    }
    Reflect.set(source, "jpegBase64", `!${encoded.slice(1)}`);

    expect(await readJgeProjectText(JSON.stringify(payload))).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });

  it("rejects large malformed Base64 without overflowing", async () => {
    const byteLength = 6 * 1024 * 1024;
    const encodedLength = Math.ceil(byteLength / 3) * 4;
    const jpegBase64 = `${"A".repeat(encodedLength - 1)}!`;
    const serialized = JSON.stringify({
      format: JGE_PROJECT_FORMAT,
      schemaVersion: JGE_PROJECT_SCHEMA_VERSION,
      applicationVersion: "0.1.0",
      codecVersion: "libjpeg-turbo 3.2.0",
      source: {
        fileName: "large-source.jpg",
        sha256: "0".repeat(64),
        byteLength,
        jpegBase64,
      },
      operations: [],
      draftMask: null,
      scanCorruptionStages: [],
    });

    expect(await readJgeProjectText(serialized)).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });

  it("rejects unsupported schemas and unsafe embedded filenames", async () => {
    const unsupported = await readJgeProjectText(
      JSON.stringify({
        format: JGE_PROJECT_FORMAT,
        schemaVersion: JGE_PROJECT_SCHEMA_VERSION + 1,
      }),
    );
    expect(unsupported).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_FORMAT" },
    });

    const bytes = await loadFixture();
    const digest = await digestBytes(bytes);
    const sha256 = Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    expect(
      await createJgeProjectFile(
        {
          source: { fileName: "../source.jpg", sha256, bytes },
          operations: [],
          draftMask: null,
          scanCorruptionStages: [],
        },
        { application: "0.1.0", codec: "libjpeg-turbo 3.2.0" },
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });
});
