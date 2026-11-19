import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { createJpegDocumentSession } from "../../src/application/jpeg-document";
import {
  copySpatialMask,
  getMaskFromParameters,
  isSpatialMask,
} from "../../src/document/masks";
import { OriginalAsset } from "../../src/document/model";
import { MASK_TOOL_REGISTRY } from "../../src/features/canvas-tools/registry";
import type {
  CanvasPointerInput,
  ImageSample,
  MaskToolContext,
} from "../../src/features/canvas-tools/types";
import { getJpegOperationEffect } from "../../src/features/effects/registry";
import {
  getMaskBlockCoverage,
  getMaskBlockCoverageAtLeastHalf,
  getMaskBlockCoveragePath,
} from "../../src/jpeg/block-geometry";
import { isOperationList } from "../../src/jpeg/codec-controllers/registry";
import { inspectJpeg } from "../../src/jpeg/inspect";
import {
  createJgeProjectFile,
  readJgeProjectText,
  JGE_PROJECT_SCHEMA_VERSION,
} from "../../src/project/project-file";
import type { Result } from "../../src/shared/result";
import { clientPointToImage } from "../../src/ui/canvas-interactions";
import { CanvasPointerSession } from "../../src/ui/canvas-pointer-session";

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function sample(x: number, y: number, inside = true): ImageSample {
  return { point: { x, y }, inside };
}

async function loadFixture(fileName = "synthetic-color-odd-420.jpg") {
  const bytes = new Uint8Array(
    await readFile(new URL(`../fixtures/${fileName}`, import.meta.url)),
  );
  const context: MaskToolContext = {
    inspection: value(inspectJpeg(bytes)),
    componentIndex: 0,
    grid: "dct",
    brushSize: 4,
  };
  return { bytes, fileName, context };
}

describe("canvas coordinates and pointer ownership", () => {
  it("maps scaled, rotated image bounds back to JPEG pixels, including outside samples", () => {
    const bounds = { left: 10, top: 20, width: 180, height: 340 };
    const inspection = { width: 17, height: 9 };
    expect(clientPointToImage({ x: 30, y: 80 }, bounds, inspection, 6)).toEqual(
      sample(3, 8),
    );
    expect(
      clientPointToImage({ x: 210, y: 80 }, bounds, inspection, 6),
    ).toEqual(sample(3, -1, false));
    expect(
      clientPointToImage(
        { x: 30, y: 80 },
        { ...bounds, width: 0 },
        inspection,
        6,
      ),
    ).toBeNull();
  });

  it("ignores a second pointer and detaches the owner before release", () => {
    const pointer = new CanvasPointerSession();
    const gesture = { move: vi.fn(), end: vi.fn(), cancel: vi.fn() };
    const capture = vi.fn();
    const release = vi.fn(() => pointer.cancel(1));
    const ignoredCapture = vi.fn();
    const input: CanvasPointerInput = {
      clientPoint: { x: 1, y: 2 },
      image: sample(1, 2),
    };

    expect(pointer.begin(1, gesture, capture, release)).toBe(true);
    expect(pointer.begin(2, gesture, ignoredCapture, vi.fn())).toBe(false);
    expect(ignoredCapture).not.toHaveBeenCalled();
    pointer.move(2, input);
    pointer.end(2, input);
    pointer.cancel(2);
    expect(gesture.move).not.toHaveBeenCalled();
    expect(gesture.end).not.toHaveBeenCalled();
    expect(gesture.cancel).not.toHaveBeenCalled();

    pointer.move(1, input);
    pointer.end(1, input);
    pointer.end(1, input);
    expect(capture).toHaveBeenCalledOnce();
    expect(gesture.move).toHaveBeenCalledExactlyOnceWith(input);
    expect(gesture.end).toHaveBeenCalledExactlyOnceWith(input);
    expect(release).toHaveBeenCalledOnce();
    expect(gesture.cancel).not.toHaveBeenCalled();
    expect(pointer.isActive).toBe(false);
  });

  it("detaches a cancelled gesture before invoking its cleanup or a later up", () => {
    const pointer = new CanvasPointerSession();
    const input = { clientPoint: { x: 1, y: 2 }, image: null };
    const gesture = {
      move: vi.fn(),
      end: vi.fn(),
      cancel: vi.fn(() => pointer.end(1, input)),
    };
    const release = vi.fn();
    pointer.begin(1, gesture, vi.fn(), release);
    pointer.cancel();
    pointer.end(1, input);
    expect(gesture.cancel).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(gesture.end).not.toHaveBeenCalled();
  });
});

