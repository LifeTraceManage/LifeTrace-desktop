import { instrumentedFetch } from "@/src/services/clientObservability";
import type { XunjiWorkout } from "@/src/types";

export type ParsedXunjiImport = {
  importId: string;
  shareUrl: string;
  parser: "embedded-json" | "dom";
  workout: XunjiWorkout;
};

type ErrorPayload = { error?: string };

async function parseJson<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json() as T & ErrorPayload;
  if (!response.ok) throw new Error(payload.error || fallback);
  return payload;
}

export const xunjiImportApi = {
  async parse(file: File): Promise<ParsedXunjiImport> {
    const form = new FormData();
    form.set("image", file);
    const response = await instrumentedFetch(globalThis.fetch, "/api/xunji/parse", {
      method: "POST",
      body: form,
    }, {
      module: "xunji-import",
      action: "parse",
      userMessage: "训记分享解析失败",
    });
    return parseJson<ParsedXunjiImport>(response, "训记分享解析失败");
  },

  async finish(
    importId: string,
    action: "confirm" | "cancel",
    workout?: XunjiWorkout,
  ): Promise<void> {
    const response = await instrumentedFetch(globalThis.fetch, "/api/xunji/imports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        importId,
        action,
        workout: action === "confirm" ? workout : undefined,
      }),
    }, {
      module: "xunji-import",
      action: "finish",
      userMessage: "训练导入失败",
    });
    await parseJson<Record<string, unknown>>(response, "训练导入失败");
  },
};
