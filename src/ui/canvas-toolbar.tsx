import { MASK_TOOL_REGISTRY } from "../features/canvas-tools/registry";
import type { MaskToolSettingsProps } from "../features/canvas-tools/tool-views";
import type { EffectTopBarAction, MaskTool } from "../features/effects/types";

export interface CanvasToolbarProps extends MaskToolSettingsProps {
  /** Tools declared by the active effect's view. */
  readonly tools: readonly MaskTool[];
  readonly activeTool: MaskTool;
  readonly enabledTools: ReadonlySet<MaskTool>;
  readonly suggestedTools: ReadonlySet<MaskTool>;
  /** Effect-specific actions declared by the active effect's view. */
  readonly actions: readonly EffectTopBarAction<object>[];
  readonly onSelectTool: (tool: MaskTool) => void;
  readonly onAction: (action: EffectTopBarAction<object>) => void;
}

export function CanvasToolbar({
  tools,
  activeTool,
  enabledTools,
  suggestedTools,
  actions,
  onSelectTool,
  onAction,
  ...settings
}: CanvasToolbarProps) {
  const { Settings } = MASK_TOOL_REGISTRY[activeTool].view;
  return (
    <nav className="preview-toolbar-tools" aria-label="Canvas tools">
      {tools.map((id) => {
        const { label, shortcut, iconPaths, iconStrokeDasharray } =
          MASK_TOOL_REGISTRY[id].view;
        const enabled = enabledTools.has(id);
        const isSuggested = suggestedTools.has(id);
        return (
          <button
            className={`tool-button ${activeTool === id ? "is-active" : ""} ${isSuggested ? "is-suggested" : ""}`}
            key={id}
            type="button"
            disabled={!enabled}
            aria-label={label}
            aria-pressed={activeTool === id}
            aria-keyshortcuts={shortcut}
            title={
              isSuggested
                ? `Create an area selection with ${label} (${shortcut})`
                : enabled
                  ? `${label} (${shortcut})`
                  : `Select a mask-based effect to enable ${label}`
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
              {iconPaths.map((path) => (
                <path
                  d={path}
                  key={path}
                  strokeDasharray={iconStrokeDasharray}
                />
              ))}
            </svg>
            <span>{label}</span>
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
      {Settings && enabledTools.has(activeTool) && (
        <div
          className="canvas-tool-context"
          aria-label="Selection tool settings"
        >
          <Settings {...settings} />
        </div>
      )}
    </nav>
  );
}
