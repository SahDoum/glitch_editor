import type { JpegSelectionGrid } from "../jpeg/block-geometry";
import type {
  EffectTopBarAction,
  MaskTool,
  MaskToolDeclaration,
} from "../features/effects/types";
import { RadioChoiceGroup } from "./tool-controls";

export interface CanvasToolbarProps {
  /** Tools declared by the active effect's view. */
  readonly tools: readonly MaskToolDeclaration[];
  readonly activeTool: MaskTool;
  readonly enabledTools: ReadonlySet<MaskTool>;
  readonly suggestedTools: ReadonlySet<MaskTool>;
  readonly showSnapGrid: boolean;
  /** Effect-specific actions declared by the active effect's view. */
  readonly actions: readonly EffectTopBarAction<object>[];
  readonly brushSize: number;
  readonly onChangeBrushSize: (size: number) => void;
  readonly maskGrid: JpegSelectionGrid;
  readonly onChangeMaskGrid: (grid: JpegSelectionGrid) => void;
  readonly onSelectTool: (tool: MaskTool) => void;
  readonly onAction: (action: EffectTopBarAction<object>) => void;
}

const TOOL_ICON_PATHS: Readonly<Record<MaskTool, readonly string[]>> = {
  all: ["M5 3h10l4 4v14H5z", "M15 3v5h4"],
  brush: ["m4 16 9-9 4 4-9 9H4v-4Z", "m12 8 3-3 4 4-3 3", "M4 21h7"],
  select: ["M4 4h16v16H4z"],
};

export function CanvasToolbar({
  tools,
  activeTool,
  enabledTools,
  suggestedTools,
  showSnapGrid,
  actions,
  brushSize,
  onChangeBrushSize,
  maskGrid,
  onChangeMaskGrid,
  onSelectTool,
  onAction,
}: CanvasToolbarProps) {
  return (
    <nav className="preview-toolbar-tools" aria-label="Canvas tools">
      {tools.map((tool) => {
        const enabled = enabledTools.has(tool.id);
        const isSuggested = suggestedTools.has(tool.id);
        return (
          <button
            className={`tool-button ${activeTool === tool.id ? "is-active" : ""} ${isSuggested ? "is-suggested" : ""}`}
            key={tool.id}
            type="button"
            disabled={!enabled}
            aria-label={tool.label}
            aria-pressed={activeTool === tool.id}
            aria-keyshortcuts={tool.shortcut}
            title={
              isSuggested
                ? `Create an area selection with ${tool.label} (${tool.shortcut})`
                : enabled
                  ? `${tool.label} (${tool.shortcut})`
                  : `Select a mask-based effect to enable ${tool.label}`
            }
            onClick={() => onSelectTool(tool.id)}
          >
            <svg
              className="tool-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {TOOL_ICON_PATHS[tool.id].map((path) => (
                <path
                  d={path}
                  key={path}
                  strokeDasharray={tool.id === "select" ? "3 3" : undefined}
                />
              ))}
            </svg>
            <span>{tool.label}</span>
          </button>
        );
      })}
      {actions.map((action) => (
        <button
          className="tool-button effect-top-bar-action"
          key={action.id}
          type="button"
          disabled={action.disabled}
          title={
            action.shortcut
              ? `${action.title} (${action.shortcut})`
              : action.title
          }
          aria-keyshortcuts={action.shortcut}
          onClick={() => onAction(action)}
        >
          <span>{action.label}</span>
        </button>
      ))}
      {(activeTool === "brush" || activeTool === "select") && (
        <div
          className="canvas-tool-context"
          aria-label="Selection tool settings"
        >
          {activeTool === "brush" && (
            <label className="canvas-context-field">
              <span>Brush · {brushSize} image px</span>
              <input
                type="range"
                min="4"
                max="256"
                step="4"
                value={brushSize}
                onChange={(event) =>
                  onChangeBrushSize(Number(event.currentTarget.value))
                }
              />
            </label>
          )}
          {showSnapGrid && (
            <RadioChoiceGroup<JpegSelectionGrid>
              name="canvas-mask-snap-grid"
              legend="Snap"
              value={maskGrid}
              options={[
                { value: "dct", label: "DCT" },
                { value: "mcu", label: "MCU" },
              ]}
              onChange={onChangeMaskGrid}
              layout="inline"
              showCheckmark={false}
            />
          )}
        </div>
      )}
    </nav>
  );
}
