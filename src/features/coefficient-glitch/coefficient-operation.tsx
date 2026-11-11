import type { CoefficientGlitchMode } from "../../operations/jpeg-glitch";
import { field } from "../effects/operation-fields";
import type { OperationDescriptor } from "../effects/types";

/** History presentation for effects that record `coefficients` operations. */
export function createCoefficientOperationDescriptor(
  modes: readonly CoefficientGlitchMode[],
): OperationDescriptor {
  return {
    kinds: ["coefficients"],
    title: "Coefficient glitch",
    matches: (parameters) => modes.some((mode) => mode === parameters.mode),
    describe: (parameters) => (
      <>
        {field(parameters, "mode")} {field(parameters, "domain")} · Component{" "}
        {field(parameters, "componentIndex")} ·{" "}
        {field(parameters, "frequencyBand")} · strength{" "}
        {field(parameters, "strength")} · seed {field(parameters, "seed")}
      </>
    ),
  };
}
