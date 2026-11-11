import type { OperationParameters } from "./types";

/** Renders a recorded parameter for the history list, or a dash if absent. */
export function field(parameters: OperationParameters, key: string): string {
  const value = parameters[key];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "—";
}
