import type { ArchivedStatementRow } from "@/src/services/statementArchive";
import { bankChannel, cardTail, currencyCents, reconcileSources } from "@/src/utils/statementReconciliation";
import type { ReconcileRow, ReconcileResult } from "@/src/utils/statementReconciliation";
type Obj = Record<string, unknown>;
const str = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const stamp = (date: string): number => {
  const value = date.replace(" ", "T");
  return Date.parse(value.endsWith("Z") || value.includes("+") ? value : value + "+08:00");
};
const idx = (headers: string[], fields: string[]): number => headers.findIndex(h => fields.some(f => h.toLowerCase().includes(f.toLowerCase())));
export function normalizeArchivedRows(rows: readonly ArchivedStatementRow[]): ReconcileRow[] {
  const result: ReconcileRow[] = [];
  for (const row of rows) {
    if (row.status === "invalid" || !row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)) continue;
    const v = row.payload as Obj;
    const id = row.batchId + ":" + row.ordinal;
    if (row.source === "icbc") {
      const amountText = str(v.amount);
      const amount = currencyCents(amountText.replace(/^[+-]/, ""));
      const time = stamp(str(v.date) + " " + str(v.time));
      if (!amount || !Number.isFinite(time)) continue;
      result.push({id, source:"icbc", amountCents:amount, epochMs:time,
        direction:amountText.startsWith("-") ? "expense" : "income",
        cardLast4:str(v.account).match(/(\d{4})$/)?.[1],
        channel:bankChannel(str(v.counterparty),str(v.summary))});
      continue;
    }
    if (row.source !== "wechat" && row.source !== "alipay") continue;
    const headers = Array.isArray(v.headers) ? v.headers.map(str) : [];
    const cells = Array.isArray(v.cells) ? v.cells.map(str) : [];
    const get = (...fields:string[]) => cells[idx(headers,fields)] ?? "";
    const amount = currencyCents(get("金额","amount"));
    const direction = /支出|expense/i.test(get("收/支","收支","direction")) ? "expense" :
      /收入|income/i.test(get("收/支","收支","direction")) ? "income" : undefined;
    const time = stamp(get("交易时间","日期","date"));
    const method = get("收/付款方式","付款方式","支付方式");
    const tail = cardTail(method);
    if (!amount || !direction || !Number.isFinite(time) || /零钱|余额宝|账户余额|花呗/.test(method) ||
      (!tail && !/银行|储蓄卡|信用卡/.test(method))) continue;
    result.push({id,source:row.source,amountCents:amount,direction,epochMs:time,
      cardLast4:tail,orderId:get("交易订单号","交易单号")});
  }
  return result;
}
export function reconcileArchivedRows(rows: readonly ArchivedStatementRow[]): ReconcileResult {
  return reconcileSources(normalizeArchivedRows(rows));
}
