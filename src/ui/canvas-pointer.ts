import type { PointerEvent } from "react";
import {
  previewDimensions,
  previewPointToFrame,
} from "../application/preview-orientation";
import type {
  CanvasContext,
  CanvasGesture,
  CanvasInteraction,
  CanvasPointerInput,
  ImagePoint,
} from "../features/canvas-tools/types";
import type { JpegOrientation } from "../jpeg/orientation";

type PointerPress = Pick<
  PointerEvent<HTMLDivElement>,
  "button" | "currentTarget" | "pointerId" | "preventDefault"
>;

export function getCanvasPointerInput(
  clientPoint: ImagePoint,
  bounds: Pick<DOMRect, "left" | "top" | "width" | "height"> | undefined,
  inspection: { width: number; height: number } | undefined,
  orientation: JpegOrientation,
): CanvasPointerInput {
  if (!inspection || !bounds || bounds.width <= 0 || bounds.height <= 0) {
    return { clientPoint, image: null };
  }
  const dimensions = previewDimensions(inspection, orientation);
  const point = previewPointToFrame(
    ((clientPoint.x - bounds.left) / bounds.width) * dimensions.width,
    ((clientPoint.y - bounds.top) / bounds.height) * dimensions.height,
    inspection.width,
    inspection.height,
    orientation,
  );
  const inside =
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= inspection.width &&
    point.y <= inspection.height;
  return { clientPoint, image: { point, inside } };
}

export class CanvasPointer {
  private active: {
    pointerId: number;
    target: HTMLDivElement;
    gesture: CanvasGesture;
    interaction: CanvasInteraction;
  } | null = null;

  get isActive(): boolean {
    return this.active !== null;
  }

  owns(pointerId: number): boolean {
    return !this.active || this.active.pointerId === pointerId;
  }

  begin(
    event: PointerPress,
    input: CanvasPointerInput,
    context: CanvasContext,
    interaction: CanvasInteraction | undefined,
    spacePan: boolean,
    setPanning: (panning: boolean) => void,
  ): void {
    if (this.active || (event.button !== 0 && event.button !== 1)) return;
    const owner =
      event.button === 1 || spacePan
        ? new CanvasPan(event.currentTarget, setPanning)
        : interaction;
    if (!owner) return;
    const gesture = owner.begin(input, context);
    if (!gesture) return;
    const { currentTarget: target, pointerId } = event;
    try {
      target.setPointerCapture(pointerId);
    } catch {
      gesture.cancel();
      return;
    }
    this.active = { pointerId, target, gesture, interaction: owner };
    event.preventDefault();
  }

  move(
    pointerId: number,
    input: CanvasPointerInput,
    context: CanvasContext,
    interaction: CanvasInteraction | undefined,
  ): void {
    if (!this.owns(pointerId)) return;
    this.active?.gesture.move(input);
    (this.active?.interaction ?? interaction)?.hover?.(input.image, context);
  }

  leave(
    pointerId: number,
    context: CanvasContext,
    interaction: CanvasInteraction | undefined,
  ): void {
    if (!this.owns(pointerId)) return;
    (this.active?.interaction ?? interaction)?.hover?.(null, context);
  }

  end(pointerId: number, input: CanvasPointerInput): void {
    this.finish(pointerId, (gesture) => gesture.end(input));
  }

  cancel(pointerId?: number): void {
    this.finish(pointerId, (gesture) => gesture.cancel());
  }

  private finish(
    pointerId: number | undefined,
    finish: (gesture: CanvasGesture) => void,
  ): void {
    const active = this.active;
    if (!active || (pointerId !== undefined && active.pointerId !== pointerId))
      return;
    this.active = null;
    try {
      finish(active.gesture);
    } finally {
      if (active.target.hasPointerCapture(active.pointerId)) {
        active.target.releasePointerCapture(active.pointerId);
      }
    }
  }
}

class CanvasPan implements CanvasInteraction {
  constructor(
    private readonly stage: HTMLDivElement,
    private readonly setPanning: (panning: boolean) => void,
  ) {}

  getHint(): null {
    return null;
  }

  begin(
    { clientPoint: start }: CanvasPointerInput,
    context: CanvasContext,
  ): CanvasGesture {
    const { stage, setPanning } = this;
    const { scrollLeft, scrollTop } = stage;
    context.publish({ hoverPoint: null });
    setPanning(true);
    const finish = () => setPanning(false);
    return {
      move({ clientPoint }) {
        stage.scrollLeft = scrollLeft - (clientPoint.x - start.x);
        stage.scrollTop = scrollTop - (clientPoint.y - start.y);
      },
      end: finish,
      cancel: finish,
    };
  }
}
