import type { JpegSelectionGrid } from "../jpeg/block-geometry";
import {
  getMaskToolView,
  type CanvasToolControlsProps,
} from "../features/canvas-tools/registry";
import type { MaskTool } from "../features/canvas-tools/types";
import type { EffectTopBarAction } from "../features/effects/types";
import { RadioChoiceGroup } from "./tool-controls";

export interface CanvasToolbarProps {
  /** Tools declared by the active effect's view. */
  readonly tools: readonly MaskTool[];
  readonly activeTool: MaskTool | null;
  readonly enabledTools: ReadonlySet<MaskTool>;
  readonly suggestedTools: ReadonlySet<MaskTool>;
  readonly showSnapGrid: boolean;
  /** Effect-specific actions declared by the active effect's view. */
  readonly actions: readonly EffectTopBarAction<object>[];
  readonly controls: CanvasToolControlsProps;
  readonly maskGrid: JpegSelectionGrid;
  readonly onChangeMaskGrid: (grid: JpegSelectionGrid) => void;
  readonly onSelectTool: (tool: MaskTool) => void;
  readonly onAction: (action: EffectTopBarAction<object>) => void;
}

export function CanvasToolbar({
  tools,
  activeTool,
  enabledTools,
  suggestedTools,
  showSnapGrid,
  actions,
  controls,
  maskGrid,
  onChangeMaskGrid,
  onSelectTool,
  onAction,
}: CanvasToolbarProps) {
  const view = activeTool ? getMaskToolView(activeTool) : null;
  const Controls = view?.Controls;
  return (
    <nav className="preview-toolbar-tools" aria-label="Canvas tools">
      {tools.map((id) => {
        const tool = getMaskToolView(id);
        const enabled = enabledTools.has(id);
        const isSuggested = suggestedTools.has(id);
        return (
          <button
            className={`tool-button ${activeTool === id ? "is-active" : ""} ${isSuggested ? "is-suggested" : ""}`}
            key={id}
            type="button"
            disabled={!enabled}
            aria-label={tool.label}
            aria-pressed={activeTool === id}
            aria-keyshortcuts={tool.shortcut}
            title={
              isSuggested
                ? `Create an area selection with ${tool.label} (${tool.shortcut})`
                : enabled
                  ? `${tool.label} (${tool.shortcut})`
                  : `Select a mask-based effect to enable ${tool.label}`
            }
            onClick={() => onSelectTool(id)}
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
              {tool.iconPaths.map((path) => (
                <path
                  d={path}
                  key={path}
                  strokeDasharray={tool.dashed ? "3 3" : undefined}
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
      {(Controls || (view?.snapGrid && showSnapGrid)) && (
        <div
          className="canvas-tool-context"
          aria-label="Selection tool settings"
        >
          {Controls && <Controls {...controls} />}
          {view?.snapGrid && showSnapGrid && (
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
