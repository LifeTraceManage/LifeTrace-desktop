/** ICBC electronic debit statement reader. No OCR/Poppler. All financial checks must pass before import. */
export type BankTransaction = {
  page: number; row: number; date: string; time: string; account: string;
  summary: string; amount: string; balance: string; counterparty: string;
  counterpartyAccount: string; channel: string;
};
export type PageCheck = { page: number; count: number; expectedCount: number | null; income: string; expectedIncome: string | null; expense: string; expectedExpense: string | null; valid: boolean };
export type BankStatement = { transactions: BankTransaction[]; pages: PageCheck[]; balanceErrors: number[]; valid: boolean; errors: string[] };
export type PositionedWord = { x: number; y: number; text: string; angle?: number };
const MONEY = /^[+-]?[\d,]+\.\d{2}$/;
const COLUMNS = {
  account: [130, 217], summary: [336, 376], amount: [419, 504],
  balance: [507, 566], counterparty: [575, 647],
  counterpartyAccount: [650, 715], channel: [718, 770],
} as const;
export function toCents(text: string): bigint {
  const value = text.replaceAll(",", "").match(/^([+-]?)(\d+)\.(\d{2})$/);
  if (!value) throw new Error("无效金额：" + text);
  return (BigInt(value[2]) * 100n + BigInt(value[3])) * (value[1] === "-" ? -1n : 1n);
}
const formatCents = (value: bigint) => {
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
};
/** Normalize to the rotated landscape 842×595 viewport, as used by ICBC's PDF. */
export function wordsFromPdfJs(items: readonly unknown[], pageWidth: number, pageHeight: number): PositionedWord[] {
  const words: PositionedWord[] = [];
  for (const item of items) {
    const part = item as {str?: string; transform?: number[]; width?: number; height?: number};
    if (typeof part.str !== "string" || !part.str.trim() || !part.transform) continue;
    const [a, b, , d, x, baseline] = part.transform;
    const angle = Math.atan2(b, a) * 180 / Math.PI;
    if (Math.abs(angle) > 2) continue;
    const height = Math.abs(d) || part.height || 8;
    const y = (pageHeight - baseline - height) * (595 / pageHeight);
    const sx = 842 / pageWidth;
    const width = (part.width || part.str.length * Math.abs(a) * 0.55) * sx;
    for (const match of part.str.matchAll(/\S+/gu)) {
      words.push({x: x * sx + (match.index || 0) / part.str.length * width, y, text: match[0]});
    }
  }
  return words;
}
export function parseIcbcPages(pages: PositionedWord[][]): BankStatement {
  if (!pages.length) throw new Error("PDF 没有可读取的页面");
  const transactions: BankTransaction[] = [];
  const checks: PageCheck[] = [];
  const errors: string[] = [];
  for (const [pageIndex, original] of pages.entries()) {
    const words = original.filter(word => Math.abs(word.angle || 0) <= 2);
    if (!words.some(word => word.text.includes("交易日期")) || !words.some(word => word.text.includes("收入/支出金额"))) {
      throw new Error(`第 ${pageIndex + 1} 页不符合工商银行电子流水模板`);
    }
    const anchors = words.filter(word => /^20\d\d-\d\d-\d\d$/.test(word.text) && word.x > 80 && word.x < 135 && word.y > 64 && word.y < 520).sort((a, b) => a.y - b.y);
    const pageRows: BankTransaction[] = [];
    const read = (key: keyof typeof COLUMNS, minY: number, maxY: number) => {
      const [minX, maxX] = COLUMNS[key];
      return words.filter(word => word.x >= minX && word.x < maxX && word.y >= minY && word.y < maxY)
        .sort((a, b) => a.y - b.y || a.x - b.x).map(word => word.text).join("");
    };
    for (const [index, anchor] of anchors.entries()) {
      const end = anchors[index + 1]?.y ?? 515;
      const times = words.filter(word => word.x > 85 && word.x < 132 && word.y >= anchor.y && word.y < end && /^\d{2}:\d{2}:\d{2}$/.test(word.text)).sort((a, b) => a.y - b.y);
      const baseline = anchor.y + 3.5;
      const narrow = (key: keyof typeof COLUMNS) => read(key, baseline - 1.8, baseline + 1.8);
      const numeric = (key: "amount" | "balance") => {
        const [x1, x2] = COLUMNS[key];
        const candidates = words.filter(word => word.x >= x1 && word.x < x2 && Math.abs(word.y - baseline) < 1.8 && MONEY.test(word.text));
        return candidates.length === 1 ? candidates[0].text : "";
      };
      pageRows.push({
        page: pageIndex + 1, row: index + 1, date: anchor.text, time: times[0]?.text || "",
        account: narrow("account"), summary: narrow("summary"), amount: numeric("amount"),
        balance: numeric("balance"), counterparty: read("counterparty", anchor.y + 0.1, Math.min(end, anchor.y + 14)),
        counterpartyAccount: narrow("counterpartyAccount"), channel: narrow("channel"),
      });
    }
    const footer = (label: string) => {
      for (const anchor of words.filter(word => word.text.includes(label))) {
        const line = words.filter(word => Math.abs(word.y - anchor.y) < 2).sort((a, b) => a.x - b.x).map(word => word.text).join("");
        const match = line.match(new RegExp(label + "([\\d,.]+)"));
        if (match) return match[1];
      }
      return null;
    };
    const expectedCountText = footer("本页交易笔数：");
    const expectedCount = expectedCountText === null ? null : Number(expectedCountText);
    const expectedIncome = footer("本页收入算术合计：");
    const expectedExpense = footer("本页支出算术合计：");
    const wellFormed = pageRows.every(row => MONEY.test(row.amount) && MONEY.test(row.balance) && /^\d\d:\d\d:\d\d$/.test(row.time) && !!row.account);
    const income = pageRows.filter(row => MONEY.test(row.amount) && toCents(row.amount) > 0n).reduce((sum, row) => sum + toCents(row.amount), 0n);
    const expense = -pageRows.filter(row => MONEY.test(row.amount) && toCents(row.amount) < 0n).reduce((sum, row) => sum + toCents(row.amount), 0n);
    const valid = wellFormed && expectedCount !== null && pageRows.length === expectedCount && expectedIncome !== null && MONEY.test(expectedIncome) && toCents(expectedIncome) === income && expectedExpense !== null && MONEY.test(expectedExpense) && toCents(expectedExpense) === expense;
    if (!valid) errors.push(`第 ${pageIndex + 1} 页交易笔数、金额或必填字段校验失败`);
    checks.push({page: pageIndex + 1, count: pageRows.length, expectedCount, income: formatCents(income), expectedIncome, expense: formatCents(expense), expectedExpense, valid});
    transactions.push(...pageRows);
  }
  const balanceErrors: number[] = [];
  for (let i = 1; i < transactions.length; i++) {
    const previous = transactions[i - 1], current = transactions[i];
    if (previous.account !== current.account || ![previous.balance, current.balance, current.amount].every(value => MONEY.test(value))) continue;
    if (toCents(previous.balance) + toCents(current.amount) !== toCents(current.balance)) balanceErrors.push(i);
  }
  if (balanceErrors.length) errors.push(`存在 ${balanceErrors.length} 笔余额不连续的交易`);
  return {transactions, pages: checks, balanceErrors, valid: errors.length === 0, errors};
}
export async function parseIcbcPdf(file: File): Promise<BankStatement> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await file.arrayBuffer());
  const task = getDocument({data, useSystemFonts: true, disableFontFace: true, useWorkerFetch: false, isEvalSupported: false});
  const pdf = await task.promise;
  try {
    const pages: PositionedWord[][] = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const viewport = page.getViewport({scale: 1});
      const content = await page.getTextContent();
      pages.push(wordsFromPdfJs(content.items, viewport.width, viewport.height));
      page.cleanup();
    }
    return parseIcbcPages(pages);
  } finally {
    await pdf.destroy();
  }
}
