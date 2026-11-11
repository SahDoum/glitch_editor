import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createFullImageMask } from "../../src/document/masks";
import { OriginalAsset } from "../../src/document/model";
import { createJpegDocumentSession } from "../../src/application/jpeg-document";
import { getJpegOperationEffect } from "../../src/features/effects/registry";
import { inspectJpeg } from "../../src/jpeg/inspect";
import {
  createJgeProjectFile,
  readJgeProjectText,
} from "../../src/project/project-file";
import {
  encodeOpened,
  readCoefficients,
  withOpenCodec,
} from "../helpers/codec-harness";
import { isCoefficientWorkerRequest } from "../../src/jpeg/coefficient-worker-protocol";
import type { CodecCommandModule } from "../../src/jpeg/codec-controllers/controller";
import {
  getOperationController,
  isOperationList,
} from "../../src/jpeg/codec-controllers/registry";
import type { JpegBlockGeometry } from "../../src/jpeg/block-geometry";
import type { JpegGlitchOperation } from "../../src/operations/jpeg-glitch";

const geometry: JpegBlockGeometry = {
  width: 16,
  height: 16,
  components: [
    {
      id: 1,
      horizontalSampling: 1,
      verticalSampling: 1,
      quantizationTable: 0,
    },
  ],
};

function createOperations(): JpegGlitchOperation[] {
  const mask = createFullImageMask(16, 16);
  if (!mask.ok) throw new Error("Could not create fixture mask.");
  return [
    {
      kind: "coefficients",
      mask: mask.value,
      componentIndex: 0,
      domain: "ac",
      mode: "zero",
      frequencyBand: "all",
      strength: 0,
      seed: 1,
    },
    {
      kind: "block-repeat",
      componentIndex: 0,
      sourceX: 0,
      sourceY: 0,
      offsetX: 1,
      offsetY: 0,
      repetitions: 1,
    },
    {
      kind: "block-permutation",
      componentIndex: 0,
      mask: mask.value,
      seed: 9,
    },
    {
      kind: "block-shift",
      componentIndex: 0,
      mask: mask.value,
      offsetX: 0,
      offsetY: 1,
    },
    {
      kind: "block-transfer",
      componentIndex: 0,
      sourceX: 0,
      sourceY: 0,
      width: 1,
      height: 1,
      destinationX: 1,
      destinationY: 0,
      mode: "all",
      action: "copy",
    },
    {
      kind: "quantization",
      tableId: 0,
      values: Array.from({ length: 64 }, () => 10),
      semantics: "reinterpret",
      pattern: "manual",
      seed: 1,
    },
  ];
}

function createCodecMock() {
  return {
    HEAPU8: new Uint8Array(256),
    _malloc: vi.fn(() => 8),
    _free: vi.fn(),
    _coefficient_apply: vi.fn(() => 0),
    _coefficient_repeat_block: vi.fn(() => 0),
    _coefficient_permute_blocks: vi.fn(() => 0),
    _coefficient_shift_blocks: vi.fn(() => 0),
    _coefficient_transfer_blocks: vi.fn(() => 0),
    _coefficient_set_quantization: vi.fn(() => 0),
  } satisfies CodecCommandModule;
}

