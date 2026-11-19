import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { MASK_TOOL_REGISTRY } from "../features/canvas-tools/registry";
import type { KeyboardRectangle } from "../features/canvas-tools/select-tool";
import type {
  CanvasGesture,
  CanvasPointerInput,
  MaskCommitTrigger,
  MaskDraft,
  MaskToolContext,
} from "../features/canvas-tools/types";
import type { ImagePoint } from "../features/effects/types";
import type { SpatialMask } from "../document/masks";
import type {
  JpegBlockCoordinate,
  JpegSelectionGrid,
} from "../jpeg/block-geometry";
import type { JpegInspection } from "../jpeg/inspect";
import type { JpegOrientation } from "../jpeg/orientation";
import {
  clientPointToImage,
  type CanvasInteraction,
} from "./canvas-interactions";
import { CanvasPointerSession } from "./canvas-pointer-session";
import type { CanvasTool } from "./workspace-state";

interface CanvasInteractionOptions {
  readonly inspection: JpegInspection | undefined;
  readonly orientation: JpegOrientation;
  readonly tool: CanvasTool;
  readonly componentIndex: number;
  readonly grid: JpegSelectionGrid;
  readonly brushSize: number;
  readonly effectInteraction: CanvasInteraction | null;
  readonly onCommitMask: (
    mask: SpatialMask | null,
    trigger: MaskCommitTrigger,
  ) => void;
  readonly onError: (message: string) => void;
}

