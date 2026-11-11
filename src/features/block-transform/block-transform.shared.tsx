import type { ReactNode } from "react";
import { ComponentChoiceGroup } from "../../ui/component-choice-group";
import type { EffectEditor } from "../effects/types";

/** Shared chrome of the block effects: mask note, component, auto-apply. */
export function BlockTransformFrame<Settings>({
  editor,
  requiresMask,
  children,
}: {
  readonly editor: EffectEditor<Settings>;
  readonly requiresMask: boolean;
  readonly children: ReactNode;
}) {
  return (
    <section className="inspector-section">
      {requiresMask && !editor.hasMask && (
        <p className="selection-required" role="status">
          Select an area to apply this effect. Brush and Select are available in
          the canvas toolbar.
        </p>
      )}
      <ComponentChoiceGroup
        name="block-transform-component"
        inspection={editor.inspection}
        componentLabels={editor.componentLabels}
        value={editor.componentIndex}
        onChange={editor.onChangeComponent}
      />
      {requiresMask && (
        <label className="coefficient-note effect-auto-apply">
          <input
            type="checkbox"
            checked={editor.autoApply}
            disabled={editor.autoApplyDisabled}
            onChange={(event) =>
              editor.onChangeAutoApply(event.currentTarget.checked)
            }
          />{" "}
          Apply while painting
        </label>
      )}
      {children}
    </section>
  );
}