describe("All and Select", () => {
  it("builds a full-image mask through All and preserves partial DCT and MCU edge blocks", async () => {
    const { context } = await loadFixture();
    const { inspection } = context;
    const all = MASK_TOOL_REGISTRY.all.controller;
    const select = MASK_TOOL_REGISTRY.select.controller;
    expect(value(all.createMask(inspection)).shapes).toMatchObject([
      { x: 0, y: 0, width: 17, height: 9 },
    ]);
    const edgeStart = sample(20, 12, false);
    const end = sample(15, 7);
    const dct = value(select.begin(context, edgeStart));
    expect(value(dct.end(end))?.shapes).toMatchObject([
      { x: 8, y: 0, width: 9, height: 9 },
    ]);
    const mcu = value(select.begin({ ...context, grid: "mcu" }, edgeStart));
    expect(value(mcu.end(end))?.shapes).toMatchObject([
      { x: 0, y: 0, width: 17, height: 9 },
    ]);
    const empty = value(select.begin(context, end));
    expect(value(empty.end(end))).toBeNull();
  });

  it("moves the keyboard cursor in visual directions and commits only on the second Enter", async () => {
    const { context } = await loadFixture();
    const keyboard = MASK_TOOL_REGISTRY.select.controller.beginKeyboard(
      context,
      6,
    );
    if (!keyboard) throw new Error("Expected a keyboard selection");
    expect(keyboard.getCursor()).toMatchObject({ blockX: 1, blockY: 1 });
    expect(value(keyboard.confirm()).mask).toBeUndefined();
    const moved = keyboard.move("ArrowRight");
    if (!moved) throw new Error("Expected an arrow movement");
    expect(keyboard.getCursor()).toMatchObject({ blockX: 1, blockY: 0 });
    expect(value(moved).draft).toMatchObject({
      kind: "rectangle",
      selection: { x: 8, y: 0, width: 8, height: 9 },
    });
    expect(value(keyboard.confirm()).mask?.shapes).toMatchObject([
      { x: 8, y: 0, width: 8, height: 9 },
    ]);
    value(keyboard.confirm());
    keyboard.clear();
    expect(value(keyboard.confirm()).mask).toBeUndefined();
  });

  it("starts the Select cursor on the current component after a reset", async () => {
    const { context } = await loadFixture();
    const select = MASK_TOOL_REGISTRY.select.controller;
    const previous = select.beginKeyboard(context, 1);
    if (!previous) throw new Error("Expected a keyboard selection");
    expect(previous.getCursor()).toMatchObject({ componentId: 1, blockY: 1 });

    const nextContext = { ...context, componentIndex: 1 };
    const initial = select.getInitialCursor(nextContext);
    expect(initial).toMatchObject({
      componentId: 2,
      blockX: 1,
      blockY: 0,
      imageWidth: 1,
    });
    expect(select.beginKeyboard(nextContext, 1)?.getCursor()).toEqual(initial);
  });
});

