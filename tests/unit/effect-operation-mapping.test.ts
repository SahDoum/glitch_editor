import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { createJpegDocumentSession } from "../../src/application/jpeg-document";
import { createFullImageMask } from "../../src/document/masks";
import { OriginalAsset } from "../../src/document/model";
import { getJpegOperationEffect } from "../../src/features/effects/registry";
import { isCoefficientWorkerRequest } from "../../src/jpeg/coefficient-worker-protocol";
import { getOperationController } from "../../src/jpeg/codec-controllers/registry";
import type { CodecCommandModule } from "../../src/jpeg/codec-controllers/controller";
import { inspectJpeg } from "../../src/jpeg/inspect";
import {
  encodeOpened,
  readCoefficients,
  withOpenCodec,
} from "../helpers/codec-harness";

async function fixture() {
  const bytes = new Uint8Array(
    await readFile(
      new URL("../fixtures/synthetic-color-444.jpg", import.meta.url),
    ),
  );
  const inspection = inspectJpeg(bytes);
  const asset = OriginalAsset.create({
    fileName: "fixture.jpg",
    sha256: "a".repeat(64),
    bytes,
  });
  if (!inspection.ok || !asset.ok) throw new Error("fixture");
  const mask = createFullImageMask(
    inspection.value.width,
    inspection.value.height,
  );
  const history = createJpegDocumentSession({
    originalAsset: asset.value,
    inspection: inspection.value,
    previewUrl: "blob:test",
  });
  if (!mask.ok || !history.ok) throw new Error("fixture session");
  return {
    bytes,
    asset: asset.value,
    inspection: inspection.value,
    mask: mask.value,
    history: history.value,
  };
}

const cases = [
  ["pixelate", "zero", "ac", "all", 0, 1],
  ["zero", "zero", "ac", "high", 3, 73],
  ["ac-scale", "scale", "ac", "high", 3, 73],
  ["coefficient-randomize", "randomize", "ac", "high", 3, 73],
  ["dc-offset", "offset", "dc", "all", 3, 73],
  ["posterization", "dc-steps", "dc", "all", 3, 73],
  ["ac-low-pass", "low-pass", "ac", "all", 3, 73],
  ["ringing", "ringing-boost", "ac", "all", 3, 73],
  ["engraving", "engrave-vertical", "ac", "all", 3, 73],
  ["engraving", "engrave-horizontal", "ac", "all", 3, 73],
  ["ac-invert", "invert", "ac", "high", 0, 73],
  ["ac-isolate", "isolate", "ac", "high", 0, 73],
] as const;

