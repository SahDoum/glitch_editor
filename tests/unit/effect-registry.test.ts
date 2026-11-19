import { describe, expect, it } from "vitest";
import { MASK_TOOL_REGISTRY } from "../../src/features/canvas-tools/registry";
import {
  EFFECT_MENU,
  EFFECT_REGISTRY,
  findOperationPresentation,
  getEffect,
  getJpegOperationEffect,
  getScanCorruptionEffect,
} from "../../src/features/effects/registry";
import {
  isJpegOperationController,
  isScanCorruptionController,
} from "../../src/features/effects/types";
import { getOperationController } from "../../src/jpeg/codec-controllers/registry";

describe("effect registry", () => {
  it("pairs one controller with one view under a unique effect ID", () => {
    const ids = EFFECT_REGISTRY.map(({ view }) => view.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { controller, view } of EFFECT_REGISTRY) {
      expect(controller.view).toBe(view);
      expect(view.Panel).toBeDefined();
      expect(view.iconPaths.length).toBeGreaterThan(0);
      expect(view.toolbar.tools.length > 0).toBe(view.interaction === "mask");
    }
  });

  it("gives every effect its own panel component", () => {
    expect(new Set(EFFECT_REGISTRY.map(({ view }) => view.Panel)).size).toBe(
      EFFECT_REGISTRY.length,
    );
  });

  it("keeps the menu separate and covering every effect exactly once", () => {
    const menuIds = EFFECT_MENU.flatMap(({ effectIds }) => effectIds);
    expect([...menuIds].sort()).toEqual(
      EFFECT_REGISTRY.map(({ view }) => view.id).sort(),
    );
    expect(new Set(menuIds).size).toBe(17);
    expect(EFFECT_MENU[0]?.effectIds).toEqual([
      "pixelate",
      "engraving",
      "ringing",
    ]);
    expect(EFFECT_MENU.slice(1).map(({ heading }) => heading)).toEqual([
      "Tone and detail",
      "JPEG coefficients",
      "Blocks",
      "JPEG experiments",
    ]);
  });

  it("removes the Hand, Inspector and Info tools", () => {
    for (const { view } of EFFECT_REGISTRY) {
      expect(view.id).not.toMatch(/hand|inspector|info/i);
      for (const tool of view.toolbar.tools) {
        expect(MASK_TOOL_REGISTRY).toHaveProperty(tool);
      }
    }
  });

  it("declares block gestures only on gesture effects", () => {
    const gestureIds = EFFECT_REGISTRY.filter(
      ({ controller }) =>
        isJpegOperationController(controller) && controller.gestures,
    ).map(({ view }) => view.id);
    expect(gestureIds).toEqual(["block-transfer", "block-repeat"]);
    for (const { view, controller } of EFFECT_REGISTRY) {
      const hasGestures =
        isJpegOperationController(controller) && controller.gestures;
      expect(view.interaction === "gesture").toBe(Boolean(hasGestures));
    }
  });

  it("exposes the source-reset action on Transfer and Repeat top bars", () => {
    for (const id of ["block-transfer", "block-repeat"]) {
      const view = getEffect(id)!.view;
      const actions = view.getTopBarActions!(view.defaultSettings);
      expect(actions.map(({ id: actionId }) => actionId)).toEqual([
        "reset-source",
      ]);
      expect(actions[0]!.disabled).toBe(true);
      expect(actions[0]!.shortcut).toBe("R");
    }
  });

  it("keeps Scan Corrupt out of JPEG-operation execution", () => {
    const scan = getScanCorruptionEffect();
    expect(scan?.view.id).toBe("scan-corrupt");
    const controller = scan!.controller;
    expect(isScanCorruptionController(controller)).toBe(true);
    expect(isJpegOperationController(controller)).toBe(false);
    expect("apply" in controller).toBe(false);
    for (const { controller: other } of EFFECT_REGISTRY) {
      if (other === controller) continue;
      expect(isScanCorruptionController(other)).toBe(false);
      expect(isJpegOperationController(other)).toBe(true);
      expect(typeof other.apply).toBe("function");
      expect("execute" in other).toBe(false);
      expect("execute_corrupt" in other).toBe(false);
      if (!isJpegOperationController(other)) throw new Error("JPEG effect");
      expect(getOperationController(other.operation.kind)).toBe(
        other.operation,
      );
    }
    expect(getJpegOperationEffect("pixelate")!.controller.operation).toBe(
      getJpegOperationEffect("zero")!.controller.operation,
    );
  });

  it("describes recorded operations by exact view or family title", () => {
    expect(
      findOperationPresentation({ kind: "block-permutation" })?.title,
    ).toBe("Shuffle Blocks");
    expect(findOperationPresentation({ kind: "quantization" })?.view?.id).toBe(
      "quantization",
    );
    const ambiguous = findOperationPresentation({
      kind: "coefficients",
      mode: "zero",
      domain: "ac",
      frequencyBand: "all",
    });
    expect(ambiguous?.view).toBeNull();
    expect(ambiguous?.title).toBe("Coefficient glitch");
    expect(findOperationPresentation({ kind: "unknown" })).toBeNull();
  });
});
