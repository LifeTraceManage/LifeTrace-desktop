import { invoke } from "@tauri-apps/api/core";
import { cloudAuthClient } from "@/src/services/cloudAuth";

type NativeCloudApiResponse = {
  status: number;
  body: string;
  contentType?: string | null;
};

function requestHeaders(request: Request | undefined, init: RequestInit): Headers {
  const merged = new Headers(request?.headers);
  new Headers(init.headers).forEach((value, key) => merged.set(key, value));
  return merged;
}

function desktopApiPath(path: string): string {
  if (path === "/api/v1/photo-challenge/admin") return "/api/v1/photo-challenge/desktop-admin";
  if (path === "/api/v1/web/assistant") return "/api/v1/assistant";
  if (path === "/api/v1/web/devices" || path.startsWith("/api/v1/web/devices/")) {
    return path.replace("/api/v1/web/devices", "/api/v1/auth/devices");
  }
  if (path === "/api/v1/web/sessions" || path.startsWith("/api/v1/web/sessions/")) {
    return path.replace("/api/v1/web/sessions", "/api/v1/auth/sessions");
  }
  return path;
}

/**
 * Native bearer-token transport for cloud APIs.
 *
 * Renderer code never talks to arbitrary origins directly. Rust validates the
 * configured origin and /api/v1 namespace before forwarding the request.
 */
export async function desktopCloudFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const request = input instanceof Request ? input : undefined;
  const rawUrl = request?.url ?? (input instanceof URL ? input.toString() : String(input));
  const url = new URL(rawUrl, window.location.href);
  if (!url.pathname.startsWith("/api/v1/")) {
    throw new Error(`桌面云服务拒绝非 LifeTrace API 请求：${url.pathname}`);
  }

  const method = (init.method ?? request?.method ?? "GET").toUpperCase();
  let body = init.body;
  if (body === undefined && request && method !== "GET" && method !== "HEAD") {
    body = await request.clone().text();
  }
  if (body != null && typeof body !== "string") {
    if (body instanceof URLSearchParams) body = body.toString();
    else throw new Error("桌面云服务当前只支持 JSON/文本请求体");
  }

  const headers = requestHeaders(request, init);
  if (body != null) {
    const contentType = headers.get("content-type")?.toLowerCase() ?? "application/json";
    if (!contentType.includes("application/json")) {
      throw new Error("桌面云服务当前只允许 JSON API 请求体");
    }
  }

  const send = async (): Promise<Response> => {
    const result = await invoke<NativeCloudApiResponse>("cloud_api_http_request", {
      request: {
        path: desktopApiPath(url.pathname),
        query: url.search ? url.search.slice(1) : null,
        method,
        body: typeof body === "string" ? body : null,
      },
    });
    const responseBody = [204, 205, 304].includes(result.status) ? null : result.body;
    return new Response(responseBody, {
      status: result.status,
      headers: result.contentType
        ? { "content-type": result.contentType }
        : { "content-type": "application/json" },
    });
  };

  let response = await send();
  if (response.status === 401) {
    await cloudAuthClient.refresh();
    response = await send();
  }
  return response;
}
