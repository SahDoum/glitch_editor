import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DctBasisMatrix,
  getDctFrequencyChoice,
} from "../../src/ui/dct-basis-matrix";
import { getCoefficientFrequencyChoices } from "../../src/ui/tool-controls";

describe("DCT basis matrix", () => {
  it("maps basis cells to the same DC / AC frequency zones", () => {
    expect(getDctFrequencyChoice(0, 0)).toBe("dc");
    expect(getDctFrequencyChoice(1, 1)).toBe("low");
    expect(getDctFrequencyChoice(3, 2)).toBe("mid");
    expect(getDctFrequencyChoice(7, 7)).toBe("high");
  });

  it("renders all 64 cells with DC selected for Zero and unavailable for AC-only isolation", () => {
    const zero = renderToStaticMarkup(
      createElement(DctBasisMatrix, {
        selectedChoice: "dc",
        availableChoices: getCoefficientFrequencyChoices("zero"),
        onSelect: () => {},
      }),
    );
    expect(zero.match(/role="gridcell"/g)).toHaveLength(64);
    expect(zero.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(zero).toContain('aria-label="u 0, v 0, DC" aria-pressed="true"');
    const isolation = renderToStaticMarkup(
      createElement(DctBasisMatrix, {
        selectedChoice: "low",
        availableChoices: getCoefficientFrequencyChoices("isolate"),
        onSelect: () => {},
      }),
    );
    expect(isolation).toContain(
      'aria-label="u 0, v 0, DC" aria-pressed="false" disabled=""',
    );
    expect(isolation.match(/aria-pressed="true"/g)).toHaveLength(5);
    expect(isolation).toContain("AC low");
  });
});
