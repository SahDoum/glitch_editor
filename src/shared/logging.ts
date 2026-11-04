import type { AppErrorCode } from "./result";

export type LogEventName = "app.started" | "operation.failed" | "worker.failed";

export interface ErrorLogEvent {
  event: LogEventName;
  code: AppErrorCode;
}

export interface Logger {
  error(entry: ErrorLogEvent): void;
}

export const consoleLogger: Logger = {
  error({ event, code }) {
    console.error(`[${event}] ${code}`);
  },
};
