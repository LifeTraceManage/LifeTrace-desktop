import type { Transaction } from "@/src/types";
import type { ArchivedStatementRow } from "@/src/services/statementArchive";
import type { ReconcileMatch } from "@/src/utils/statementReconciliation";

/** Only bank entries with an exact ICBC provenance marker can be superseded. */
export function archivedBankMarker(row: ArchivedStatementRow): string | undefined {
  if (row.source !== "icbc" || !row.verified || !row.payload || typeof row.payload !== "object") return undefined;
  const v = row.payload as Record<string, unknown>;
  const fields = ["date", "time", "account", "amount", "balance"].map(key => v[key]);
  if (fields.some(value => typeof value !== "string" || !value)) return undefined;
  return ["工商银行流水", ...fields].join("/");
}
export function archivedPaymentOrder(row: ArchivedStatementRow): string | undefined {
  if ((row.source !== "wechat" && row.source !== "alipay") || !row.payload || typeof row.payload !== "object") return undefined;
  const v = row.payload as {headers?: unknown;cells?:unknown};
  if (!Array.isArray(v.headers) || !Array.isArray(v.cells)) return undefined;
  const i = v.headers.findIndex(h => typeof h === "string" && /交易订单号|交易单号/.test(h));
  const order = i >= 0 ? v.cells[i] : undefined;
  return typeof order === "string" && order.trim() && order.trim() !== "/" ? order.trim() : undefined;
}
export type LedgerCorrection = {bankTransactionId:string; paymentTransactionId:string};
export function findSafeLedgerCorrections(
  links: readonly ReconcileMatch[],
  archived: readonly ArchivedStatementRow[],
  ledger: readonly Transaction[],
): LedgerCorrection[] {
  const rows = new Map(archived.map(row => [row.batchId + ":" + row.ordinal,row]));
  const corrections: LedgerCorrection[] = [];
  const used = new Set<string>();
  for (const link of links) {
    const bank = rows.get(link.bankId); const payment = rows.get(link.paymentId);
    if (!bank || !payment) continue;
    const marker = archivedBankMarker(bank); const order = archivedPaymentOrder(payment);
    if (!marker || !order) continue;
    const bankLedger = ledger.filter(tx => tx.note?.includes(marker));
    const paymentLedger = ledger.filter(tx => tx.note?.includes((payment.source === "alipay" ? "支付宝" : "微信") + "交易单号：" + order));
    // If one side has already been updated in place, it is not a double posting.
    if (bankLedger.length !== 1 || paymentLedger.length !== 1 || bankLedger[0].id === paymentLedger[0].id) continue;
    const a = bankLedger[0], b = paymentLedger[0];
    if (a.type !== b.type || Math.round(a.amount * 100) !== Math.round(b.amount * 100)) continue;
    if (used.has(a.id) || used.has(b.id)) continue;
    used.add(a.id); used.add(b.id);
    corrections.push({bankTransactionId:a.id,paymentTransactionId:b.id});
  }
  return corrections;
}
