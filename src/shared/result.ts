export type AppErrorCode =
  | "INVALID_INPUT"
  | "UNSUPPORTED_FORMAT"
  | "PROCESSING_FAILED"
  | "CANCELLED"
  | "INTERNAL";

export interface AppError {
  code: AppErrorCode;
  message: string;
}

export type Result<T, E = AppError> =
  { ok: true; value: T } | { ok: false; error: E };

export function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function failure<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
