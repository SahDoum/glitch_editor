import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { CanvasPointerInput } from "../../src/features/canvas-tools/types";
import {
  getEffect,
  getJpegOperationEffect,
} from "../../src/features/effects/registry";
import type {
  EffectGestureController,
  GestureContext,
} from "../../src/features/effects/types";
import { ScanCorruptEffect } from "../../src/features/scan-corrupt/scan-corrupt.controller";
import { inspectJpeg } from "../../src/jpeg/inspect";
import { EFFECT_REGISTRY } from "../../src/features/effects/registry";
import { bindEffectCanvasInteraction } from "../../src/ui/canvas-interactions";
import { CanvasPointerSession } from "../../src/ui/canvas-pointer-session";

async function inspection(fileName = "synthetic-color-444.jpg") {
  const bytes = new Uint8Array(
    await readFile(new URL(`../fixtures/${fileName}`, import.meta.url)),
  );
  const result = inspectJpeg(bytes);
  if (!result.ok) throw new Error("fixture");
  return { bytes, inspection: result.value };
}

type Loose = Record<string, unknown>;

function gestureEffect(id: string) {
  const effect = getEffect(id);
  const gestures = (
    effect?.controller as { gestures?: EffectGestureController<Loose> }
  )?.gestures;
  if (!effect || !gestures) throw new Error(`${id} gestures`);
  return { effect, gestures };
}

