import { desktopCloudFetch } from "@/src/services/cloudTransport";
import {
  AppError,
  appErrorFromHttp,
  normalizeAppError,
} from "@/src/services/appError";
import { clientLogger } from "@/src/services/clientObservability";

type ApiErrorEnvelope = {
  message?: string;
  error?: string | { message?: string; code?: string; details?: unknown };
  details?: unknown;
};

export type ApiRequestOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    signal.addEventListener(
      "abort",
      () => reject(new DOMException("Aborted", "AbortError")),
      { once: true },
    );
  });
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  try {
    const contenders: Promise<T>[] = [
      operation,
      abortPromise(timeout.signal) as Promise<T>,
    ];
    if (externalSignal) contenders.push(abortPromise(externalSignal) as Promise<T>);
    return await Promise.race(contenders);
  } finally {
    clearTimeout(timer);
  }
}

function messageFromPayload(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const envelope = payload as ApiErrorEnvelope;
    if (typeof envelope.message === "string" && envelope.message.trim()) return envelope.message;
    if (typeof envelope.error === "string" && envelope.error.trim()) return envelope.error;
    if (envelope.error && typeof envelope.error === "object" && envelope.error.message) {
      return envelope.error.message;
    }
  }
  return "云端请求失败（" + status + "）";
}

async function parseBody(response: Response): Promise<unknown> {
  if ([204, 205, 304].includes(response.status)) return null;
  const raw = await response.text();
  if (!raw) return null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(raw);
    } catch {
      throw new AppError({
        code: "SERVER_ERROR",
        message: "云端返回了无效 JSON",
        details: raw.slice(0, 500),
        retryable: true,
      });
    }
  }
  return raw;
}

export class DesktopApiClient {
  constructor(private readonly timeoutMs = 45_000) {}

  async request<T>(
    path: string,
    init: RequestInit = {},
    options: ApiRequestOptions = {},
  ): Promise<T> {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new AppError({
        code: "OFFLINE",
        message: "当前离线，请联网后重试",
        retryable: true,
      });
    }

    const method = (init.method || "GET").toUpperCase();
    try {
      const response = await withTimeout(
        desktopCloudFetch(path, { ...init, signal: options.signal ?? init.signal }),
        options.timeoutMs ?? this.timeoutMs,
        options.signal,
      );
      const payload = await parseBody(response);
      if (!response.ok) {
        throw appErrorFromHttp(response.status, messageFromPayload(payload, response.status), payload);
      }
      return payload as T;
    } catch (cause) {
      const error = normalizeAppError(cause, "云端请求失败");
      if (error.code !== "CANCELLED") {
        clientLogger.warn("desktop.api.request_failed", {
          method,
          path: path.split("?", 1)[0],
          code: error.code,
          retryable: error.retryable,
        });
      }
      throw error;
    }
  }
}

export const desktopApiClient = new DesktopApiClient();
