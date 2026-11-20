import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createJgeProjectFile,
  JGE_PROJECT_FORMAT,
  MAX_PROJECT_FILE_BYTES,
  JGE_PROJECT_SCHEMA_VERSION,
  readJgeProjectText,
} from "../../src/project/project-file";
import {
  createJpegDocumentSession,
  applyCoefficientGlitchOperation,
} from "../../src/application/jpeg-document";
import { OriginalAsset } from "../../src/document/model";
import { inspectJpeg } from "../../src/jpeg/inspect";
import { projectEditsKey } from "../../src/project/project-edits";
import {
  createBrushMaskFromStrokes,
  createFullImageMask,
} from "../../src/document/masks";

import { getOperationController } from "../../src/jpeg/codec-controllers/registry";
import type { JpegGlitchOperation } from "../../src/operations/jpeg-glitch";
import { encodeOpened, withOpenCodec } from "../helpers/codec-harness";

async function encodePlan(
  bytes: Uint8Array,
  operations: readonly JpegGlitchOperation[],
): Promise<Uint8Array> {
  const inspection = inspectJpeg(bytes);
  if (!inspection.ok) throw new Error("fixture");
  const result = await withOpenCodec(bytes, (session) => {
    for (const operation of operations) {
      const applied = getOperationController(operation.kind)!.apply(
        session.codec,
        operation,
        inspection.value,
      );
      if (!applied.ok || applied.value !== 0)
        throw new Error("Operation replay failed");
    }
    return encodeOpened(session, "baseline");
  });
  if (result.status !== 0 || !result.value) throw new Error("Encoding failed");
  return result.value;
}

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

afterEach(() => vi.restoreAllMocks());

