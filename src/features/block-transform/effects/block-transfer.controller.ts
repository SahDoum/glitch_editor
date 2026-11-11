import { applyBlockTransferOperation } from "../../../application/jpeg-document";
import { blockTransferOperation } from "../../../jpeg/codec-controllers/operations";
import {
  clipJpegBlockRegionToGrid,
  getJpegComponentBlockGrid,
} from "../../../jpeg/block-geometry";
import type { JpegInspection } from "../../../jpeg/inspect";
import {
  isBlockTransferParameters,
  MAX_BLOCK_TRANSFER_BLOCKS,
  type BlockTransferOperation,
} from "../../../operations/jpeg-glitch";
import { failure, success, type Result } from "../../../shared/result";
import type {
  EffectGesture,
  EffectGestureController,
  EffectOperationContext,
  GestureContext,
  GestureOutcome,
  GestureOverlay,
} from "../../effects/types";
import { BlockEffectController } from "../block-effect-controller";
import {
  getBlockRegionFromDrag,
  getBlockRegionSelection,
  getComponentBlockPoint,
  type BlockPoint,
} from "../block-geometry-helpers";
import {
  BlockTransferView,
  type BlockTransferSettings,
} from "./block-transfer.view";

type Context = GestureContext<BlockTransferSettings>;
type Outcome = GestureOutcome<BlockTransferSettings>;

/** Copy clips to the destination grid; swap keeps the exact region size. */
function getBlockTransferOperation(
  inspection: JpegInspection,
  componentIndex: number,
  settings: BlockTransferSettings,
  destination: BlockPoint,
): BlockTransferOperation | null {
  const component = inspection.components[componentIndex];
  const source = settings.source;
  if (!component || !source) return null;
  let { width, height } = source;
  if (settings.action === "copy") {
    const grid = getJpegComponentBlockGrid(inspection, component.id);
    if (!grid) return null;
    width = Math.min(width, grid.columns - destination.x);
    height = Math.min(height, grid.rows - destination.y);
  }
  if (width <= 0 || height <= 0) return null;
  return {
    kind: blockTransferOperation.kind,
    componentIndex,
    sourceX: source.x,
    sourceY: source.y,
    width,
    height,
    destinationX: destination.x,
    destinationY: destination.y,
    mode: settings.mode,
    action: settings.action,
  };
}

function sourceGesture(start: {
  x: number;
  y: number;
}): EffectGesture<BlockTransferSettings> {
  const dragOptions = { allowOversized: true, clipToImage: true };
  return {
    move(context, point, inside): Outcome {
      const region = getBlockRegionFromDrag(
        context.inspection,
        context.componentIndex,
        start,
        point,
        dragOptions,
      );
      return region.ok
        ? { patch: { draft: region.value, draftOutOfBounds: !inside } }
        : {
            patch: { draft: null, draftOutOfBounds: !inside },
            error: region.error.message,
          };
    },
    end(context, point): Outcome {
      const cleared = { draft: null, draftOutOfBounds: false };
      if (!point) return { patch: cleared };
      const region = getBlockRegionFromDrag(
        context.inspection,
        context.componentIndex,
        start,
        point,
        dragOptions,
      );
      return region.ok
        ? {
            patch: { ...cleared, source: region.value, destination: null },
            error: "",
          }
        : { patch: cleared, error: region.error.message };
    },
    cancel: () => ({ draft: null, draftOutOfBounds: false }),
  };
}

function destinationGesture(): EffectGesture<BlockTransferSettings> {
  return {
    move(context, point): Outcome {
      const block = getComponentBlockPoint(
        context.inspection,
        context.componentIndex,
        point,
      );
      return { patch: { destination: block.ok ? block.value : null } };
    },
    end(context, point): Outcome {
      if (!point) return {};
      const block = getComponentBlockPoint(
        context.inspection,
        context.componentIndex,
        point,
      );
      if (!block.ok) return { error: block.error.message };
      const operation = getBlockTransferOperation(
        context.inspection,
        context.componentIndex,
        context.settings,
        block.value,
      );
      return {
        patch: { destination: block.value },
        apply:
          operation !== null &&
          isBlockTransferParameters(operation, context.inspection),
      };
    },
    cancel: () => ({}),
  };
}

const gestures: EffectGestureController<BlockTransferSettings> = {
  begin(context: Context, point) {
    const block = getComponentBlockPoint(
      context.inspection,
      context.componentIndex,
      point,
    );
    if (!block.ok)
      return { gesture: null, outcome: { error: block.error.message } };
    if (!context.settings.source) {
      return {
        gesture: sourceGesture(point),
        outcome: {
          patch: {
            draft: { x: block.value.x, y: block.value.y, width: 1, height: 1 },
            destination: null,
            draftOutOfBounds: false,
          },
        },
      };
    }
    return {
      gesture: destinationGesture(),
      outcome: { patch: { destination: block.value } },
    };
  },
  getOverlay(context: Context): GestureOverlay | null {
    const { settings, inspection, componentIndex } = context;
    const shownSource = settings.draft ?? settings.source;
    const sourceInvalid =
      settings.draftOutOfBounds ||
      (shownSource !== null &&
        shownSource.width * shownSource.height > MAX_BLOCK_TRANSFER_BLOCKS);
    const component = inspection.components[componentIndex];
    const operation = settings.destination
      ? getBlockTransferOperation(
          inspection,
          componentIndex,
          settings,
          settings.destination,
        )
      : null;
    const destinationRegion =
      component && settings.source && settings.destination
        ? clipJpegBlockRegionToGrid(
            inspection,
            component.id,
            operation
              ? {
                  x: operation.destinationX,
                  y: operation.destinationY,
                  width: operation.width,
                  height: operation.height,
                }
              : {
                  ...settings.destination,
                  width: settings.source.width,
                  height: settings.source.height,
                },
          )
        : null;
    return {
      source: getBlockRegionSelection(inspection, componentIndex, shownSource),
      sourceInvalid,
      destination: getBlockRegionSelection(
        inspection,
        componentIndex,
        destinationRegion,
      ),
      destinationInvalid:
        settings.destination !== null &&
        (sourceInvalid ||
          !operation ||
          !isBlockTransferParameters(operation, inspection)),
    };
  },
};

export class BlockTransferController extends BlockEffectController<
  BlockTransferSettings,
  BlockTransferOperation
> {
  override readonly gestures = gestures;

  constructor() {
    super(
      BlockTransferView,
      blockTransferOperation,
      isBlockTransferParameters,
      applyBlockTransferOperation,
      "The block transfer must use equal-size, in-bounds regions in one component.",
    );
  }

  buildOperation({
    settings,
    inspection,
    componentIndex,
  }: EffectOperationContext<BlockTransferSettings>): Result<BlockTransferOperation> {
    const operation = settings.destination
      ? getBlockTransferOperation(
          inspection,
          componentIndex,
          settings,
          settings.destination,
        )
      : null;
    if (!operation || !isBlockTransferParameters(operation, inspection)) {
      return failure({
        code: "INVALID_INPUT",
        message:
          "Drag to select a source region, then drag to a valid destination.",
      });
    }
    return success(operation);
  }
}

export const BlockTransferEffect = new BlockTransferController();
