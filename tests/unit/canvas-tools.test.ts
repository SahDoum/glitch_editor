import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { createCanvasToolControllers } from "../../src/features/canvas-tools/registry";
import type {
  CanvasContext,
  CanvasFeedback,
  CanvasInteraction,
  CanvasKeyInput,
  CanvasPointerInput,
} from "../../src/features/canvas-tools/types";
import { inspectJpeg } from "../../src/jpeg/inspect";
import {
  CanvasPointer,
  getCanvasPointerInput,
} from "../../src/ui/canvas-pointer";

async function canvasContext(options: Partial<CanvasContext> = {}) {
  const bytes = await readFile(
    new URL("../fixtures/synthetic-color-odd-420.jpg", import.meta.url),
  );
  const inspection = inspectJpeg(bytes);
  if (!inspection.ok) throw new Error(inspection.error.message);
  let keyboardCursor: CanvasContext["keyboardCursor"] = null;
  const publish = vi.fn((feedback: CanvasFeedback) => {
    if (feedback.keyboardCursor !== undefined)
      keyboardCursor = feedback.keyboardCursor;
  });
  const context: CanvasContext = {
    inspection: inspection.value,
    componentIndex: 0,
    grid: "dct",
    brushSize: 4,
    orientation: 1,
    get keyboardCursor() {
      return keyboardCursor;
    },
    cancelGesture: vi.fn(),
    publish,
    ...options,
  };
  return { context, publish };
}

function pointer(x: number, y: number, inside = true): CanvasPointerInput {
  const point = { x, y };
  return { clientPoint: point, image: { point, inside } };
}

function captureTarget() {
  const captures = new Set<number>();
  return {
    scrollLeft: 0,
    scrollTop: 0,
    setPointerCapture: vi.fn((id: number) => {
      captures.add(id);
    }),
    hasPointerCapture: (id: number) => captures.has(id),
    releasePointerCapture: vi.fn((id: number) => {
      captures.delete(id);
    }),
  };
}

function press(
  target: ReturnType<typeof captureTarget>,
  pointerId: number,
  button = 0,
) {
  return {
    currentTarget: target as unknown as HTMLDivElement,
    pointerId,
    button,
    preventDefault: vi.fn(),
  };
}

function tool(id: string) {
  const controller = createCanvasToolControllers().get(id);
  if (!controller) throw new Error(`Missing tool ${id}`);
  return controller;
}

function key(
  key: string,
  options: Partial<CanvasKeyInput> = {},
): CanvasKeyInput {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    canvasFocused: true,
    pointerActive: false,
    ...options,
  };
}

