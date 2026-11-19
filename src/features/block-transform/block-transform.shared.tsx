import type { ReactNode } from "react";
import {
  ComponentChoiceGroup,
  getChannelLabel,
} from "../../ui/component-choice-group";
import type { EffectEditor } from "../effects/types";

export function BlockTransformFrame<Settings>({
  editor,
  children,
  advanced,
  actions,
}: {
  readonly editor: EffectEditor<Settings>;
  readonly children: ReactNode;
  readonly advanced?: ReactNode;
  readonly actions?: ReactNode;
}) {
  const { inspection, componentIndex, componentLabels } = editor;
  return (
    <section className="inspector-section">
      {children}
      <p className="channel-readout">
        Channel ·{" "}
        {getChannelLabel(
          inspection.components,
          componentIndex,
          componentLabels,
        )}
      </p>
      <details className="advanced-controls">
        <summary>Advanced settings</summary>
        <div className="advanced-control-content">
          <ComponentChoiceGroup
            name="block-transform-component"
            inspection={inspection}
            componentLabels={componentLabels}
            value={componentIndex}
            onChange={editor.onChangeComponent}
          />
          {advanced}
        </div>
      </details>
      {actions}
    </section>
  );
}
