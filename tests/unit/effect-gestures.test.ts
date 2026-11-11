import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { getEffect } from "../../src/features/effects/registry";
import type {
  EffectGestureController,
  GestureContext,
} from "../../src/features/effects/types";
import { ScanCorruptEffect } from "../../src/features/scan-corrupt/scan-corrupt.controller";
import { inspectJpeg } from "../../src/jpeg/inspect";
import { EFFECT_REGISTRY } from "../../src/features/effects/registry";

async function inspection() {
  const bytes = new Uint8Array(
    await readFile(
      new URL("../fixtures/synthetic-color-444.jpg", import.meta.url),
    ),
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

      const reset = view
        .getTopBarActions?.(settings)
        .find((action) => action.id === "reset-source");
      expect(reset?.shortcut).toBe("R");
      expect(reset?.disabled).toBe(false);
      settings = { ...settings, ...reset?.patch };
      expect(settings.source).toBeNull();
      expect(settings.draft).toBeNull();
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
    expect("execute" in ScanCorruptEffect).toBe(false);
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
