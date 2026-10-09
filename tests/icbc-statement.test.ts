import assert from "node:assert/strict";
import test from "node:test";
import { parseIcbcPages, toCents } from "../src/utils/icbcStatement";

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
