import type { Result } from "../shared/result";

const ERROR_CODES = new Set([
  "INVALID_INPUT",
  "UNSUPPORTED_FORMAT",
  "MALFORMED_JPEG",
  "PROCESSING_FAILED",
  "CANCELLED",
  "INTERNAL",
]);

/** Validate untrusted worker messages before accessing a Result branch. */
export function isWorkerResult<T>(
  value: unknown,
  isValue: (value: unknown) => value is T,
): value is Result<T> {
  if (typeof value !== "object" || value === null) return false;
  if (Reflect.get(value, "ok") === true) {
    return isValue(Reflect.get(value, "value"));
  }
  if (Reflect.get(value, "ok") !== false) return false;
  const error: unknown = Reflect.get(value, "error");
  return (
    typeof error === "object" &&
    error !== null &&
    ERROR_CODES.has(Reflect.get(error, "code")) &&
    typeof Reflect.get(error, "message") === "string"
  );
}