describe("block transfer and repeat gestures", () => {
  for (const id of ["block-transfer", "block-repeat"]) {
    it(`${id}: component 1 gestures produce the corresponding block coordinates`, async () => {
      const { inspection: info } = await inspection();
      const { effect, gestures } = gestureEffect(id);
      let settings: Loose = { ...effect.view.defaultSettings };
      const context = (): GestureContext<Loose> => ({
        settings,
        inspection: info,
        componentIndex: 1,
      });
      const source = gestures.begin(context(), { x: 1, y: 1 });
      settings = { ...settings, ...source.outcome.patch };
      settings = {
        ...settings,
        ...source.gesture?.end(context(), { x: 2, y: 2 }, true).patch,
      };
      expect(settings.source).toEqual({ x: 0, y: 0, width: 1, height: 1 });
      const destination = gestures.begin(
        context(),
        id === "block-repeat" ? { x: 1, y: 1 } : { x: 9, y: 1 },
      );
      settings = { ...settings, ...destination.outcome.patch };
      const end = destination.gesture?.end(context(), { x: 9, y: 1 }, true);
      settings = { ...settings, ...end?.patch };
      expect(settings.destination).toEqual({ x: 1, y: 0 });
      expect(Boolean(end?.apply)).toBe(id === "block-transfer");
      const built = getJpegOperationEffect(id)!.controller.buildOperation({
        settings,
        inspection: info,
        componentIndex: 1,
        mask: null,
      });
      expect(built.ok).toBe(true);
      if (!built.ok) throw new Error(built.error.message);
      expect(built.value).toMatchObject(
        id === "block-repeat"
          ? {
              kind: "block-repeat",
              componentIndex: 1,
              sourceX: 0,
              sourceY: 0,
              offsetX: 1,
              offsetY: 0,
            }
          : {
              kind: "block-transfer",
              componentIndex: 1,
              sourceX: 0,
              sourceY: 0,
              destinationX: 1,
              destinationY: 0,
              width: 1,
              height: 1,
            },
      );
      const reset = effect.view
        .getTopBarActions?.(settings)
        .find((action) => action.id === "reset-source");
      settings = { ...settings, ...reset?.patch };
      expect(settings.source).toBeNull();
      expect(settings.destination).toBeNull();
    });

    it(`${id}: the hint changes on completed source selection and reset`, async () => {
      const { inspection: info } = await inspection();
      const { effect, gestures } = gestureEffect(id);
      const view = effect.view;
      let settings: Loose = { ...view.defaultSettings };
      const context = (): GestureContext<Loose> => ({
        settings,
        inspection: info,
        componentIndex: 0,
      });

      const sourceHint = gestures.getHint(context());
      expect(sourceHint?.text).toContain("source");
      const first = gestures.begin(context(), { x: 8, y: 8 });
      expect(first.gesture).not.toBeNull();
      settings = { ...settings, ...first.outcome.patch };
      expect(settings.draft).not.toBeNull();
      const moved = first.gesture?.move(context(), { x: 10, y: 10 }, true);
      settings = { ...settings, ...moved?.patch };
      expect(gestures.getHint(context())).toEqual(sourceHint);
      const ended = first.gesture?.end(context(), { x: 10, y: 10 }, true);
      settings = { ...settings, ...ended?.patch };
      expect(settings.source).not.toBeNull();
      expect(ended?.apply).toBeFalsy();
      expect(gestures.getHint(context())).toMatchObject({
        text: expect.stringContaining("destination"),
        keyboard: expect.stringContaining("R"),
      });

      const reset = view
        .getTopBarActions?.(settings)
        .find((action) => action.id === "reset-source");
      expect(reset?.shortcut).toBe("R");
      expect(reset?.disabled).toBe(false);
      settings = { ...settings, ...reset?.patch };
      expect(settings.source).toBeNull();
      expect(settings.draft).toBeNull();
      expect(gestures.getHint(context())).toEqual(sourceHint);
      expect(
        view.getTopBarActions?.(settings).find((a) => a.id === "reset-source")
          ?.disabled,
      ).toBe(true);
    });

    it(`${id}: changing component discards the source region`, async () => {
      const { effect } = gestureEffect(id);
      const settings = {
        ...effect.view.defaultSettings,
        source: { x: 0, y: 0, width: 1, height: 1 },
      } as Loose;
      const reset = effect.view.resetForComponentChange?.(settings);
      expect((reset as Loose | undefined)?.source).toBeNull();
    });
  }

  it("clears a Transfer source draft and preserves the source when a destination is cancelled", async () => {
    const { inspection: info } = await inspection();
    const { effect, gestures } = gestureEffect("block-transfer");
    const start = gestures.begin(
      {
        settings: { ...effect.view.defaultSettings } as Loose,
        inspection: info,
        componentIndex: 0,
      },
      { x: 8, y: 8 },
    );
    expect(start.gesture?.cancel()).toEqual({
      draft: null,
      draftOutOfBounds: false,
    });
    const source = { x: 1, y: 1, width: 1, height: 1 };
    const settings = { ...effect.view.defaultSettings, source };
    const destination = gestures.begin(
      { settings, inspection: info, componentIndex: 0 },
      { x: 1, y: 1 },
    );
    expect({ ...settings, ...destination.gesture?.cancel() }).toMatchObject({
      source,
      destination: null,
    });
  });

  it("clips the Copy contour and applies the pointer-up destination exactly once", async () => {
    const { inspection: info } = await inspection();
    const { effect, gestures } = gestureEffect("block-transfer");
    const controller = getJpegOperationEffect("block-transfer")!.controller;
    let settings: Loose = {
      ...effect.view.defaultSettings,
      source: { x: 0, y: 0, width: 2, height: 1 },
    };
    const context = () => ({ inspection: info, componentIndex: 0, settings });
    const apply = vi.fn();
    const interaction = bindEffectCanvasInteraction(
      gestures,
      context(),
      (outcome) => {
        settings = { ...settings, ...outcome.patch };
        if (outcome.apply) apply(outcome.patch);
      },
    );
    const input = (x: number, y: number): CanvasPointerInput => ({
      clientPoint: { x, y },
      image: { point: { x, y }, inside: true },
    });
    const gesture = interaction.begin(input(1, 9));
    if (!gesture) throw new Error("Expected a destination gesture");
    const pointer = new CanvasPointerSession();
    pointer.begin(1, gesture, vi.fn(), () => pointer.cancel(1));
    pointer.move(1, input(2, 9));
    expect(gestures.getOverlay(context())?.destination?.width).toBe(16);
    pointer.end(1, input(9, 9));
    pointer.end(1, input(9, 9));
    expect(apply).toHaveBeenCalledExactlyOnceWith({
      destination: { x: 1, y: 1 },
    });
    expect(gestures.getOverlay(context())).toMatchObject({
      destination: { x: 8, y: 8, width: 8, height: 8 },
      destinationInvalid: false,
    });
    expect(
      controller.buildOperation({ ...context(), mask: null }),
    ).toMatchObject({
      ok: true,
      value: { destinationX: 1, destinationY: 1, width: 1, height: 1 },
    });
  });

  it("marks a partially overlapping Swap as invalid and retains the source for another drop", async () => {
    const { inspection: info } = await inspection("synthetic-texture-420.jpg");
    const { effect, gestures } = gestureEffect("block-transfer");
    const source = { x: 0, y: 0, width: 2, height: 1 };
    const settings: Loose = {
      ...effect.view.defaultSettings,
      action: "swap",
      source,
    };
    const context = { inspection: info, componentIndex: 0, settings };
    const point = { x: 9, y: 1 };
    const { gesture } = gestures.begin(context, point);
    const end = gesture?.end(context, point, true);
    expect(end).toMatchObject({
      apply: false,
      error: expect.stringContaining("separate"),
    });
    expect(end?.patch).not.toHaveProperty("source");
    expect(
      gestures.getOverlay({
        ...context,
        settings: { ...settings, ...end?.patch },
      }),
    ).toMatchObject({
      source: { x: 0, y: 0, width: 16, height: 8 },
      destinationInvalid: true,
    });
  });

  it("checks the Repeat contour against every requested destination", async () => {
    const { inspection: info } = await inspection();
    const { effect, gestures } = gestureEffect("block-repeat");
    const controller = getJpegOperationEffect("block-repeat")!.controller;
    const context = {
      inspection: info,
      componentIndex: 0,
      settings: {
        ...effect.view.defaultSettings,
        source: { x: 0, y: 0, width: 1, height: 1 },
        destination: { x: 1, y: 0 },
        count: 2,
      },
    };
    expect(gestures.getOverlay(context)).toMatchObject({
      destination: { x: 8, y: 0, width: 8, height: 8 },
      destinationInvalid: true,
    });
    expect(controller.buildOperation({ ...context, mask: null }).ok).toBe(
      false,
    );
    const valid = { ...context, settings: { ...context.settings, count: 1 } };
    expect(gestures.getOverlay(valid)).toMatchObject({
      destinationInvalid: false,
    });
    expect(controller.buildOperation({ ...valid, mask: null }).ok).toBe(true);
  });
});

