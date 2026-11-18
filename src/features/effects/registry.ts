import { BlockRepeatEffect } from "../block-transform/effects/block-repeat.controller";
import { BlockShuffleEffect } from "../block-transform/effects/block-shuffle.controller";
import { BlockTransferEffect } from "../block-transform/effects/block-transfer.controller";
import { LocalShiftEffect } from "../block-transform/effects/local-shift.controller";
import { AcInvertEffect } from "../coefficient-glitch/effects/ac-invert.controller";
import { AcIsolateEffect } from "../coefficient-glitch/effects/ac-isolate.controller";
import { AcLowPassEffect } from "../coefficient-glitch/effects/ac-low-pass.controller";
import { AcScaleEffect } from "../coefficient-glitch/effects/ac-scale.controller";
import { CoefficientRandomizeEffect } from "../coefficient-glitch/effects/coefficient-randomize.controller";
import { DcOffsetEffect } from "../coefficient-glitch/effects/dc-offset.controller";
import { EngravingEffect } from "../coefficient-glitch/effects/engraving.controller";
import { PixelateEffect } from "../coefficient-glitch/effects/pixelate.controller";
import { PosterizationEffect } from "../coefficient-glitch/effects/posterization.controller";
import { RingingEffect } from "../coefficient-glitch/effects/ringing.controller";
import { ZeroEffect } from "../coefficient-glitch/effects/zero.controller";
import { QuantizationEffect } from "../quantization/quantization.controller";
import { ScanCorruptEffect } from "../scan-corrupt/scan-corrupt.controller";
import {
  isJpegOperationController,
  isScanCorruptionController,
  type EffectController,
  type EffectId,
  type EffectMenuGroup,
  type EffectView,
  type JpegOperationController,
  type OperationDescriptor,
  type OperationParameters,
  type ScanCorruptionController,
} from "./types";

/** Settings after the per-effect type has been erased for generic callers. */
export type ErasedSettings = object;

export interface RegisteredEffect {
  readonly controller: EffectController<ErasedSettings>;
  readonly view: EffectView<ErasedSettings>;
}

/**
 * The only place settings types are erased: each controller is paired with
 * its own view, so callers can treat the entry uniformly.
 */
function defineEffect<Settings extends object>(
  controller: EffectController<Settings>,
): RegisteredEffect {
  return {
    controller: controller as unknown as EffectController<ErasedSettings>,
    view: controller.view as unknown as EffectView<ErasedSettings>,
  };
}

/** Every effect, once: controller and view live together under one ID. */
export const EFFECT_REGISTRY: readonly RegisteredEffect[] = Object.freeze([
  defineEffect(PixelateEffect),
  defineEffect(ZeroEffect),
  defineEffect(PosterizationEffect),
  defineEffect(RingingEffect),
  defineEffect(EngravingEffect),
  defineEffect(CoefficientRandomizeEffect),
  defineEffect(AcScaleEffect),
  defineEffect(DcOffsetEffect),
  defineEffect(AcLowPassEffect),
  defineEffect(AcInvertEffect),
  defineEffect(AcIsolateEffect),
  defineEffect(BlockTransferEffect),
  defineEffect(BlockRepeatEffect),
  defineEffect(BlockShuffleEffect),
  defineEffect(LocalShiftEffect),
  defineEffect(QuantizationEffect),
  defineEffect(ScanCorruptEffect),
]);

/** Menu presentation only; it references effects by ID and owns no behavior. */
export const EFFECT_MENU: readonly EffectMenuGroup[] = Object.freeze([
  {
    heading: "Coefficients",
    effectIds: [
      "pixelate",
      "zero",
      "posterization",
      "ringing",
      "engraving",
      "coefficient-randomize",
      "ac-scale",
      "dc-offset",
      "ac-low-pass",
      "ac-invert",
      "ac-isolate",
    ],
  },
  {
    heading: "Blocks",
    effectIds: [
      "block-transfer",
      "block-repeat",
      "block-shuffle",
      "local-shift",
    ],
  },
  { heading: "Quantization", effectIds: ["quantization"] },
  { heading: "Encoded data", effectIds: ["scan-corrupt"] },
]);

export const DEFAULT_EFFECT_ID: EffectId = "pixelate";

/** The key persisted per-effect state is filed under. */
export function getStorageKey(view: EffectView<ErasedSettings>): string {
  return view.storageKey ?? view.id;
}

export function getEffect(id: string): RegisteredEffect | undefined {
  return EFFECT_REGISTRY.find(({ view }) => view.id === id);
}

export function getJpegOperationEffect(id: string):
  | (RegisteredEffect & {
      readonly controller: JpegOperationController<ErasedSettings>;
    })
  | undefined {
  const effect = getEffect(id);
  return effect && isJpegOperationController(effect.controller)
    ? { ...effect, controller: effect.controller }
    : undefined;
}

/** The byte-domain effect, found by capability rather than by ID. */
export function getScanCorruptionEffect():
  | (RegisteredEffect & {
      readonly controller: ScanCorruptionController<ErasedSettings>;
    })
  | undefined {
  for (const effect of EFFECT_REGISTRY) {
    if (isScanCorruptionController(effect.controller)) {
      return { ...effect, controller: effect.controller };
    }
  }
  return undefined;
}

export interface OperationPresentation {
  readonly descriptor: OperationDescriptor;
  /** The one view that produced the entry, or null if several could have. */
  readonly view: RegisteredEffect["view"] | null;
  readonly title: string;
}

/**
 * Finds how to present a recorded operation. A history record names an
 * operation kind, not an effect, so effects that record the same kind are
 * ambiguous; those get the shared family title instead of a guess.
 */
export function findOperationPresentation(
  parameters: OperationParameters,
): OperationPresentation | null {
  const kind = parameters.kind;
  if (typeof kind !== "string") return null;
  const candidates = EFFECT_REGISTRY.filter(
    ({ view }) =>
      view.operation?.kinds.includes(kind) &&
      (view.operation.matches?.(parameters) ?? true),
  );
  const first = candidates[0];
  if (!first?.view.operation) return null;
  if (candidates.length === 1) {
    return {
      descriptor: first.view.operation,
      view: first.view,
      title: first.view.label,
    };
  }
  return {
    descriptor: first.view.operation,
    view: null,
    title: first.view.operation.title,
  };
}

export function mergeSettings<Settings extends ErasedSettings>(
  settings: Settings,
  patch: Partial<Settings> | undefined,
): Settings {
  return patch ? { ...settings, ...patch } : settings;
}
