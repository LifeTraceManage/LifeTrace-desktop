import { invoke } from "@tauri-apps/api/core";

type RawStorageResult = { batchId: string; inserted: number; existing: boolean; persisted: number };
export async function archiveBillRows(
  file: File,
  source: "icbc" | "wechat" | "alipay" | "generic",
  rows: Array<{ordinal: number; sourceId?: string; payload: unknown; status: "parsed" | "review" | "neutral" | "invalid"}>,
  verified: boolean,
  validation: Record<string, unknown>,
): Promise<RawStorageResult> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  const fileSha256 = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  return invoke<RawStorageResult>("statement_save_raw", {
    request: {source, filename: file.name, fileSha256, fileSize: file.size, verified, validation, rows},
  });
}