describe("JPEG operation controllers", () => {
  it("accepts each operation after structured cloning", () => {
    const operations = structuredClone(createOperations());
    expect(isOperationList(operations, geometry)).toBe(true);
    expect(operations.map(({ kind }) => kind)).toEqual([
      "coefficients",
      "block-repeat",
      "block-permutation",
      "block-shift",
      "block-transfer",
      "quantization",
    ]);
  });

  it("applies each operation using its registered controller", () => {
    const operations = structuredClone(createOperations());
    const codec = createCodecMock();
    for (const operation of operations) {
      expect(
        getOperationController(operation.kind)?.apply(
          codec,
          operation,
          geometry,
        ),
      ).toEqual({
        ok: true,
        value: 0,
      });
    }

    expect(codec._coefficient_apply).toHaveBeenCalledOnce();
    expect(codec._coefficient_repeat_block).toHaveBeenCalledOnce();
    expect(codec._coefficient_permute_blocks).toHaveBeenCalledOnce();
    expect(codec._coefficient_shift_blocks).toHaveBeenCalledOnce();
    expect(codec._coefficient_transfer_blocks).toHaveBeenCalledOnce();
    expect(codec._coefficient_set_quantization).toHaveBeenCalledOnce();
    expect(codec._coefficient_apply).toHaveBeenCalledWith(
      0,
      0,
      0,
      3,
      8,
      4,
      0,
      1,
    );
    expect(codec._coefficient_repeat_block).toHaveBeenCalledWith(
      0,
      0,
      0,
      1,
      0,
      1,
    );
    expect(codec._coefficient_permute_blocks).toHaveBeenCalledWith(0, 8, 4, 9);
    expect(codec._coefficient_shift_blocks).toHaveBeenCalledWith(0, 8, 4, 0, 1);
    expect(codec._coefficient_transfer_blocks).toHaveBeenCalledWith(
      0,
      0,
      0,
      1,
      1,
      1,
      0,
      0,
      0,
    );
    expect(codec._coefficient_set_quantization).toHaveBeenCalledWith(
      0,
      0,
      8,
      64,
    );
    expect(codec._malloc).toHaveBeenCalledTimes(4);
    expect(codec._free).toHaveBeenCalledTimes(4);
  });

  it("rejects a mask that does not match the JPEG image dimensions", () => {
    const mask = createFullImageMask(8, 8);
    if (!mask.ok) throw new Error("Could not create fixture mask.");
    const result = isOperationList(
      [
        {
          kind: "coefficients",
          mask: mask.value,
          componentIndex: 0,
          domain: "ac",
          mode: "zero",
          frequencyBand: "all",
          strength: 0,
          seed: 1,
        },
      ],
      geometry,
    );

    expect(result).toBe(false);
  });

  it("uses each controller's validator to reject malformed commands", () => {
    expect(
      isOperationList(
        [
          {
            kind: "block-repeat",
            componentIndex: 0,
            sourceX: 0,
            sourceY: 0,
            offsetX: 0,
            offsetY: 0,
            repetitions: 1,
          },
        ],
        geometry,
      ),
    ).toBe(false);
    expect(
      isOperationList(
        [
          {
            kind: "quantization",
            tableId: 0,
            semantics: 0,
            values: new Uint8Array(64),
          },
        ],
        geometry,
      ),
    ).toBe(false);
    expect(
      isOperationList(
        [
          {
            kind: "block-transfer",
            componentIndex: 0,
            sourceX: 0,
            sourceY: 0,
            width: 1,
            height: 1,
            destinationX: 1,
            destinationY: 0,
            mode: 0,
            action: 2,
          },
        ],
        geometry,
      ),
    ).toBe(false);
  });

  it("rejects unknown kinds, invalid values and excess work", () => {
    const operations = createOperations();
    expect(isOperationList([{ kind: "unknown" }], geometry)).toBe(false);
    expect(
      isOperationList(
        Array.from({ length: 257 }, () => operations[0]),
        geometry,
      ),
    ).toBe(false);
    const largeGeometry = { ...geometry, width: 6320, height: 6320 };
    const largeMask = createFullImageMask(6320, 6320);
    if (!largeMask.ok) throw new Error("mask");
    const coefficient = operations[0];
    if (!coefficient || coefficient.kind !== "coefficients")
      throw new Error("operation");
    expect(
      isOperationList(
        Array.from({ length: 14 }, () => ({
          ...coefficient,
          mask: largeMask.value,
        })),
        largeGeometry,
      ),
    ).toBe(false);
    expect(
      isOperationList(
        [{ ...coefficient, mode: "randomize", strength: 1.5 }],
        geometry,
      ),
    ).toBe(false);
    const quantization = operations[5];
    if (!quantization || quantization.kind !== "quantization")
      throw new Error("operation");
    expect(
      isOperationList(
        [{ ...quantization, values: Array(64).fill(256) }],
        geometry,
      ),
    ).toBe(false);
    expect(
      isOperationList([{ ...quantization, values: Array(64) }], geometry),
    ).toBe(false);
  });

  it("rejects malformed worker messages and validates operation data", () => {
    const request = {
      id: 1,
      type: "encode",
      bytes: new ArrayBuffer(16),
      geometry,
      operations: createOperations(),
      options: { mode: "baseline" },
    };
    expect(isCoefficientWorkerRequest(structuredClone(request))).toBe(true);
    expect(
      isCoefficientWorkerRequest({
        ...request,
        operations: [{ kind: "unknown" }],
      }),
    ).toBe(false);
    expect(
      isCoefficientWorkerRequest({
        ...request,
        operations: undefined,
        commands: [],
      }),
    ).toBe(false);
    expect(
      isCoefficientWorkerRequest({ ...request, bytes: new ArrayBuffer(0) }),
    ).toBe(false);
    expect(
      isCoefficientWorkerRequest({
        ...request,
        geometry: { ...geometry, width: 0 },
      }),
    ).toBe(false);
    expect(
      isCoefficientWorkerRequest({ ...request, options: { mode: "other" } }),
    ).toBe(false);
  });

  it("frees WASM memory if the codec throws or the allocation is out of bounds", () => {
    const operation = createOperations()[0]!;
    const controller = getOperationController(operation.kind)!;
    const codec = createCodecMock();
    codec._coefficient_apply.mockImplementation(() => {
      throw new Error("codec failure");
    });
    expect(() => controller.apply(codec, operation, geometry)).toThrow(
      "codec failure",
    );
    expect(codec._free).toHaveBeenCalledWith(8);
    codec._malloc.mockReturnValue(255);
    expect(controller.apply(codec, operation, geometry).ok).toBe(false);
    expect(codec._free).toHaveBeenCalledWith(255);
  });

  it("records every kind through its effect, reopens a project and executes cloned operations", async () => {
    const bytes = new Uint8Array(
      await readFile(
        new URL("../fixtures/synthetic-color-444.jpg", import.meta.url),
      ),
    );
    const sha256 =
      "81927288fce7c7ee581a88cb39265628bdc6b23473291945b15a48f363c548fc";
    const asset = OriginalAsset.create({
      fileName: "fixture.jpg",
      sha256,
      bytes,
    });
    const inspected = inspectJpeg(bytes);
    if (!asset.ok || !inspected.ok) throw new Error("fixture");
    const imported = {
      originalAsset: asset.value,
      inspection: inspected.value,
      previewUrl: "blob:test",
    };
    const session = createJpegDocumentSession(imported);
    if (!session.ok) throw new Error("session");
    const operations = createOperations();
    const effectIds = [
      "pixelate",
      "block-repeat",
      "block-shuffle",
      "local-shift",
      "block-transfer",
      "quantization",
    ];
    const patches: readonly object[] = [
      {},
      {
        count: 1,
        source: { x: 0, y: 0, width: 1, height: 1 },
        destination: { x: 1, y: 0 },
      },
      { seed: 9 },
      { x: 0, y: 1 },
      {
        source: { x: 0, y: 0, width: 1, height: 1 },
        destination: { x: 1, y: 0 },
        mode: "all",
        action: "copy",
      },
      {
        tableId: 0,
        values: Array(64).fill(10),
        semantics: "reinterpret",
        pattern: "manual",
        seed: 1,
      },
    ];
    const mask = createFullImageMask(16, 16);
    if (!mask.ok) throw new Error("mask");
    for (const [index, operation] of operations.entries()) {
      const effect = getJpegOperationEffect(effectIds[index]!)!;
      expect(effect.controller.operation.kind).toBe(operation.kind);
      const context = {
        settings: { ...effect.view.defaultSettings, ...patches[index] },
        inspection: inspected.value,
        componentIndex: 0,
        mask: mask.value,
      };
      const preview = effect.controller.buildOperation(context);
      const applied = effect.controller.buildOperation(context);
      if (!preview.ok || !applied.ok)
        throw new Error(`Could not build ${effectIds[index]}`);
      expect(preview.value).toEqual(applied.value);
      expect(
        effect.controller.apply(session.value, applied.value, inspected.value)
          .ok,
      ).toBe(true);
      expect(session.value.snapshot.operations[index]?.type).toBe(
        operation.kind,
      );
      expect(session.value.snapshot.currentState.jpegOperations[index]).toEqual(
        preview.value,
      );
    }
    expect(session.value.undo().ok).toBe(true);
    expect(session.value.redo().ok).toBe(true);
    const saved = await createJgeProjectFile(
      {
        source: {
          fileName: "fixture.jpg",
          sha256,
          bytes: asset.value.readBytes(),
        },
        operations: session.value.snapshot.operations,
        draftMask: null,
        scanCorruptionStages: [],
      },
      { application: "test", codec: "test" },
    );
    if (!saved.ok) throw new Error(saved.error.message);
    const loaded = await readJgeProjectText(await saved.value.text());
    if (!loaded.ok) throw new Error(loaded.error.message);
    const reopened = createJpegDocumentSession(imported);
    if (!reopened.ok) throw new Error("session");
    expect(reopened.value.restoreOperations(loaded.value.operations).ok).toBe(
      true,
    );
    expect(loaded.value.source.bytes).toEqual(bytes);
    expect(asset.value.readBytes()).toEqual(bytes);
    const restored = structuredClone(
      reopened.value.snapshot.currentState.jpegOperations,
    );
    expect(isOperationList(restored, inspected.value)).toBe(true);
    const codec = createCodecMock();
    for (const operation of restored) {
      expect(
        getOperationController(operation.kind)?.apply(
          codec,
          operation,
          inspected.value,
        ).ok,
      ).toBe(true);
    }
    expect(codec._coefficient_apply).toHaveBeenCalledOnce();
    expect(codec._coefficient_repeat_block).toHaveBeenCalledOnce();
    expect(codec._coefficient_permute_blocks).toHaveBeenCalledOnce();
    expect(codec._coefficient_shift_blocks).toHaveBeenCalledOnce();
    expect(codec._coefficient_transfer_blocks).toHaveBeenCalledOnce();
    expect(codec._coefficient_set_quantization).toHaveBeenCalledOnce();
    const oversized = createJpegDocumentSession(imported);
    if (!oversized.ok) throw new Error("session");
    const first = session.value.snapshot.operations[0]!;
    const records = Array.from({ length: 257 }, (_, index) => ({
      ...first,
      id: `operation-${index}`,
    }));
    expect(oversized.value.restoreOperations(records).ok).toBe(false);
    expect(oversized.value.snapshot.operations).toHaveLength(0);
    expect(
      oversized.value.restoreOperations([
        { ...first, enabled: false, type: "jpeg/glitch/coefficients" },
      ]).ok,
    ).toBe(false);
  });

  it("applies a cloned operation through the real codec and reopens its encoded output", async () => {
    const bytes = new Uint8Array(
      await readFile(
        new URL("../fixtures/synthetic-texture-420.jpg", import.meta.url),
      ),
    );
    const original = bytes.slice();
    const inspection = inspectJpeg(bytes);
    if (!inspection.ok) throw new Error("inspection");
    const mask = createFullImageMask(
      inspection.value.width,
      inspection.value.height,
    );
    if (!mask.ok) throw new Error("mask");
    const operation: JpegGlitchOperation = {
      kind: "coefficients",
      componentIndex: 0,
      mask: mask.value,
      domain: "ac",
      mode: "zero",
      frequencyBand: "all",
      strength: 0,
      seed: 1,
    };
    const result = await withOpenCodec(bytes, (session) => {
      const before = readCoefficients(session)[0]!;
      expect(
        before.some((value, index) => index % 64 !== 0 && value !== 0),
      ).toBe(true);
      const clone = structuredClone(operation);
      expect(
        getOperationController(clone.kind)?.apply(
          session.codec,
          clone,
          inspection.value,
        ),
      ).toEqual({ ok: true, value: 0 });
      return encodeOpened(session, "baseline");
    });
    expect(result.status).toBe(0);
    if (!result.value) throw new Error("output");
    if (process.env.JPEG_INDEPENDENT_DECODER) {
      const decoded = spawnSync(
        process.env.JPEG_INDEPENDENT_DECODER,
        ["-outfile", "/dev/null", "/dev/stdin"],
        { input: result.value },
      );
      expect(decoded.error).toBeUndefined();
      expect(decoded.status, decoded.stderr.toString()).toBe(0);
    }
    const reopened = await withOpenCodec(
      result.value,
      (session) => readCoefficients(session)[0]!,
    );
    expect(reopened.status).toBe(0);
    expect(
      reopened.value?.every((value, index) => index % 64 === 0 || value === 0),
    ).toBe(true);
    expect(bytes).toEqual(original);
  });
});
