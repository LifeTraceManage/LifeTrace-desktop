import { invoke } from "@tauri-apps/api/core";

type NativeLocalJsonResponse = {
  status: number;
  body: string;
  contentType?: string | null;
};

type ErrorPayload = {
  error?: string;
  message?: string;
};

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function parsePayload(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function unwrap<T>(payload: unknown, status: number, fallbackMessage: string): T {
  if (status < 200 || status >= 300) {
    const error = payload as ErrorPayload | string | null;
    const message = typeof error === "string" ? error : error?.message || error?.error;
    throw new Error(message || `${fallbackMessage}（${status}）`);
  }
  return payload as T;
}

export async function localJsonRequest<T>(
  url: string,
  init: RequestInit | undefined,
  fallbackMessage: string,
): Promise<T> {
  if (!isTauriRuntime()) {
    const response = await fetch(url, { cache: "no-store", ...init });
    return unwrap<T>(parsePayload(await response.text()), response.status, fallbackMessage);
  }

  const parsed = new URL(url, "http://lifetrace.local");
  const body = init?.body;
  if (body !== undefined && body !== null && typeof body !== "string") {
    throw new Error("本机 JSON IPC 仅支持 JSON/文本请求体");
  }

  const response = await invoke<NativeLocalJsonResponse>("local_json_api_request", {
    request: {
      path: parsed.pathname,
      query: parsed.search ? parsed.search.slice(1) : null,
      method: (init?.method || "GET").toUpperCase(),
      body: typeof body === "string" ? body : null,
    },
  });
  return unwrap<T>(parsePayload(response.body), response.status, fallbackMessage);
}
