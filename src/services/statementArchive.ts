import { reconcileArchivedRows } from "@/src/utils/archivedStatementReconciliation";
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

export type ArchivedStatementRow = {
  batchId: string;
  ordinal: number;
  source: "icbc" | "wechat" | "alipay" | "generic";
  status: string;
  payload: unknown;
};
export async function listArchivedStatementRows(): Promise<ArchivedStatementRow[]> {
  return invoke<ArchivedStatementRow[]>("statement_list_raw_rows");
}

export type PersistedStatementMatch = {
  bankBatchId: string;
  bankOrdinal: number;
  paymentBatchId: string;
  paymentOrdinal: number;
  reason: "unique-card-time-channel";
};
export async function saveArchivedStatementMatches(matches: PersistedStatementMatch[]): Promise<number> {
  return invoke<number>("statement_save_matches", { matches });
}

export async function reconcileArchivedStatements() {
  const rawRows = await listArchivedStatementRows();
  const result = reconcileArchivedRows(rawRows);
  const matches: PersistedStatementMatch[] = result.matches.map(match => {
    const [bankBatchId, bankOrdinal] = match.bankId.split(":");
    const [paymentBatchId, paymentOrdinal] = match.paymentId.split(":");
    return {bankBatchId, bankOrdinal:Number(bankOrdinal), paymentBatchId,
      paymentOrdinal:Number(paymentOrdinal), reason:match.reason};
  });
  if (matches.length) await saveArchivedStatementMatches(matches);
  return { ...result, rawRows };
}