describe("Brush", () => {
  it("pins the radius, interpolates within a segment and cancels at the whole-stroke point limit", async () => {
    const { context } = await loadFixture();
    const brush = MASK_TOOL_REGISTRY.brush.controller;
    expect(value(brush.begin(context, sample(-1, 1, false)))).toBeNull();
    const settings = {
      ...context,
      inspection: { ...context.inspection, width: 20_000 },
    };
    const started = value(brush.begin(settings, sample(1, 1)));
    if (!started) throw new Error("Expected a brush gesture");
    settings.brushSize = 256;
    value(started.move(sample(9, 1)));
    const draft = started.getDraft();
    if (draft?.kind !== "brush") throw new Error("Expected a brush draft");
    expect(draft.radius).toBe(2);
    expect(draft.strokes[0]).toHaveLength(9);

    value(started.move(sample(9_990, 1)));
    value(started.move(sample(2, -1, false)));
    value(started.move(sample(1, 1)));
    expect(started.move(sample(20, 1))).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("too long") },
    });
    expect(started.getDraft()).toBeNull();
    expect(value(started.end(sample(20, 1)))).toBeNull();
  });

  it("keeps the gap through coverage, effect history, mask restore, and project round-trip", async () => {
    const { bytes, fileName, context } = await loadFixture(
      "synthetic-texture-420.jpg",
    );
    const brush = MASK_TOOL_REGISTRY.brush.controller;
    const stroke = value(
      brush.begin({ ...context, brushSize: 8 }, sample(1, 1)),
    );
    if (!stroke) throw new Error("Expected a brush gesture");
    value(stroke.move(sample(1, -1, false)));
    value(stroke.move(sample(34, 1)));
    expect(stroke.getDraft()).toMatchObject({
      strokes: [[{ x: 4, y: 4 }], [{ x: 36, y: 4 }]],
    });
    const mask = value(stroke.end(sample(34, 1)));
    if (!mask) throw new Error("Expected a finished brush mask");
    expect(isSpatialMask(mask)).toBe(true);
    expect(mask.shapes).toMatchObject([
      {
        kind: "brush",
        radius: 4,
        points: [
          { x: 4, y: 4 },
          { x: 36, y: 4 },
        ],
      },
    ]);

    const { inspection } = context;
    const componentId = inspection.components[0]!.id;
    for (const getCoverage of [
      getMaskBlockCoverage,
      getMaskBlockCoverageAtLeastHalf,
    ]) {
      expect(
        [...value(getCoverage(mask, inspection, componentId))].slice(0, 5),
      ).toEqual(
        getCoverage === getMaskBlockCoverage
          ? [1, 1, 0, 0, 1]
          : [1, 0, 0, 0, 1],
      );
    }
    expect(value(getMaskBlockCoveragePath(mask, inspection, componentId))).toBe(
      "M0 0h16v8h-16zM32 0h13v8h-13zM0 8h8v8h-8zM32 8h8v8h-8z",
    );

    const effect = getJpegOperationEffect("pixelate")!;
    const operation = value(
      effect.controller.buildOperation({
        inspection,
        componentIndex: 0,
        settings: effect.view.defaultSettings,
        mask,
      }),
    );
    expect(isOperationList([operation], inspection)).toBe(true);
    const source = {
      bytes,
      fileName,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const imported = {
      originalAsset: value(OriginalAsset.create(source)),
      inspection,
      previewUrl: "blob:fixture",
    };
    const history = value(createJpegDocumentSession(imported));
    const applied = value(
      effect.controller.apply(history, operation, inspection),
    );
    expect(applied.currentState.jpegOperations).toEqual([operation]);

    const file = value(
      await createJgeProjectFile(
        {
          source,
          operations: applied.operations,
          draftMask: mask,
          scanCorruptionStages: [],
        },
        { application: "0.1.0", codec: "libjpeg-turbo 3.2.0" },
      ),
    );
    const serialized = await file.text();
    expect(JSON.parse(serialized).schemaVersion).toBe(
      JGE_PROJECT_SCHEMA_VERSION,
    );
    const reopened = value(await readJgeProjectText(serialized));
    expect(reopened.draftMask).toEqual(mask);
    expect(reopened.source.bytes).toEqual(bytes);
    const restored = value(createJpegDocumentSession(imported));
    expect(
      value(restored.restoreOperations(reopened.operations)).currentState
        .jpegOperations,
    ).toEqual([operation]);
    const snapshot = getMaskFromParameters(reopened.operations[0]?.parameters);
    if (!snapshot) throw new Error("Expected the saved operation's brush mask");
    const copy = value(copySpatialMask(snapshot));
    expect(copy.id).not.toBe(mask.id);
    expect(copy.shapes).toEqual(mask.shapes);
  });
});
