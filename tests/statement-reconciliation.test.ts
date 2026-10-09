import test from "node:test";
import assert from "node:assert/strict";
import { reconcileSources, bankChannel, cardTail, currencyCents } from "../src/utils/statementReconciliation";
const t = (id: string, source: "icbc" | "wechat" | "alipay", minute: number, tail?: string) => ({
  id, source, amountCents: 2500, direction: "expense" as const, epochMs: Date.UTC(2026,9,9,10,minute),
  cardLast4: tail, channel: source === "icbc" ? "wechat" as const : undefined,
});
test("matches only uniquely evidenced bank-backed payment", () => {
  const out = reconcileSources([t("bank","icbc",1,"1234"),t("wx","wechat",2,"1234")]);
  assert.equal(out.matches.length, 1);
  assert.deepEqual(out.matches[0],{bankId:"bank",paymentId:"wx",reason:"unique-card-time-channel"});
});
test("same amount, different card must never deduplicate", () => {
  const out = reconcileSources([t("bank","icbc",1,"1234"),t("wx","wechat",2,"5678")]);
  assert.equal(out.matches.length,0);
});
test("two equal candidate payments remain ambiguous, no auto merge", () => {
  const out = reconcileSources([t("bank","icbc",1,"1234"),t("wx1","wechat",2,"1234"),t("wx2","wechat",3,"1234")]);
  assert.equal(out.matches.length,0);
  assert.equal(out.reviewIds.length,3);
});
test("a single payment cannot match two bank rows", () => {
  const out = reconcileSources([t("bank1","icbc",1,"1234"),t("bank2","icbc",2,"1234"),t("wx","wechat",2,"1234")]);
  assert.equal(out.matches.length,0);
});
test("different channels, time windows and missing tails are conservative", () => {
  assert.equal(reconcileSources([{...t("bank","icbc",0,"1234"),channel:"alipay"},t("wx","wechat",1,"1234")]).matches.length,0);
  assert.equal(reconcileSources([t("bank","icbc",0,"1234"),t("wx","wechat",45,"1234")]).matches.length,0);
  const missing = reconcileSources([t("bank","icbc",0),t("wx","wechat",2)]);
  assert.equal(missing.matches.length,0);
  assert.equal(missing.reviewIds.length,2);
});
test("payment metadata normalization", () => {
  assert.equal(cardTail("工商银行储蓄卡(1234)"),"1234");
  assert.equal(cardTail("工商银行尾号 1234"),"1234");
  assert.equal(currencyCents("¥12.30"),1230);
  assert.equal(bankChannel("财付通支付科技有限公司","消费"),"wechat");
  assert.equal(bankChannel("支付宝","二维码支付"),"alipay");
});
