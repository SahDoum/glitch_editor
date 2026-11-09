import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EngravingDirectionChoice } from "../../src/ui/tool-controls";

describe("engraving direction control", () => {
  it.each([
    ["engrave-horizontal", "Horizontal"],
    ["engrave-vertical", "Vertical"],
  ] as const)("renders %s as the selected radio", (value, label) => {
    const markup = renderToStaticMarkup(
      createElement(EngravingDirectionChoice, { value, onChange: () => {} }),
    );

    expect(markup).toContain("<legend>Line direction</legend>");
    expect(markup.match(/type="radio"/g)).toHaveLength(2);
    const checkedInput = markup.match(/<input[^>]*checked=""[^>]*>/g);
    expect(checkedInput).toHaveLength(1);
    expect(checkedInput![0]).toContain(`value="${value}"`);
    expect(markup).toContain(label);
  });

  it("passes direction changes to the effect settings handler", () => {
    const onChange = vi.fn();
    const choice = EngravingDirectionChoice({
      value: "engrave-horizontal",
      onChange,
    });

    choice.props.onChange("engrave-vertical");
    expect(onChange).toHaveBeenCalledWith("engrave-vertical");
  });
});
