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
  readonly autoApply: boolean;
  readonly onAutoApplyChange?: (checked: boolean) => void;
  readonly hasArea: boolean;
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
  autoApply,
  onAutoApplyChange,
  hasArea,
  maskGrid,
  onChangeMaskGrid,
  onSelectTool,
  onAction,
}: CanvasToolbarProps) {
  const view = activeTool ? getMaskToolView(activeTool) : null;
  const Controls = view?.Controls;
  return (
    <div className="canvas-control-rows">
      {tools.length > 0 && (
        <div className="preview-toolbar-tools" role="group" aria-label="Area">
          <span className="area-label">Area</span>
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
        </div>
      )}
      {actions.length > 0 && (
        <div className="preview-toolbar-tools">
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
        </div>
      )}
      {(activeTool === "brush" || activeTool === "select") && (
        <div
          className="canvas-tool-context"
          aria-label="Selection tool settings"
        >
          {Controls && <Controls {...controls} />}
          {onAutoApplyChange && (
            <label className="effect-auto-apply">
              <input
                type="checkbox"
                checked={autoApply}
                onChange={(event) =>
                  onAutoApplyChange(event.currentTarget.checked)
                }
              />
              {activeTool === "brush"
                ? "Apply after each stroke"
                : "Apply after selection"}
            </label>
          )}
          {view?.snapGrid && showSnapGrid && (
            <details className="canvas-menu">
              <summary className="tool-toggle">Snap</summary>
              <div className="canvas-popover">
                <RadioChoiceGroup<JpegSelectionGrid>
                  name="canvas-mask-snap-grid"
                  legend="Area alignment"
                  value={maskGrid}
                  options={[
                    { value: "dct", label: "Snap to blocks" },
                    { value: "mcu", label: "Snap to MCUs" },
                  ]}
                  onChange={onChangeMaskGrid}
                  layout="inline"
                  showCheckmark={false}
                />
              </div>
            </details>
          )}
          {activeTool === "brush" && hasArea && !autoApply && (
            <span className="canvas-area-note">
              A new stroke replaces the current area.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
