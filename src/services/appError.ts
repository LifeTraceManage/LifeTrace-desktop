export type AppErrorCode =
  | "NETWORK_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "SERVER_ERROR"
  | "OFFLINE"
  | "FILE_NOT_FOUND"
  | "FILE_PERMISSION_DENIED"
  | "CANCELLED"
  | "UNKNOWN";

export type AppErrorOptions = {
  code: AppErrorCode;
  message: string;
  details?: unknown;
  retryable?: boolean;
  cause?: unknown;
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details?: unknown;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = "AppError";
    this.code = options.code;
    this.details = options.details;
    this.retryable = options.retryable ?? false;
    this.cause = options.cause;
  }
}

export function appErrorFromHttp(status: number, message: string, details?: unknown): AppError {
  if (status === 401) return new AppError({ code: "UNAUTHORIZED", message, details, retryable: false });
  if (status === 403) return new AppError({ code: "FORBIDDEN", message, details, retryable: false });
  if (status === 404) return new AppError({ code: "NOT_FOUND", message, details, retryable: false });
  if (status === 409) return new AppError({ code: "CONFLICT", message, details, retryable: false });
  if (status === 400 || status === 422) {
    return new AppError({ code: "VALIDATION_ERROR", message, details, retryable: false });
  }
  if (status >= 500) return new AppError({ code: "SERVER_ERROR", message, details, retryable: true });
  return new AppError({ code: "UNKNOWN", message, details, retryable: false });
}

export function normalizeAppError(
  cause: unknown,
  fallbackMessage = "操作失败",
): AppError {
  if (cause instanceof AppError) return cause;
  if (cause instanceof DOMException && cause.name === "AbortError") {
    return new AppError({ code: "CANCELLED", message: "操作已取消", cause, retryable: false });
  }
  const message = cause instanceof Error ? cause.message : String(cause || fallbackMessage);
  if (/offline|离线|network|failed to fetch|无法连接/i.test(message)) {
    return new AppError({ code: "NETWORK_ERROR", message, cause, retryable: true });
  }
  return new AppError({ code: "UNKNOWN", message: message || fallbackMessage, cause, retryable: false });
}