describe("effect interaction contracts", () => {
  it("only gesture effects expose gestures and top-bar reset actions", () => {
    for (const { controller, view } of EFFECT_REGISTRY) {
      const hasGestures =
        (controller as { gestures?: unknown }).gestures !== undefined;
      expect(hasGestures).toBe(view.interaction === "gesture");
    }
  });
});

describe("Scan Corrupt controller", () => {
  it("exposes execute_corrupt only and never mutates the clean bytes", async () => {
    const { bytes } = await inspection();
    const original = bytes.slice();
    expect("apply" in ScanCorruptEffect).toBe(false);
    expect(typeof ScanCorruptEffect.execute_corrupt).toBe("function");
    const parameters = ScanCorruptEffect.toParameters({
      mode: "bit-flip",
      count: 4,
      rangeStart: 0,
      rangeEnd: 1,
      seed: 7,
    });
    expect(parameters).toEqual({
      mode: "bit-flip",
      count: 4,
      rangeStart: 0,
      rangeEnd: 1,
      seed: 7,
    });
    // Node has no Worker, so the worker boundary reports a typed error.
    const result = await ScanCorruptEffect.execute_corrupt(bytes, [parameters]);
    expect(result.ok).toBe(false);
    expect(bytes).toEqual(original);
  });
});
