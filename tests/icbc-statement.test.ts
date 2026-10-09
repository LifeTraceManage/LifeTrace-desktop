import assert from "node:assert/strict";
import test from "node:test";
import { parseIcbcPages, toCents, wordsFromPdfJs } from "../src/utils/icbcStatement";

test("money uses integer cents", () => {
  assert.equal(toCents("-1,234.56"), -123456n);
  assert.equal(toCents("+0.01"), 1n);
  assert.throws(() => toCents("12.3"));
});
test("unknown bank template is rejected", () => {
  assert.throws(() => parseIcbcPages([[{x: 2, y: 3, text: "another-bank"}]]), /模板/);
});
test("bank statement must have a page footer", () => {
  const words = [
    {x: 100, y: 24, text: "交易日期"},
    {x: 435, y: 24, text: "收入/支出金额"},
    {x: 102, y: 100, text: "2026-06-01"},
    {x: 104, y: 105, text: "08:00:00"},
    {x: 150, y: 103.5, text: "1901011101214633927"},
    {x: 445, y: 103.5, text: "-8.20"},
    {x: 520, y: 103.5, text: "99.00"},
  ];
  const report = parseIcbcPages([words]);
  assert.equal(report.valid, false);
  assert.match(report.errors[0], /校验失败/);
});

test("two transactions with page totals and balances are accepted without dropping rows", () => {
  const words = [
    {x: 101, y: 24, text: "交易日期"},
    {x: 435, y: 24, text: "收入/支出金额"},
    {x: 100, y: 100, text: "2026-06-01"},
    {x: 100, y: 105, text: "08:00:00"},
    {x: 150, y: 103.5, text: "BANK1234"},
    {x: 340, y: 103.5, text: "消费"},
    {x: 450, y: 103.5, text: "-5.00"},
    {x: 520, y: 103.5, text: "95.00"},
    {x: 100, y: 118, text: "2026-06-01"},
    {x: 100, y: 123, text: "09:00:00"},
    {x: 150, y: 121.5, text: "BANK1234"},
    {x: 340, y: 121.5, text: "入账"},
    {x: 450, y: 121.5, text: "+2.00"},
    {x: 520, y: 121.5, text: "97.00"},
    {x: 80, y: 548, text: "本页交易笔数：2"},
    {x: 300, y: 548, text: "本页支出算术合计：5.00"},
    {x: 560, y: 548, text: "本页收入算术合计：2.00"},
  ];
  const result = parseIcbcPages([words]);
  assert.equal(result.transactions.length, 2);
  assert.equal(result.pages[0].count, 2);
  assert.equal(result.pages[0].valid, true);
  assert.deepEqual(result.balanceErrors, []);
  assert.equal(result.valid, true);
});

test("page total mismatch blocks financial import", () => {
  const words = [
    {x: 101, y: 24, text: "交易日期"},
    {x: 435, y: 24, text: "收入/支出金额"},
    {x: 100, y: 100, text: "2026-06-01"},
    {x: 100, y: 105, text: "08:00:00"},
    {x: 150, y: 103.5, text: "BANK1234"},
    {x: 450, y: 103.5, text: "-5.00"},
    {x: 520, y: 103.5, text: "95.00"},
    {x: 80, y: 548, text: "本页交易笔数：1"},
    {x: 300, y: 548, text: "本页支出算术合计：9.00"},
    {x: 560, y: 548, text: "本页收入算术合计：0.00"},
  ];
  assert.equal(parseIcbcPages([words]).valid, false);
});

test("PDF.js viewport coordinates preserve increasing transaction row order", () => {
  const result = wordsFromPdfJs([
    {str: "2026-06-01", transform: [7, 0, 0, -7, 100, 78], width: 42},
    {str: "2026-06-02", transform: [7, 0, 0, -7, 100, 96], width: 42},
  ], 842, 595);
  assert.equal(result.length, 2);
  assert.equal(result[0].y, 71);
  assert.equal(result[1].y, 89);
  assert.ok(result[0].y < result[1].y);
});
