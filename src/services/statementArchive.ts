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
  const fileBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("无法读取账单原始文件"));
    reader.onload = () => {
      if (typeof reader.result !== "string") return reject(new Error("来源文件编码失败"));
      resolve(reader.result.slice(reader.result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
  return invoke<RawStorageResult>("statement_save_raw", {
    request: {source, filename: file.name, fileSha256, fileSize: file.size, fileBase64, verified, validation, rows},
  });
}


export type StoredStatementBatch = {
  id: string;
  source: string;
  filename: string;
  verified: boolean;
  expectedRows: number;
  storedRows: number;
};
export async function listArchivedStatementBatches(): Promise<StoredStatementBatch[]> {
  return invoke<StoredStatementBatch[]>("statement_list_batches");
}
