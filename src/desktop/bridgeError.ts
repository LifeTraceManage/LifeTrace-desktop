import { AppError } from "@/src/services/appError";

export function desktopBridgeError(capability: string): AppError {
  return new AppError({
    code: "UNKNOWN",
    message: capability + " 仅在 LifeTrace Desktop 原生运行时可用",
    retryable: false,
  });
}
