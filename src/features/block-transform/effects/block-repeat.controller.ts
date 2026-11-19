import { applyBlockRepeatOperation } from "../../../application/jpeg-document";
import { blockRepeatOperation } from "../../../jpeg/codec-controllers/operations";
import { mapJpegBlockDragToDestination } from "../../../jpeg/block-geometry";
import {
  isBlockRepeatParameters,
  type BlockRepeatOperation,
} from "../../../operations/jpeg-glitch";
import { failure, success, type Result } from "../../../shared/result";
import type {
  EffectGesture,
  EffectGestureController,
  EffectOperationContext,
  GestureContext,
  GestureOutcome,
  ImagePoint,
} from "../../effects/types";
import { BlockEffectController } from "../block-effect-controller";
import {
  getBlockRegionFromDrag,
  getBlockRegionSelection,
  getComponentBlockPoint,
} from "../block-geometry-helpers";
import { BlockRepeatView, type BlockRepeatSettings } from "./block-repeat.view";

type Context = GestureContext<BlockRepeatSettings>;
type Outcome = GestureOutcome<BlockRepeatSettings>;

function getBlockRepeatOperation({
  settings,
  componentIndex,
}: Context): BlockRepeatOperation | null {
  const { source, destination, count } = settings;
  return source && destination
    ? {
        kind: blockRepeatOperation.kind,
        componentIndex,
        sourceX: source.x,
        sourceY: source.y,
        offsetX: destination.x - source.x,
        offsetY: destination.y - source.y,
        repetitions: count,
      }
    : null;
}

function getDestination(context: Context, start: ImagePoint, end: ImagePoint) {
  const component = context.inspection.components[context.componentIndex];
  const source = context.settings.source;
  if (!component || !source) return null;
  return mapJpegBlockDragToDestination(
    context.inspection,
    component.id,
    source,
    start,
    end,
  );
}

function sourceGesture(start: ImagePoint): EffectGesture<BlockRepeatSettings> {
  const region = (context: Context, point: ImagePoint) =>
    getBlockRegionFromDrag(
      context.inspection,
      context.componentIndex,
      start,
      point,
    );
  return {
    move: (context, point): Outcome => {
      const mapped = region(context, point);
      return { patch: { draft: mapped.ok ? mapped.value : null } };
    },
    end(context, point): Outcome {
      if (!point) return { patch: { draft: null } };
      const mapped = region(context, point);
      if (!mapped.ok) {
        return { patch: { draft: null }, error: mapped.error.message };
      }
      if (mapped.value.width !== 1 || mapped.value.height !== 1) {
        return {
          patch: { draft: null },
          error:
            "Select one source block by dragging within a visible DCT block.",
        };
      }
      return {
        patch: { draft: null, source: mapped.value, destination: null },
        error: "",
      };
    },
    cancel: () => ({ draft: null }),
  };
}

function destinationGesture(
  start: ImagePoint,
): EffectGesture<BlockRepeatSettings> {
  return {
    move(context, point): Outcome {
      const destination = getDestination(context, start, point);
      return {
        patch: { destination: destination?.ok ? destination.value : null },
      };
    },
    end(context, point): Outcome {
      if (!point) return { patch: { destination: null } };
      const destination = getDestination(context, start, point);
      if (!destination?.ok) {
        return {
          patch: { destination: null },
          error: destination?.error.message,
        };
      }
      return { patch: { destination: destination.value }, error: "" };
    },
    cancel: () => ({ destination: null }),
  };
}

const gestures: EffectGestureController<BlockRepeatSettings> = {
  getHint(context) {
    if (!context.settings.source) return { text: "Select one source block." };
    const keyboard = "Press R to choose another source.";
    const operation = getBlockRepeatOperation(context);
    if (!operation)
      return {
        text: "Drag from the source block to the first destination.",
        keyboard,
      };
    if (operation.offsetX === 0 && operation.offsetY === 0) {
      return {
        text: "Move the first copy away from the source block.",
        keyboard,
      };
    }
    if (
      !Number.isInteger(operation.repetitions) ||
      operation.repetitions < 1 ||
      operation.repetitions > 256
    ) {
      return { text: "Enter a copy count from 1 to 256.", keyboard };
    }
    return {
      text: isBlockRepeatParameters(operation, context.inspection)
        ? "The copies are ready. Press Apply to repeat the block."
        : "Some copies go outside the photo. Reduce the count or move the first copy closer.",
      keyboard,
    };
  },
  begin(context, point) {
    const block = getComponentBlockPoint(
      context.inspection,
      context.componentIndex,
      point,
    );
    if (!block.ok) {
      return { gesture: null, outcome: { error: block.error.message } };
    }
    const source = context.settings.source;
    if (!source) {
      return {
        gesture: sourceGesture(point),
        outcome: {
          patch: {
            draft: { x: block.value.x, y: block.value.y, width: 1, height: 1 },
            destination: null,
          },
          error: "",
        },
      };
    }
    if (block.value.x !== source.x || block.value.y !== source.y) {
      return {
        gesture: null,
        outcome: {
          error: "Start the destination drag inside the selected source block.",
        },
      };
    }
    return {
      gesture: destinationGesture(point),
      outcome: { patch: { destination: null }, error: "" },
    };
  },
  getOverlay(context) {
    const { settings, inspection, componentIndex } = context;
    const operation = getBlockRepeatOperation(context);
    const destinations = [];
    if (
      operation &&
      Number.isInteger(operation.repetitions) &&
      operation.repetitions <= 256
    ) {
      for (let copy = 1; copy <= operation.repetitions; copy++) {
        const selection = getBlockRegionSelection(inspection, componentIndex, {
          x: operation.sourceX + copy * operation.offsetX,
          y: operation.sourceY + copy * operation.offsetY,
          width: 1,
          height: 1,
        });
        if (selection) destinations.push(selection);
      }
    }
    return {
      source: getBlockRegionSelection(
        inspection,
        componentIndex,
        settings.draft ?? settings.source,
      ),
      sourceLabel: settings.source ? "Source" : undefined,
      destinations,
      sourceInvalid:
        settings.draft !== null &&
        (settings.draft.width !== 1 || settings.draft.height !== 1),
      destination: settings.destination
        ? getBlockRegionSelection(inspection, componentIndex, {
            ...settings.destination,
            width: 1,
            height: 1,
          })
        : null,
      destinationInvalid:
        operation !== null && !isBlockRepeatParameters(operation, inspection),
    };
  },
};

export class BlockRepeatController extends BlockEffectController<
  BlockRepeatSettings,
  BlockRepeatOperation
> {
  override readonly gestures = gestures;

  constructor() {
    super(
      BlockRepeatView,
      blockRepeatOperation,
      isBlockRepeatParameters,
      applyBlockRepeatOperation,
      "The block repeat parameters, component, source, or repetition count are invalid.",
    );
  }

  buildOperation(
    context: EffectOperationContext<BlockRepeatSettings>,
  ): Result<BlockRepeatOperation> {
    const operation = getBlockRepeatOperation(context);
    if (!operation) {
      return failure({
        code: "INVALID_INPUT",
        message:
          "Drag to select one source block, then drag from it to a destination block.",
      });
    }
    return isBlockRepeatParameters(operation, context.inspection)
      ? success(operation)
      : failure({
          code: "INVALID_INPUT",
          message: "The current block-repeat settings are invalid.",
        });
  }
}

export const BlockRepeatEffect = new BlockRepeatController();
