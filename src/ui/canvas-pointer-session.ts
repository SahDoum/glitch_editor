import type {
  CanvasGesture,
  CanvasPointerInput,
} from "../features/canvas-tools/types";

interface PointerOwner {
  readonly pointerId: number;
  readonly gesture: CanvasGesture;
  readonly release: () => void;
}

/** One owner from pointerdown until the session is detached on up or cancel. */
export class CanvasPointerSession {
  private owner: PointerOwner | null = null;

  get isActive() {
    return this.owner !== null;
  }

  accepts(pointerId: number) {
    return !this.owner || this.owner.pointerId === pointerId;
  }

  begin(
    pointerId: number,
    gesture: CanvasGesture,
    capture: () => void,
    release: () => void,
  ) {
    if (this.owner) return false;
    this.owner = { pointerId, gesture, release };
    try {
      capture();
      return true;
    } catch (error) {
      this.cancel(pointerId);
      if (!(error instanceof DOMException) || error.name !== "NotFoundError")
        throw error;
      return false;
    }
  }

  move(pointerId: number, input: CanvasPointerInput) {
    if (this.owner?.pointerId === pointerId) this.owner.gesture.move(input);
  }

  end(pointerId: number, input: CanvasPointerInput) {
    const owner = this.take(pointerId);
    if (!owner) return;
    try {
      owner.gesture.end(input);
    } finally {
      owner.release();
    }
  }

  cancel(pointerId?: number) {
    const owner = this.take(pointerId);
    if (!owner) return;
    try {
      owner.gesture.cancel();
    } finally {
      owner.release();
    }
  }

  private take(pointerId?: number) {
    if (pointerId !== undefined && this.owner?.pointerId !== pointerId)
      return null;
    const owner = this.owner;
    this.owner = null;
    return owner;
  }
}