describe("canvas interactions", () => {
  it("uses frame coordinates at zoomed bounds and preserves outside samples", async () => {
    const {
      context: { inspection },
    } = await canvasContext();
    const bounds = {
      left: 50,
      top: 25,
      width: inspection.height * 3,
      height: inspection.width * 3,
    };
    expect(
      getCanvasPointerInput({ x: 50, y: 25 }, bounds, inspection, 6).image,
    ).toEqual({
      inside: true,
      point: { x: 0, y: inspection.height },
    });
    expect(
      getCanvasPointerInput({ x: 47, y: 25 }, bounds, inspection, 6).image,
    ).toEqual({
      inside: false,
      point: { x: 0, y: inspection.height + 1 },
    });
  });

  it.each([
    ["dct", 0, 8],
    ["dct", 1, 16],
    ["mcu", 0, 16],
  ] as const)(
    "clips a rectangle and snaps it using %s component %s",
    async (grid, componentIndex, width) => {
      const { context, publish } = await canvasContext({
        grid,
        componentIndex,
      });
      const gesture = tool("select").begin(pointer(-5, -6, false), context);
      if (!gesture) throw new Error("Expected an active Select gesture.");
      gesture.move(pointer(5, 6));
      expect(publish).toHaveBeenLastCalledWith(
        expect.objectContaining({
          draft: {
            kind: "rectangle",
            selection: expect.objectContaining({ x: 0, y: 0, width }),
          },
        }),
      );
      gesture.end(pointer(5, 6));
      expect(publish).toHaveBeenLastCalledWith(
        expect.objectContaining({
          draft: null,
          selection: {
            autoApply: true,
            mask: expect.objectContaining({
              shapes: [expect.objectContaining({ x: 0, y: 0, width })],
            }),
          },
        }),
      );
    },
  );

  it("clears the rectangle draft without committing a zero-area selection", async () => {
    const { context, publish } = await canvasContext();
    const gesture = tool("select").begin(pointer(1, 3), context);
    if (!gesture) throw new Error("Expected an active Select gesture.");
    gesture.end(pointer(1, 3));
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ draft: null, selection: undefined }),
    );
  });

  it("runs keyboard selection through the active Select tool", async () => {
    const { context, publish } = await canvasContext({ orientation: 6 });
    const select = tool("select");
    select.focus?.(context);
    const initial = context.keyboardCursor;
    if (!initial) throw new Error("Expected a keyboard cursor.");
    expect(select.handleKey?.(key("Enter"), context)).toBe(true);
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        draft: {
          kind: "rectangle",
          selection: expect.objectContaining({
            x: initial.imageX,
            y: initial.imageY,
          }),
        },
      }),
    );
    expect(select.handleKey?.(key("ArrowRight"), context)).toBe(true);
    expect(context.keyboardCursor?.blockY).toBe(initial.blockY - 1);
    expect(select.handleKey?.(key("Enter"), context)).toBe(true);
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        draft: null,
        selection: {
          autoApply: true,
          mask: expect.objectContaining({
            shapes: [expect.objectContaining({ kind: "rectangle", y: 0 })],
          }),
        },
      }),
    );
    expect(select.handleKey?.(key("Escape"), context)).toBe(true);
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        draft: null,
        selection: { autoApply: false, mask: null },
      }),
    );
  });

  it("uses the whole-image command from All and Select All without auto-apply", async () => {
    const { context, publish } = await canvasContext();
    const shape = expect.objectContaining({
      x: 0,
      y: 0,
      width: context.inspection.width,
      height: context.inspection.height,
    });
    const fullImage = expect.objectContaining({
      selection: {
        autoApply: false,
        mask: expect.objectContaining({ shapes: [shape] }),
      },
    });
    const all = tool("all");
    all.activate?.(context);
    expect(publish).toHaveBeenLastCalledWith(fullImage);
    expect(all.begin(pointer(3, 3), context)).toBeNull();

    expect(
      tool("select").handleKey?.(
        key("a", { ctrlKey: true, canvasFocused: false }),
        context,
      ),
    ).toBe(true);
    expect(context.cancelGesture).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenLastCalledWith(fullImage);
  });

  it("preserves a gap between sampled brush segments in the final mask", async () => {
    const { context, publish } = await canvasContext();
    const brush = tool("brush");
    expect(brush.begin(pointer(1, 1, false), context)).toBeNull();
    const gesture = brush.begin(pointer(1, 1), context);
    if (!gesture) throw new Error("Expected brush gesture.");
    gesture.move(pointer(-1, 0, false));
    gesture.move(pointer(16, 1));
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({
          kind: "brush",
          strokes: [[{ x: 4, y: 4 }], [{ x: 16.5, y: 4 }]],
        }),
      }),
    );
    gesture.end(pointer(16, 1));
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selection: {
          autoApply: true,
          mask: expect.objectContaining({
            shapes: [
              expect.objectContaining({
                kind: "brush",
                points: [
                  { x: 4, y: 4 },
                  { x: 16.5, y: 4 },
                ],
              }),
            ],
          }),
        },
      }),
    );
  });

  it("drives an additional registered controller through the same command and pointer lifecycle", async () => {
    const { context, publish } = await canvasContext();
    const target = captureTarget();
    const router = new CanvasPointer();
    const gesture = { move: vi.fn(), end: vi.fn(), cancel: vi.fn() };
    const begin = vi.fn(() => gesture);
    const hover = vi.fn();
    class AdditionalTool implements CanvasInteraction {
      begin = begin;
      hover = hover;
      activate(context: CanvasContext) {
        context.publish({ announcement: "Additional tool active." });
      }
      getHint() {
        return { text: "Additional tool hint." };
      }
    }
    const registry = {
      extra: {
        Controller: AdditionalTool,
        view: { label: "Extra", shortcut: "X", iconPaths: [] },
      },
    };
    const interaction = createCanvasToolControllers(registry).get("extra");
    if (!interaction) throw new Error("Expected registered tool.");
    interaction.activate?.(context);
    expect(publish).toHaveBeenCalledWith({
      announcement: "Additional tool active.",
    });
    expect(interaction.getHint(context)?.text).toBe("Additional tool hint.");
    router.begin(
      press(target, 1),
      pointer(1, 1),
      context,
      interaction,
      false,
      vi.fn(),
    );
    router.begin(
      press(target, 2),
      pointer(1, 1),
      context,
      interaction,
      false,
      vi.fn(),
    );
    router.move(2, pointer(1, 1), context, interaction);
    router.move(1, pointer(2, 3), context, interaction);
    router.end(2, pointer(4, 4));
    router.leave(1, context, interaction);
    router.end(1, pointer(7, 3));
    router.cancel(1);

    expect(begin).toHaveBeenCalledExactlyOnceWith(pointer(1, 1), context);
    expect(gesture.move).toHaveBeenCalledExactlyOnceWith(pointer(2, 3));
    expect(hover).toHaveBeenCalledTimes(2);
    expect(hover).toHaveBeenLastCalledWith(null, context);
    expect(gesture.end).toHaveBeenCalledExactlyOnceWith(pointer(7, 3));
    expect(gesture.cancel).not.toHaveBeenCalled();
    expect(target.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("captures only an accepted gesture and cancels it without allowing release to commit", async () => {
    const { context } = await canvasContext();
    const target = captureTarget();
    const router = new CanvasPointer();
    const gesture = { move: vi.fn(), end: vi.fn(), cancel: vi.fn() };
    const interaction = { begin: () => gesture, getHint: () => null };
    router.begin(
      press(target, 5),
      pointer(1, 1),
      context,
      tool("all"),
      false,
      vi.fn(),
    );
    expect(target.setPointerCapture).not.toHaveBeenCalled();
    router.begin(
      press(target, 5),
      pointer(1, 1),
      context,
      interaction,
      false,
      vi.fn(),
    );
    router.cancel(6);
    expect(router.isActive).toBe(true);
    router.cancel(5);
    router.end(5, pointer(7, 3));
    expect(gesture.cancel).toHaveBeenCalledTimes(1);
    expect(gesture.end).not.toHaveBeenCalled();
  });

  it("routes middle-button and Space drags through the pan interaction", async () => {
    const { context } = await canvasContext();
    const target = captureTarget();
    const router = new CanvasPointer();
    const setPanning = vi.fn();
    const begin = vi.fn(() => null);
    const interaction = { begin, getHint: () => null };
    router.begin(
      press(target, 1, 1),
      pointer(10, 10),
      context,
      interaction,
      false,
      setPanning,
    );
    router.move(1, pointer(5, 5), context, interaction);
    expect(target.scrollLeft).toBe(5);
    expect(target.scrollTop).toBe(5);
    router.cancel(1);
    router.begin(
      press(target, 2),
      pointer(10, 10),
      context,
      interaction,
      true,
      setPanning,
    );
    router.end(2, pointer(10, 10));
    expect(begin).not.toHaveBeenCalled();
    expect(setPanning.mock.calls).toEqual([[true], [false], [true], [false]]);
  });
});
