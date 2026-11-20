import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  getEffect,
  getJpegOperationEffect,
} from "../../src/features/effects/registry";
import type {
  EffectGestureController,
  GestureContext,
} from "../../src/features/effects/types";
import type {
  CanvasContext,
  CanvasFeedback,
  CanvasPointerInput,
} from "../../src/features/canvas-tools/types";
import { ScanCorruptEffect } from "../../src/features/scan-corrupt/scan-corrupt.controller";
import { inspectJpeg } from "../../src/jpeg/inspect";
import { EFFECT_REGISTRY } from "../../src/features/effects/registry";
import { EffectCanvasInteraction } from "../../src/ui/canvas-tool-gestures";

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
      if (id === "block-transfer") expect(end?.apply).toBe(false);
      else expect(end?.apply).toBeUndefined();
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

    it(`${id}: drag selects a source, a second drag applies, reset clears it`, async () => {
      const { inspection: info } = await inspection();
      const { effect, gestures } = gestureEffect(id);
      const view = effect.view;
      let settings: Loose = { ...view.defaultSettings };
      const context = (): GestureContext<Loose> => ({
        settings,
        inspection: info,
        componentIndex: 0,
      });

      const initialHint = gestures.getHint(context());
      expect(initialHint?.text).toContain("source");
      const first = gestures.begin(context(), { x: 8, y: 8 });
      expect(first.gesture).not.toBeNull();
      settings = { ...settings, ...first.outcome.patch };
      expect(settings.draft).not.toBeNull();
      const moved = first.gesture?.move(context(), { x: 10, y: 10 }, true);
      settings = { ...settings, ...moved?.patch };
      const ended = first.gesture?.end(context(), { x: 10, y: 10 }, true);
      settings = { ...settings, ...ended?.patch };
      expect(settings.source).not.toBeNull();
      expect(ended?.apply).toBeFalsy();
      expect(gestures.getHint(context())?.text).toContain("destination");

      const reset = view
        .getTopBarActions?.(settings)
        .find((action) => action.id === "reset-source");
      expect(reset?.shortcut).toBe("R");
      expect(reset?.disabled).toBe(false);
      settings = { ...settings, ...reset?.patch };
      expect(settings.source).toBeNull();
      expect(settings.draft).toBeNull();
      expect(gestures.getHint(context())).toEqual(initialHint);
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

  it("cancel returns a patch that clears the in-progress drag", async () => {
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
    expect(start.gesture?.cancel()).toBeDefined();
  });

  it("Transfer cancels only the tentative destination after choosing a source", async () => {
    const { inspection: info } = await inspection();
    const { effect, gestures } = gestureEffect("block-transfer");
    const source = { x: 0, y: 0, width: 1, height: 1 };
    const settings: Loose = { ...effect.view.defaultSettings, source };
    const context = { inspection: info, componentIndex: 0, settings };
    const { gesture, outcome } = gestures.begin(context, { x: 9, y: 9 });
    expect(outcome.patch?.destination).toEqual({ x: 1, y: 1 });
    expect(gesture?.cancel()).toEqual({ destination: null });
    const overlay = gestures.getOverlay({
      ...context,
      settings: { ...settings, ...outcome.patch, ...gesture?.cancel() },
    });
    expect(overlay?.source).toMatchObject({ x: 0, y: 0, width: 8, height: 8 });
    expect(overlay?.destination).toBeNull();
  });

  it("publishes Transfer source and application through canvas feedback for the owning effect", async () => {
    const { inspection: info } = await inspection();
    const { effect, gestures } = gestureEffect("block-transfer");
    let settings: Loose = { ...effect.view.defaultSettings, applyOnDrop: true };
    const outcomes: NonNullable<CanvasFeedback["effect"]>[] = [];
    const canvas: CanvasContext = {
      inspection: info,
      componentIndex: 0,
      grid: "dct",
      brushSize: 4,
      orientation: 1,
      keyboardCursor: null,
      cancelGesture() {},
      publish({ effect }) {
        if (effect) {
          settings = { ...settings, ...effect.patch };
          outcomes.push(effect);
        }
      },
    };
    const interaction = () =>
      new EffectCanvasInteraction(
        gestures,
        { inspection: info, componentIndex: 0, settings },
        "block-transfer",
      );
    const sample = (x: number): CanvasPointerInput => ({
      clientPoint: { x, y: 1 },
      image: { point: { x, y: 1 }, inside: true },
    });

    const source = interaction().begin(sample(1), canvas);
    source?.end(sample(10));
    const destination = interaction().begin(sample(2), canvas);
    destination?.move(sample(3));
    destination?.end(sample(9));

    expect(
      gestures.getOverlay({ inspection: info, componentIndex: 0, settings }),
    ).toMatchObject({
      destination: { x: 8, y: 0, width: 8, height: 8 },
      destinationInvalid: false,
    });

    expect(outcomes.every(({ ownerId }) => ownerId === "block-transfer")).toBe(
      true,
    );
    expect(outcomes.filter(({ apply }) => apply)).toEqual([
      {
        ownerId: "block-transfer",
        patch: { destination: { x: 1, y: 0 } },
        apply: true,
      },
    ]);
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
      destinations: [{ x: 8, y: 0, width: 8, height: 8 }],
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