describe("project file persistence", () => {
  it("compares working areas by geometry and tracks edits and damage", () => {
    const first = createFullImageMask(16, 16);
    const equivalent = createFullImageMask(16, 16);
    if (!first.ok || !equivalent.ok) throw new Error("Expected masks");
    expect(first.value.id).not.toEqual(equivalent.value.id);
    const clean = {
      operations: [],
      draftMask: first.value,
      scanCorruptionStages: [],
    };
    expect(projectEditsKey(clean)).toEqual(
      projectEditsKey({ ...clean, draftMask: equivalent.value }),
    );
    expect(projectEditsKey(clean)).not.toEqual(
      projectEditsKey({ ...clean, draftMask: null }),
    );
    expect(projectEditsKey(clean)).not.toEqual(
      projectEditsKey({
        ...clean,
        scanCorruptionStages: [
          { mode: "bit-flip", seed: 1, count: 1, rangeStart: 0, rangeEnd: 1 },
        ],
      }),
    );
  });

  it("round-trips scan corruption without coefficient operations", async () => {
    const bytes = await loadFixture();
    const digest = await digestBytes(bytes);
    const sha256 = Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const stages = [
      {
        mode: "bit-flip" as const,
        count: 4,
        rangeStart: 0,
        rangeEnd: 1,
        seed: 1,
      },
    ];
    const saved = await createJgeProjectFile(
      {
        source: { fileName: "source.jpg", sha256, bytes },
        operations: [],
        draftMask: null,
        scanCorruptionStages: stages,
      },
      { application: "0.1.0", codec: "libjpeg-turbo 3.2.0" },
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const loaded = await readJgeProjectText(await saved.value.text());
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.source.bytes).toEqual(bytes);
    expect(loaded.value.operations).toEqual([]);
    expect(loaded.value.scanCorruptionStages).toEqual(stages);
  });

  it("embeds and restores the exact original JPEG bytes and operation data", async () => {
    const bytes = await loadFixture();
    const draftMask = createBrushMaskFromStrokes(
      [[{ x: 2, y: 2 }], [{ x: 6, y: 6 }]],
      1,
      8,
      8,
    );
    if (!draftMask.ok) throw new Error(draftMask.error.message);
    const digest = await digestBytes(bytes);
    const sha256 = Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const inspection = inspectJpeg(bytes);
    const asset = OriginalAsset.create({
      fileName: "original.jpg",
      sha256,
      bytes,
    });
    if (!inspection.ok || !asset.ok) throw new Error("fixture");
    const session = createJpegDocumentSession({
      originalAsset: asset.value,
      inspection: inspection.value,
    });
    if (!session.ok) throw new Error("session");
    const applied = applyCoefficientGlitchOperation(session.value, {
      kind: "coefficients",
      componentIndex: 0,
      domain: "ac",
      mode: "invert",
      frequencyBand: "all",
      strength: 0,
      seed: 42,
      mask: draftMask.value,
    });
    if (!applied.ok) throw new Error(applied.error.message);
    const operation = { ...applied.value.operations[0]!, enabled: false };

    const enabledOperation = {
      ...applied.value.operations[0]!,
      id: "enabled-operation",
    };
    const stages = [
      {
        mode: "bit-flip" as const,
        count: 1,
        seed: 7,
        rangeStart: 0,
        rangeEnd: 1,
      },
    ];
    const serialized = await createJgeProjectFile(
      {
        source: { fileName: "original.jpg", sha256, bytes },
        operations: [operation, enabledOperation],
        draftMask: draftMask.value,
        scanCorruptionStages: stages,
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
    expect(project.value.operations).toEqual([operation, enabledOperation]);
    expect(project.value.scanCorruptionStages).toEqual(stages);
    const reopened = createJpegDocumentSession({
      originalAsset: asset.value,
      inspection: inspection.value,
    });
    if (!reopened.ok) throw new Error("reopen session");
    expect(reopened.value.restoreOperations(project.value.operations).ok).toBe(
      true,
    );
    expect(reopened.value.snapshot.currentState.jpegOperations).toHaveLength(1);
    expect(
      await encodePlan(
        bytes,
        reopened.value.snapshot.currentState.jpegOperations,
      ),
    ).toEqual(
      await encodePlan(bytes, applied.value.currentState.jpegOperations),
    );
    expect(reopened.value.setEnabled(operation.id, true).ok).toBe(true);
    expect(reopened.value.snapshot.currentState.jpegOperations).toEqual([
      ...applied.value.currentState.jpegOperations,
      ...applied.value.currentState.jpegOperations,
    ]);
    expect(reopened.value.snapshot.originalAsset.readBytes()).toEqual(bytes);
    expect(project.value.draftMask).toEqual(draftMask.value);
    expect(project.value.applicationVersion).toBe("0.1.0");
    expect(project.value.codecVersion).toBe("libjpeg-turbo 3.2.0");

    const raw = JSON.parse(await serialized.value.text());
    expect(raw.schemaVersion).toBe(JGE_PROJECT_SCHEMA_VERSION);
    expect(raw.draftMask.shapes).toHaveLength(1);
    expect(
      await readJgeProjectText(JSON.stringify({ ...raw, schemaVersion: 1 })),
    ).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_FORMAT" },
    });
    expect(
      await readJgeProjectText(
        JSON.stringify({
          ...raw,
          operations: [{ ...operation, type: "jpeg/glitch/coefficients" }],
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(
      await readJgeProjectText(
        JSON.stringify({
          ...raw,
          operations: [{ ...operation, type: "block-shift" }],
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
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

  it("rejects malformed current-version operations, including disabled entries", async () => {
    const bytes = await loadFixture();
    const sha256 = Buffer.from(await digestBytes(bytes)).toString("hex");
    const saved = await createJgeProjectFile(
      {
        source: { fileName: "source.jpg", sha256, bytes },
        operations: [],
        draftMask: null,
        scanCorruptionStages: [],
      },
      { application: "0.1.0", codec: "codec" },
    );
    if (!saved.ok) throw new Error(saved.error.message);
    const payload = JSON.parse(await saved.value.text());
    payload.operations = [
      {
        id: "disabled",
        type: "coefficients",
        version: 1,
        enabled: false,
        inputRevision: 0,
        status: "applied",
        parameters: { kind: "coefficients", mask: null, seed: 42 },
      },
    ];
    expect(await readJgeProjectText(JSON.stringify(payload))).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    expect(
      await createJgeProjectFile(
        {
          source: { fileName: "source.jpg", sha256, bytes },
          operations: payload.operations,
          draftMask: null,
          scanCorruptionStages: [],
        },
        { application: "0.1.0", codec: "codec" },
      ),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  it("uses the same UTF-8 byte limit for text reads and writes", async () => {
    const metadata = "я".repeat(Math.floor(MAX_PROJECT_FILE_BYTES / 2) + 1);
    expect(metadata.length).toBeLessThan(MAX_PROJECT_FILE_BYTES);
    expect(await readJgeProjectText(metadata)).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message:
          "The project file is empty or exceeds the supported size limit.",
      },
    });
    const bytes = await loadFixture();
    const inspection = inspectJpeg(bytes);
    if (!inspection.ok) throw new Error("fixture");
    const mask = createFullImageMask(
      inspection.value.width,
      inspection.value.height,
    );
    if (!mask.ok) throw new Error("mask");
    expect(
      await createJgeProjectFile(
        {
          source: { fileName: "фото.jpg", sha256: "a".repeat(64), bytes },
          operations: [
            {
              id: "one",
              type: "coefficients",
              version: 1,
              enabled: false,
              inputRevision: 0,
              status: "applied",
              parameters: {
                kind: "coefficients",
                componentIndex: 0,
                mask: {
                  ...mask.value,
                  shapes: mask.value.shapes.map((shape) => ({ ...shape })),
                },
                domain: "ac",
                mode: "zero",
                frequencyBand: "all",
                strength: 0,
                seed: 1,
              },
              diagnostics: [metadata],
            },
          ],
          draftMask: null,
          scanCorruptionStages: [],
        },
        { application: "0.1.0", codec: "codec" },
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "The project file exceeds the supported size limit.",
      },
    });
  });

  it("uses feature-detected native Base64 without changing project bytes", async () => {
    const encode = vi.fn(function (this: Uint8Array) {
      return Buffer.from(this).toString("base64");
    });
    const decode = vi.fn(
      (value: string) => new Uint8Array(Buffer.from(value, "base64")),
    );
    Object.defineProperty(Uint8Array.prototype, "toBase64", {
      value: encode,
      configurable: true,
    });
    Object.defineProperty(Uint8Array, "fromBase64", {
      value: decode,
      configurable: true,
    });
    try {
      const bytes = await loadFixture();
      const sha256 = Buffer.from(await digestBytes(bytes)).toString("hex");
      const saved = await createJgeProjectFile(
        {
          source: { fileName: "фото.jpg", sha256, bytes },
          operations: [],
          draftMask: null,
          scanCorruptionStages: [],
        },
        { application: "0.1.0", codec: "codec" },
      );
      if (!saved.ok) throw new Error(saved.error.message);
      const loaded = await readJgeProjectText(await saved.value.text());
      expect(loaded).toMatchObject({
        ok: true,
        value: { source: { bytes, fileName: "фото.jpg" } },
      });
      expect(encode).toHaveBeenCalled();
      expect(decode).toHaveBeenCalledWith(expect.any(String), {
        lastChunkHandling: "strict",
      });
    } finally {
      Reflect.deleteProperty(Uint8Array.prototype, "toBase64");
      Reflect.deleteProperty(Uint8Array, "fromBase64");
    }
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
