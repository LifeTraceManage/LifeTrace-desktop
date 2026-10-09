/** Conservative bank/payment reconciliation. Never infer a duplicate from amount alone. */
export type ReconcileSource = "icbc" | "wechat" | "alipay";
export type ReconcileDirection = "income" | "expense";
export type ReconcileRow = {
  id: string;
  source: ReconcileSource;
  amountCents: number;
  direction: ReconcileDirection;
  epochMs: number;
  cardLast4?: string;
  channel?: "wechat" | "alipay";
  orderId?: string;
};
export type ReconcileMatch = {bankId: string; paymentId: string; reason: "unique-card-time-channel"};
export type ReconcileResult = {matches: ReconcileMatch[]; reviewIds: string[]; unmatchedIds: string[]};
export function cardTail(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, "");
  const found = normalized.match(/(?:尾号|尾数|末四位|\*{2,}|[（(])\D*(\d{4})(?!\d)/);
  return found?.[1] ?? (normalized.match(/(?:尾号|尾数|末四位|\*{2,})\D*(\d{4})(?!\d)/)?.[1]);
}
export function reconcileSources(rows: readonly ReconcileRow[]): ReconcileResult {
  const banks = rows.filter(row => row.source === "icbc");
  const payments = rows.filter(row => row.source !== "icbc");
  const candidates = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();
  const review = new Set<string>();
  const matches: ReconcileMatch[] = [];
  for (const bank of banks) {
    const possible = payments.filter(payment => {
      if (bank.amountCents <= 0 || payment.amountCents <= 0 ||
          bank.amountCents !== payment.amountCents || bank.direction !== payment.direction ||
          !Number.isFinite(bank.epochMs) || !Number.isFinite(payment.epochMs)) return false;
      // A known card mismatch is authoritative negative evidence.
      if (bank.cardLast4 && payment.cardLast4 && bank.cardLast4 !== payment.cardLast4) return false;
      // A payment channel must be supported by bank statement metadata.
      if (!bank.channel || bank.channel !== payment.source) return false;
      // Require the exact four-digit card identity. Absent metadata is review-only.
      if (!bank.cardLast4 || !payment.cardLast4 || bank.cardLast4 !== payment.cardLast4) {
        if (Math.abs(bank.epochMs - payment.epochMs) <= 30 * 60_000) {
          review.add(bank.id); review.add(payment.id);
        }
        return false;
      }
      return Math.abs(bank.epochMs - payment.epochMs) <= 10 * 60_000;
    });
    candidates.set(bank.id, possible.map(row => row.id));
    for (const payment of possible) reverse.set(payment.id, [...(reverse.get(payment.id) ?? []), bank.id]);
  }
  const consumed = new Set<string>();
  for (const bank of banks) {
    const ids = candidates.get(bank.id) ?? [];
    if (ids.length === 1 && reverse.get(ids[0])?.length === 1) {
      matches.push({bankId: bank.id, paymentId: ids[0], reason: "unique-card-time-channel"});
      consumed.add(bank.id); consumed.add(ids[0]);
    } else if (ids.length > 0) {
      review.add(bank.id); ids.forEach(id => review.add(id));
    }
  }
  const reviewIds = [...review].filter(id => !consumed.has(id));
  return {matches, reviewIds, unmatchedIds: rows.map(row => row.id).filter(id => !consumed.has(id) && !review.has(id))};
}
export function bankChannel(counterparty: string, summary: string): "wechat" | "alipay" | undefined {
  const label = `${counterparty} ${summary}`;
  if (/财付通|微信支付|微信商户/.test(label)) return "wechat";
  if (/支付宝|蚂蚁金服/.test(label)) return "alipay";
  return undefined;
}
export function currencyCents(value: string): number | undefined {
  const m = value.replace(/[￥¥,\s]/g, "").match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return undefined;
  const n = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}
