import {
  MAX_GLITCH_OPERATIONS,
  type JpegGlitchOperation,
} from "../../operations/jpeg-glitch";
import type { JpegBlockGeometry } from "../block-geometry";
import type { OperationController } from "./controller";
import {
  blockPermutationOperation,
  blockRepeatOperation,
  blockShiftOperation,
  blockTransferOperation,
  coefficientOperation,
  quantizationOperation,
} from "./operations";

export const workerOperations = {
  [coefficientOperation.kind]: coefficientOperation,
  [blockRepeatOperation.kind]: blockRepeatOperation,
  [blockPermutationOperation.kind]: blockPermutationOperation,
  [blockShiftOperation.kind]: blockShiftOperation,
  [blockTransferOperation.kind]: blockTransferOperation,
  [quantizationOperation.kind]: quantizationOperation,
} satisfies Record<JpegGlitchOperation["kind"], OperationController>;

export function getOperationController(
  kind: unknown,
): OperationController | undefined {
  return typeof kind === "string" &&
    Object.prototype.hasOwnProperty.call(workerOperations, kind)
    ? workerOperations[kind as JpegGlitchOperation["kind"]]
    : undefined;
}

export function isOperationList(
  value: unknown,
  geometry: JpegBlockGeometry,
): value is readonly JpegGlitchOperation[] {
  if (!Array.isArray(value) || value.length > MAX_GLITCH_OPERATIONS)
    return false;
  let work = 0;
  for (const operation of value) {
    if (typeof operation !== "object" || operation === null) return false;
    const controller = getOperationController(Reflect.get(operation, "kind"));
    if (!controller || !controller.isOperation(operation, geometry))
      return false;
    work += controller.getWorkSize(geometry, operation);
    if (work > 8 * 1024 * 1024) return false;
  }
  return true;
}

export function isJpegBlockGeometry(
  value: unknown,
): value is JpegBlockGeometry {
  if (typeof value !== "object" || value === null) return false;
  const width = Reflect.get(value, "width");
  const height = Reflect.get(value, "height");
  const components: unknown = Reflect.get(value, "components");
  if (
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    !Number.isSafeInteger(height) ||
    height <= 0 ||
    width * height > 40_000_000 ||
    !Array.isArray(components) ||
    (components.length !== 1 && components.length !== 3)
  )
    return false;
  return components.every((component: unknown) => {
    if (typeof component !== "object" || component === null) return false;
    const id = Reflect.get(component, "id");
    const h = Reflect.get(component, "horizontalSampling");
    const v = Reflect.get(component, "verticalSampling");
    const table = Reflect.get(component, "quantizationTable");
    return (
      Number.isSafeInteger(id) &&
      Number.isSafeInteger(h) &&
      h >= 1 &&
      h <= 4 &&
      Number.isSafeInteger(v) &&
      v >= 1 &&
      v <= 4 &&
      Number.isSafeInteger(table) &&
      table >= 0 &&
      table <= 3
    );
  });
}
