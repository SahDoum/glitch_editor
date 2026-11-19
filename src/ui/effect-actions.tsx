export function EffectActions({
  onApply,
  onPreview,
  disabled,
  isPreviewing = false,
  prompt,
}: {
  readonly onApply: () => void;
  readonly onPreview?: () => void;
  readonly disabled: boolean;
  readonly isPreviewing?: boolean;
  readonly prompt?: string;
}) {
  return (
    <div className="effect-actions">
      {onPreview && !prompt && (
        <button
          className="operation-button secondary"
          type="button"
          disabled={disabled || isPreviewing}
          onClick={onPreview}
        >
          Show preview
        </button>
      )}
      {prompt ? (
        <span role="status">{prompt}</span>
      ) : (
        <button
          className="operation-button"
          type="button"
          disabled={disabled}
          onClick={onApply}
        >
          Apply
        </button>
      )}
    </div>
  );
}