describe("effect-specific operation mapping", () => {
  it.each(cases)(
    "%s maps its settings to the %s coefficient operation",
    async (id, mode, domain, frequencyBand, strength, seed) => {
      const { inspection, mask, history } = await fixture();
      const effect = getJpegOperationEffect(id)!;
      const settings = {
        ...effect.view.defaultSettings,
        mode: id === "engraving" ? mode : "offset",
        domain: "ac",
        frequencyBand: "high",
        strength: 3,
        seed: 73,
      };
      const context = { settings, inspection, componentIndex: 1, mask };
      const preview = effect.controller.buildOperation(context);
      const apply = effect.controller.buildOperation(context);
      expect(preview).toEqual({
        ok: true,
        value: {
          kind: "coefficients",
          mode,
          domain,
          frequencyBand,
          strength,
          seed,
          componentIndex: 1,
          mask,
        },
      });
      expect(apply).toEqual(preview);
      if (!apply.ok) throw new Error("operation");
      expect(effect.controller.apply(history, apply.value, inspection).ok).toBe(
        true,
      );
      settings.strength = 5;
      expect(history.snapshot.currentState.jpegOperations[0]).toEqual(
        apply.value,
      );
      expect(history.undo().ok).toBe(true);
      expect(history.snapshot.currentState.jpegOperations).toHaveLength(0);
      expect(history.redo().ok).toBe(true);
      expect(history.snapshot.currentState.jpegOperations[0]).toEqual(
        apply.value,
      );
    },
  );

  it("supports DC selection and enforces invalid settings, masks and effect semantics", async () => {
    const { inspection, mask, history } = await fixture();
    for (const id of ["zero", "ac-scale", "coefficient-randomize"]) {
      const effect = getJpegOperationEffect(id)!;
      const settings = {
        ...effect.view.defaultSettings,
        domain: "dc",
        frequencyBand: "all",
      };
      const context = { settings, inspection, componentIndex: 1, mask };
      expect(effect.controller.buildOperation(context)).toMatchObject({
        ok: true,
        value: { domain: "dc", frequencyBand: "all" },
      });

      expect(
        effect.controller.buildOperation({ ...context, mask: null }),
      ).toMatchObject({
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: expect.stringContaining("Select an area"),
        },
      });
      expect(
        effect.controller.buildOperation({ ...context, componentIndex: 3 }).ok,
      ).toBe(false);
    }
    const scale = getJpegOperationEffect("ac-scale")!;
    const context = {
      settings: { ...scale.view.defaultSettings, strength: 9 },
      inspection,
      componentIndex: 1,
      mask,
    };
    expect(scale.controller.buildOperation(context)).toMatchObject({
      ok: false,
      error: { message: "The current coefficient settings are invalid." },
    });
    expect(
      scale.controller.buildOperation({
        ...context,
        settings: { ...context.settings, strength: -8 },
      }).ok,
    ).toBe(true);
    expect(
      scale.controller.buildOperation({
        ...context,
        settings: { ...context.settings, strength: 8 },
      }).ok,
    ).toBe(true);
    const engraving = getJpegOperationEffect("engraving")!;
    expect(
      engraving.controller.buildOperation({
        ...context,
        settings: { ...engraving.view.defaultSettings, mode: "scale" },
      }).ok,
    ).toBe(false);
    const isolate = getJpegOperationEffect("ac-isolate")!;
    expect(
      isolate.controller.buildOperation({
        ...context,
        settings: { ...isolate.view.defaultSettings, frequencyBand: "all" },
      }).ok,
    ).toBe(false);
    const pixelate = getJpegOperationEffect("pixelate")!;
    expect(
      pixelate.controller.apply(
        history,
        {
          kind: "coefficients",
          mode: "zero",
          domain: "dc",
          frequencyBand: "all",
          strength: 0,
          seed: 1,
          componentIndex: 1,
          mask,
        },
        inspection,
      ).ok,
    ).toBe(false);
    expect(history.snapshot.currentState.jpegOperations).toHaveLength(0);
  });

  it("maps block operations and DQT settings, including both DQT semantics", async () => {
    const { inspection, mask, history } = await fixture();
    const cases = [
      {
        id: "block-repeat",
        settings: {
          source: { x: 0, y: 0, width: 1, height: 1 },
          destination: { x: 1, y: 0 },
          count: 1,
        },
        expected: {
          kind: "block-repeat",
          componentIndex: 1,
          sourceX: 0,
          sourceY: 0,
          offsetX: 1,
          offsetY: 0,
          repetitions: 1,
        },
      },
      {
        id: "block-transfer",
        settings: {
          source: { x: 0, y: 0, width: 2, height: 1 },
          destination: { x: 1, y: 1 },
          mode: "ac",
          action: "copy",
        },
        expected: {
          kind: "block-transfer",
          componentIndex: 1,
          sourceX: 0,
          sourceY: 0,
          width: 1,
          height: 1,
          destinationX: 1,
          destinationY: 1,
          mode: "ac",
          action: "copy",
        },
      },
      {
        id: "block-shuffle",
        settings: { seed: 53 },
        expected: {
          kind: "block-permutation",
          componentIndex: 1,
          mask,
          seed: 53,
        },
      },
      {
        id: "local-shift",
        settings: { x: 1, y: -1 },
        expected: {
          kind: "block-shift",
          componentIndex: 1,
          mask,
          offsetX: 1,
          offsetY: -1,
        },
      },
    ] as const;
    for (const { id, settings, expected } of cases) {
      const effect = getJpegOperationEffect(id)!;
      const built = effect.controller.buildOperation({
        settings: { ...effect.view.defaultSettings, ...settings },
        inspection,
        componentIndex: 1,
        mask,
      });
      expect(built).toEqual({ ok: true, value: expected });
      if (!built.ok) throw new Error(id);
      expect(effect.controller.apply(history, built.value, inspection).ok).toBe(
        true,
      );
    }
    const quantization = getJpegOperationEffect("quantization")!;
    const values = Array<number>(64).fill(10);
    for (const semantics of ["reinterpret", "requantize"] as const) {
      const settings = {
        tableId: inspection.quantizationTables[0]!.id,
        values,
        semantics,
        pattern: "manual",
        seed: 23,
      };
      const built = quantization.controller.buildOperation({
        settings,
        inspection,
        componentIndex: 1,
        mask,
      });
      expect(built).toEqual({
        ok: true,
        value: { kind: "quantization", ...settings },
      });
      if (!built.ok) throw new Error("DQT");
      expect(
        quantization.controller.apply(history, built.value, inspection).ok,
      ).toBe(true);
    }
    values[0] = 99;
    const first = history.snapshot.currentState.jpegOperations[4];
    if (!first || first.kind !== "quantization") throw new Error("DQT history");
    expect(first.values[0]).toBe(10);
    expect(first.semantics).toBe("reinterpret");
    const recorded = history.snapshot.currentState.jpegOperations[5];
    if (!recorded || recorded.kind !== "quantization")
      throw new Error("DQT history");
    expect(recorded.values[0]).toBe(10);
    expect(recorded.semantics).toBe("requantize");
    expect(
      quantization.controller.buildOperation({
        settings: {
          tableId: 99,
          values,
          semantics: "reinterpret",
          pattern: "manual",
          seed: 1,
        },
        inspection,
        componentIndex: 1,
        mask,
      }).ok,
    ).toBe(false);
  });

  it("passes the selected component and exact scale parameters through worker validation and the registered codec", async () => {
    const { inspection, mask, bytes, asset } = await fixture();
    const effect = getJpegOperationEffect("ac-scale")!;
    const built = effect.controller.buildOperation({
      settings: {
        ...effect.view.defaultSettings,
        mode: "zero",
        domain: "ac",
        frequencyBand: "high",
        strength: 2,
        seed: 17,
      },
      inspection,
      componentIndex: 1,
      mask,
    });
    if (!built.ok) throw new Error(built.error.message);
    const request = structuredClone({
      id: 1,
      type: "encode",
      bytes: bytes.slice().buffer,
      geometry: inspection,
      operations: [built.value],
      options: { mode: "baseline" },
    });
    expect(isCoefficientWorkerRequest(request)).toBe(true);
    expect(
      isCoefficientWorkerRequest({
        ...request,
        operations: [{ ...built.value, componentIndex: 3 }],
      }),
    ).toBe(false);
    const codec = {
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
    expect(
      getOperationController(built.value.kind)!.apply(
        codec,
        request.operations[0]!,
        inspection,
      ).ok,
    ).toBe(true);
    expect(codec._coefficient_apply).toHaveBeenCalledWith(
      1,
      1,
      0,
      2,
      8,
      4,
      2,
      17,
    );
    const original = bytes.slice();
    const result = await withOpenCodec(bytes, (session) => {
      const before = readCoefficients(session);
      expect(
        getOperationController(built.value.kind)!.apply(
          session.codec,
          request.operations[0]!,
          inspection,
        ),
      ).toEqual({ ok: true, value: 0 });
      const after = readCoefficients(session);
      expect(after[0]).toEqual(before[0]);
      expect(after[1]).not.toEqual(before[1]);
      return encodeOpened(session, "baseline");
    });
    expect(result.status).toBe(0);
    expect(result.value?.length).toBeGreaterThan(0);
    expect(asset.readBytes()).toEqual(original);
    expect(bytes).toEqual(original);
  });
});