export function useCanvasInteraction({
  inspection,
  orientation,
  tool,
  componentIndex,
  grid,
  brushSize,
  effectInteraction,
  onCommitMask,
  onError,
}: CanvasInteractionOptions) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const bindStage = useCallback((node: HTMLDivElement | null) => {
    stageRef.current = node;
  }, []);
  const bindImage = useCallback((node: HTMLDivElement | null) => {
    imageRef.current = node;
  }, []);
  const [pointer] = useState(() => new CanvasPointerSession());
  const spacePan = useRef(false);
  const keyboard = useRef<KeyboardRectangle | null>(null);
  const commitMask = useRef(onCommitMask);
  const [draft, setDraft] = useState<MaskDraft | null>(null);
  const [brushCursor, setBrushCursor] = useState<ImagePoint | null>(null);
  const [keyboardCursor, setKeyboardCursor] =
    useState<JpegBlockCoordinate | null>(null);
  const [isCanvasFocused, setIsCanvasFocused] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [announcement, announce] = useState("");
  const maskContext: MaskToolContext | null = inspection
    ? { inspection, componentIndex, grid, brushSize }
    : null;
  const maskTool = tool === "effect" ? null : MASK_TOOL_REGISTRY[tool];
  const hint =
    effectInteraction?.getHint() ??
    (maskTool?.kind === "gesture" && maskContext
      ? maskTool.controller.getHint(maskContext)
      : null);

  useLayoutEffect(() => {
    commitMask.current = onCommitMask;
  }, [onCommitMask]);

  useEffect(() => {
    function onWindowBlur() {
      spacePan.current = false;
      pointer.cancel();
      setBrushCursor(null);
    }

    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("blur", onWindowBlur);
      pointer.cancel();
    };
  }, [pointer]);

  function cancel() {
    pointer.cancel();
    keyboard.current = null;
    setDraft(null);
    setBrushCursor(null);
    setKeyboardCursor(null);
  }

  function toInput(event: PointerEvent<HTMLDivElement>): CanvasPointerInput {
    const clientPoint = { x: event.clientX, y: event.clientY };
    const bounds = imageRef.current?.getBoundingClientRect();
    return {
      clientPoint,
      image:
        bounds && inspection
          ? clientPointToImage(clientPoint, bounds, inspection, orientation)
          : null,
    };
  }

  function beginPan({ clientPoint }: CanvasPointerInput): CanvasGesture | null {
    const stage = stageRef.current;
    if (!stage) return null;
    const { scrollLeft, scrollTop } = stage;
    setBrushCursor(null);
    setIsPanning(true);
    return {
      move(input) {
        stage.scrollLeft = scrollLeft - (input.clientPoint.x - clientPoint.x);
        stage.scrollTop = scrollTop - (input.clientPoint.y - clientPoint.y);
      },
      end: () => setIsPanning(false),
      cancel: () => setIsPanning(false),
    };
  }

  function beginTool(input: CanvasPointerInput): CanvasGesture | null {
    if (effectInteraction) return effectInteraction.begin(input);
    if (maskTool?.kind !== "gesture" || !maskContext || !input.image)
      return null;
    const started = maskTool.controller.begin(maskContext, input.image);
    if (!started.ok) {
      onError(started.error.message);
      return null;
    }
    const gesture = started.value;
    if (!gesture) return null;
    keyboard.current?.clear();
    setDraft(gesture.getDraft());
    return {
      move({ image }) {
        if (!image) return;
        const result = gesture.move(image);
        if (!result.ok) onError(result.error.message);
        setDraft(gesture.getDraft());
      },
      end({ image }) {
        setDraft(null);
        const result = gesture.end(image);
        if (!result.ok) onError(result.error.message);
        else if (result.value) commitMask.current(result.value, "pointer");
      },
      cancel() {
        gesture.cancel();
        setDraft(null);
      },
    };
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (pointer.isActive || (event.button !== 0 && event.button !== 1)) return;
    const input = toInput(event);
    const isPan = event.button === 1 || spacePan.current;
    const gesture = isPan ? beginPan(input) : beginTool(input);
    if (!gesture) return;

    const element = event.currentTarget;
    const { pointerId } = event;
    const captured = pointer.begin(
      pointerId,
      gesture,
      () => element.setPointerCapture(pointerId),
      () => {
        if (element.hasPointerCapture(pointerId))
          element.releasePointerCapture(pointerId);
      },
    );
    if (!captured) return;
    event.preventDefault();
    if (!isPan) imageRef.current?.focus({ preventScroll: true });
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!pointer.accepts(event.pointerId)) return;
    const input = toInput(event);
    if (tool === "brush" && !isPanning) {
      setBrushCursor(MASK_TOOL_REGISTRY.brush.controller.hover(input.image));
    }
    pointer.move(event.pointerId, input);
  }

  function onPointerLeave(event: PointerEvent<HTMLDivElement>) {
    if (pointer.accepts(event.pointerId)) setBrushCursor(null);
  }

  function onPointerCancel(event: PointerEvent<HTMLDivElement>) {
    if (!pointer.isActive || !pointer.accepts(event.pointerId)) return;
    pointer.cancel(event.pointerId);
    setBrushCursor(null);
  }

  function getKeyboard() {
    if (tool !== "select" || !maskContext) return null;
    keyboard.current ??= MASK_TOOL_REGISTRY.select.controller.beginKeyboard(
      maskContext,
      orientation,
    );
    return keyboard.current;
  }

  function onFocus() {
    setIsCanvasFocused(true);
    setKeyboardCursor(getKeyboard()?.getCursor() ?? null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (tool !== "select" || event.altKey || event.ctrlKey || event.metaKey)
      return;
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      onCommitMask(null, "command");
      announce("Selection cleared.");
      return;
    }
    if (pointer.isActive) return;
    if (event.key === "Enter" && event.repeat) {
      event.preventDefault();
      return;
    }
    const selection = getKeyboard();
    if (!selection) return;
    const result =
      event.key === "Enter" ? selection.confirm() : selection.move(event.key);
    if (!result) return;

    event.preventDefault();
    setKeyboardCursor(selection.getCursor());
    if (!result.ok) {
      onError(result.error.message);
      return;
    }
    setDraft(result.value.draft);
    if (result.value.mask) {
      onCommitMask(result.value.mask, "keyboard");
    }
    announce(result.value.announcement);
  }

  return {
    bindStage,
    bindImage,
    pointerHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: PointerEvent<HTMLDivElement>) =>
        pointer.end(event.pointerId, toInput(event)),
      onPointerLeave,
      onPointerCancel,
      onLostPointerCapture: onPointerCancel,
    },
    keyboardHandlers: {
      onFocus,
      onBlur: () => setIsCanvasFocused(false),
      onKeyDown,
    },
    cancel,
    setSpacePan: (active: boolean) => {
      spacePan.current = active;
    },
    draft,
    brushCursor,
    keyboardCursor:
      isCanvasFocused && tool === "select" && maskContext
        ? (keyboardCursor ??
          MASK_TOOL_REGISTRY.select.controller.getInitialCursor(maskContext))
        : null,
    isPanning,
    hint,
    announcement,
    announce,
  };
}
